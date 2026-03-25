// routes/pipeline.js — Orchestrateur génération automatique de contenu IA
// DISTINCT de ai.js qui gère les DMs/commentaires Instagram

const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { selectBestMedia, decideFormat, markAsUsed, countAvailableMedia } = require('./vision');
const { generateCaption, getTopPosts } = require('./publisher');
const { assembleVisuals, checkAssemblerHealth } = require('./assembler');
const Anthropic = require('@anthropic-ai/sdk');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Génère titres + captions pour chaque slide d'un carousel
// ─────────────────────────────────────────────────────────────────────────────
async function generateCarouselTexts(client, mediaList, topPosts) {
  const topCtx = topPosts.length > 0
    ? topPosts.map(p => `- "${p.caption}" (${p.likes||0} likes)`).join('\n')
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Tu es expert en community management Instagram.

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Ton : ${client.tone || 'professionnel'}
Nombre de slides : ${mediaList.length}
${topCtx ? `Top posts :\n${topCtx}` : ''}

Génère un titre accrocheur et une courte caption (max 12 mots) pour chacune des ${mediaList.length} slides d'un carousel Instagram.
Réponds UNIQUEMENT en JSON valide :
{
  "titres":   ["Titre slide 1", "Titre slide 2"],
  "captions": ["Caption slide 1", "Caption slide 2"],
  "caption_principale": "Caption complète pour le post avec hashtags"
}`
    }]
  });

  try {
    return JSON.parse(message.content[0].text);
  } catch {
    const fallback = mediaList.map((_, i) => `Slide ${i+1}`);
    return { titres: fallback, captions: fallback, caption_principale: '' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Calcule l'heure optimale de publication
// ─────────────────────────────────────────────────────────────────────────────
function computeScheduledAt(mediaAnalyse, client) {
  const now    = new Date();
  const heureIA = mediaAnalyse?.heure_optimale;
  if (heureIA && /^\d{2}:\d{2}$/.test(heureIA)) {
    const [h, m] = heureIA.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.toISOString();
  }
  const slots = {
    restauration: '12:00', mode:       '19:00',
    beaute:       '18:00', immobilier: '17:00',
    sport:        '07:00', default:    '18:30'
  };
  const slot = slots[(client.sector||'').toLowerCase()] || slots.default;
  const [h, m] = slot.split(':').map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline principal pour UN client
// ─────────────────────────────────────────────────────────────────────────────
async function generateForClient(client) {
  console.log(`🤖 Génération IA pour ${client.name}...`);

  // 1. Vérifier le branding
  if (!client.branding || client.branding_status !== 'done') {
    console.warn(`⚠️ Branding non configuré pour ${client.name} — ignoré`);
    return { skipped: true, reason: 'branding_pending' };
  }

  // 2. Vérifier le stock
  const stock = await countAvailableMedia(client.id);
  if (stock === 0) {
    console.warn(`⚠️ Stock vide pour ${client.name}`);
    return { skipped: true, reason: 'stock_vide' };
  }

  // 3. Décider du format
  const { format, count } = await decideFormat(client.id);
  console.log(`📐 Format : ${format} (${count} média(s))`);

  // 4. Sélectionner les médias
  const mediaList    = await selectBestMedia(client.id, { count, format });
  const primaryMedia = mediaList[0];

  // 5. Générer les textes
  const topPosts = await getTopPosts(client.id);
  let titre, caption, titres, captions;

  if (format === 'carousel') {
    const texts = await generateCarouselTexts(client, mediaList, topPosts);
    titres   = texts.titres;
    captions = texts.captions;
    titre    = titres[0];
    caption  = texts.caption_principale || await generateCaption(client, 'carousel', topPosts);
  } else {
    const mediaType = format === 'story' ? 'story verticale' : 'post carré';
    caption = await generateCaption(client, mediaType, topPosts);
    titre   = caption.split(/[.!?]/)[0].replace(/[#@]/g,'').trim().slice(0, 60);
  }

  // 6. Assembler le visuel si le microservice est disponible
  const assemblerOk = await checkAssemblerHealth();
  let visualUrls    = null;

  if (assemblerOk) {
    try {
      visualUrls = await assembleVisuals({
        client, mediaList, format, titre, caption, titres, captions
      });
      console.log(`🎨 ${visualUrls.length} visuel(s) généré(s) pour ${client.name}`);
    } catch(err) {
      console.error(`⚠️ Assembleur indisponible pour ${client.name}: ${err.message}`);
    }
  }

  // 7. Calculer l'heure de publication
  const scheduledAt = computeScheduledAt(primaryMedia.analyse_data, client);

  // 8. Insérer dans la queue
  const { data: queueItem, error } = await supabase
    .from('queue')
    .insert([{
      client_id:    client.id,
      type:         format === 'carousel' ? 'carousel' : format === 'story' ? 'reel' : 'post',
      statut:       'planifie',
      caption,
      scheduled_at: scheduledAt,
      source:       'ai_auto',
      media_id:     primaryMedia.id,
      media_ids:    mediaList.map(m => m.id),
      media_url:    visualUrls?.[0]  || primaryMedia.url,
      media_urls:   visualUrls       || mediaList.map(m => m.url),
    }])
    .select();

  if (error) throw new Error(`Erreur queue : ${error.message}`);

  // 9. Marquer les médias comme utilisés
  await markAsUsed(mediaList.map(m => m.id));

  console.log(`✅ ${client.name} — ${format} planifié pour ${scheduledAt}`);
  return {
    success:     true,
    client:      client.name,
    format,
    visual:      visualUrls ? 'generated' : 'raw_photo',
    scheduledAt,
    queueId:     queueItem[0].id
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline global — tous les clients actifs
// ─────────────────────────────────────────────────────────────────────────────
async function runAIPipeline() {
  console.log('🚀 Démarrage pipeline IA...');

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients?.length) return;

  const results = [];

  for (const client of clients) {
    try {
      // Vérifier si un post est déjà planifié dans les 20h
      const in20h = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
      const { data: pending } = await supabase
        .from('queue')
        .select('id')
        .eq('client_id', client.id)
        .eq('statut', 'planifie')
        .lte('scheduled_at', in20h)
        .limit(1);

      if (pending?.length > 0) {
        results.push({ client: client.name, skipped: true, reason: 'deja_planifie' });
        continue;
      }

      const result = await generateForClient(client);
      results.push(result);
      await new Promise(r => setTimeout(r, 2000));

    } catch(err) {
      console.error(`❌ ${client.name}:`, err.message);
      results.push({ client: client.name, error: err.message });
    }
  }

  const ok      = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  const errors  = results.filter(r => r.error).length;
  console.log(`\n📊 Pipeline — ✅ ${ok} · ⏭️ ${skipped} · ❌ ${errors}`);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes manuelles back office
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate/:clientId', async (req, res) => {
  try {
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', req.params.clientId).single();
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json(await generateForClient(client));
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    res.json({ success: true, results: await runAIPipeline() });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stock/:clientId', async (req, res) => {
  try {
    const count = await countAvailableMedia(req.params.clientId);
    const { format } = await decideFormat(req.params.clientId)
      .catch(() => ({ format: 'insuffisant' }));
    res.json({ available: count, format_possible: format });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/health', async (req, res) => {
  const assemblerOk = await checkAssemblerHealth();
  res.json({ pipeline: 'ok', assembler: assemblerOk ? 'ok' : 'unavailable' });
});

module.exports = router;
module.exports.runAIPipeline = runAIPipeline;