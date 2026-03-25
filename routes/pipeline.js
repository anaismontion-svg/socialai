// routes/pipeline.js — Orchestrateur génération automatique de contenu IA
// Gère : single, story, carousel, citation
// Feed pattern dynamique basé sur les performances réelles

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
// Analyse les performances récentes pour décider du prochain format
// Logique : on regarde les 10 derniers posts publiés, on calcule
// l'engagement moyen par format, et on choisit ce qui performe le mieux
// tout en respectant la règle : pas 2 citations consécutives
// ─────────────────────────────────────────────────────────────────────────────
async function decideNextFormat(clientId) {
  // Récupérer les 10 derniers posts publiés avec leurs stats
  const { data: recentPosts } = await supabase
    .from('queue')
    .select('type, likes, comments, reach, saves, source')
    .eq('client_id', clientId)
    .eq('statut', 'publie')
    .order('published_at', { ascending: false })
    .limit(10);

  // Récupérer le dernier post pour éviter les répétitions
  const lastPost = recentPosts?.[0];
  const lastType = lastPost?.type || null;

  // Si pas assez d'historique → pattern par défaut
  if (!recentPosts || recentPosts.length < 3) {
    const defaults = ['single', 'citation', 'single', 'carousel', 'citation', 'story'];
    const idx      = (recentPosts?.length || 0) % defaults.length;
    return defaults[idx];
  }

  // Calculer le score d'engagement par format
  // Score = (likes * 1) + (comments * 3) + (saves * 5) + (reach * 0.01)
  const scores = {};
  const counts = {};

  for (const post of recentPosts) {
    const type  = post.type || 'single';
    const score = (post.likes || 0) * 1
                + (post.comments || 0) * 3
                + (post.saves || 0) * 5
                + (post.reach || 0) * 0.01;

    if (!scores[type]) { scores[type] = 0; counts[type] = 0; }
    scores[type] += score;
    counts[type] += 1;
  }

  // Moyennes
  const averages = {};
  for (const type of Object.keys(scores)) {
    averages[type] = scores[type] / counts[type];
  }

  // Formats disponibles (hors citation si le dernier était une citation)
  const allFormats = ['single', 'story', 'carousel', 'citation'];
  const available  = allFormats.filter(f => {
    if (f === 'citation' && lastType === 'citation') return false; // pas 2 citations consécutives
    if (f === 'carousel') return true; // toujours proposer le carousel
    return true;
  });

  // Trier par performance (les formats inconnus reçoivent un score neutre de 50)
  available.sort((a, b) => (averages[b] || 50) - (averages[a] || 50));

  // Introduire un peu d'aléatoire pour varier (80% meilleur format, 20% 2ème)
  if (available.length > 1 && Math.random() < 0.2) {
    return available[1];
  }

  return available[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Génère une citation adaptée à l'univers du client
// Règle éditoriale : jamais "achetez chez nous"
// Toujours : inspiration, savoir-faire, invitation douce
// ─────────────────────────────────────────────────────────────────────────────
async function generateCitation(client, topPosts) {
  const topCtx = topPosts.slice(0, 3).length > 0
    ? `\nMeilleurs posts récents :\n${topPosts.slice(0,3).map(p => `- "${p.caption}"`).join('\n')}`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Tu es expert en community management Instagram pour des petites entreprises.

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Ton : ${client.tone || 'chaleureux et professionnel'}
${topCtx}

Génère UNE citation courte et percutante pour un post Instagram "citation" (fond coloré, pas de photo).

RÈGLES ÉDITORIALES ABSOLUES :
- Ne JAMAIS dire "achetez chez nous", "commandez", "prix", "tarif", "promotion"
- Toujours inspirer, valoriser le savoir-faire, inviter doucement au contact
- Style : "Si vous rêvez de X, nous sommes là", "Le bonheur c'est...", "Chaque Y mérite..."
- Maximum 20 mots pour la citation
- Une sous-ligne optionnelle de max 8 mots (peut inclure "Contactez-nous" ou "On vous attend")

Réponds UNIQUEMENT en JSON valide :
{
  "citation": "La citation principale ici",
  "sous_titre": "Sous-ligne optionnelle ici",
  "caption_post": "Caption complète pour le post avec 3-4 hashtags"
}`
    }]
  });

  try {
    return JSON.parse(message.content[0].text);
  } catch {
    return {
      citation:     `Le bonheur s'apprivoise, une journée à la fois.`,
      sous_titre:   client.name,
      caption_post: `Bienvenue dans notre univers ✨ #${(client.sector||'passion').replace(/\s/g,'')} #artisan`
    };
  }
}

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

Génère un titre accrocheur et une courte caption (max 12 mots) pour chacune des ${mediaList.length} slides.
RÈGLE : jamais de "achetez", "commandez", "prix". Valorise le savoir-faire.
Réponds UNIQUEMENT en JSON valide :
{
  "titres":   ["Titre slide 1", "Titre slide 2"],
  "captions": ["Caption slide 1", "Caption slide 2"],
  "caption_principale": "Caption complète avec hashtags"
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
  const slot   = slots[(client.sector||'').toLowerCase()] || slots.default;
  const [h, m] = slot.split(':').map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Compte combien de citations ont été publiées ce mois
// Pour ne pas en faire trop (max 30% des posts)
// ─────────────────────────────────────────────────────────────────────────────
async function getCitationRatioThisMonth(clientId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('queue')
    .select('type')
    .eq('client_id', clientId)
    .eq('statut', 'publie')
    .gte('published_at', startOfMonth.toISOString());

  if (!data || data.length === 0) return 0;
  const citations = data.filter(p => p.type === 'citation').length;
  return citations / data.length;
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

  // 2. Décider du format selon les performances
  let format = await decideNextFormat(client.id);

  // 3. Si citation → vérifier le ratio (max 30% ce mois)
  if (format === 'citation') {
    const ratio = await getCitationRatioThisMonth(client.id);
    if (ratio >= 0.30) {
      console.log(`📊 Trop de citations ce mois (${Math.round(ratio*100)}%) → fallback photo`);
      format = 'single';
    }
  }

  console.log(`📐 Format décidé : ${format}`);

  // 4. Générer selon le format
  const topPosts = await getTopPosts(client.id);
  let queueData  = {};

  // ── CAS CITATION — pas de photo ────────────────────────────────────────────
  if (format === 'citation') {
    const citationData = await generateCitation(client, topPosts);

    // Compter les citations précédentes pour varier les variantes visuelles
    const { count: citCount } = await supabase
      .from('queue')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('type', 'citation');

    const variant      = (citCount || 0) % 3;
    const scheduledAt  = computeScheduledAt(null, client);
    let   visualUrl    = null;

    const assemblerOk = await checkAssemblerHealth();
    if (assemblerOk) {
      try {
        const urls = await assembleVisuals({
          client,
          mediaList:    [],
          format:       'citation',
          titre:        '',
          caption:      citationData.caption_post,
          citation_text: citationData.citation,
          sous_titre:   citationData.sous_titre,
          variant
        });
        visualUrl = urls?.[0] || null;
      } catch(err) {
        console.error(`⚠️ Assembleur citation: ${err.message}`);
      }
    }

    queueData = {
      client_id:    client.id,
      type:         'citation',
      statut:       'planifie',
      caption:      citationData.caption_post,
      scheduled_at: scheduledAt,
      source:       'ai_auto',
      media_url:    visualUrl,
    };

  // ── CAS PHOTO (single, story, carousel) ───────────────────────────────────
  } else {
    const stock = await countAvailableMedia(client.id);
    if (stock === 0) {
      console.warn(`⚠️ Stock vide pour ${client.name}`);
      return { skipped: true, reason: 'stock_vide' };
    }

    // Adapter le count selon le format
    const countMap = { single: 1, story: 1, carousel: 3 };
    const count    = countMap[format] || 1;

    const mediaList    = await selectBestMedia(client.id, { count, format });
    const primaryMedia = mediaList[0];
    let   titre, caption, titres, captions;

    if (format === 'carousel') {
      const texts = await generateCarouselTexts(client, mediaList, topPosts);
      titres   = texts.titres;
      captions = texts.captions;
      titre    = titres[0];
      caption  = texts.caption_principale
                 || await generateCaption(client, 'carousel', topPosts);
    } else {
      const mediaType = format === 'story' ? 'story verticale' : 'post carré';
      caption = await generateCaption(client, mediaType, topPosts);
      titre   = caption.split(/[.!?]/)[0].replace(/[#@]/g,'').trim().slice(0, 60);
    }

    const scheduledAt = computeScheduledAt(primaryMedia.analyse_data, client);
    let   visualUrls  = null;

    const assemblerOk = await checkAssemblerHealth();
    if (assemblerOk) {
      try {
        visualUrls = await assembleVisuals({
          client, mediaList, format, titre, caption, titres, captions
        });
        console.log(`🎨 ${visualUrls.length} visuel(s) pour ${client.name}`);
      } catch(err) {
        console.error(`⚠️ Assembleur: ${err.message}`);
      }
    }

    await markAsUsed(mediaList.map(m => m.id));

    queueData = {
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
    };
  }

  const { data: queueItem, error } = await supabase
    .from('queue').insert([queueData]).select();
  if (error) throw new Error(`Erreur queue : ${error.message}`);

  console.log(`✅ ${client.name} — ${format} planifié pour ${queueData.scheduled_at}`);
  return {
    success:     true,
    client:      client.name,
    format,
    scheduledAt: queueData.scheduled_at,
    queueId:     queueItem[0].id
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline global — tous les clients actifs
// ─────────────────────────────────────────────────────────────────────────────
async function runAIPipeline() {
  console.log('🚀 Démarrage pipeline IA...');

  const { data: clients } = await supabase
    .from('clients').select('*').eq('status', 'active');

  if (!clients?.length) return;

  const results = [];

  for (const client of clients) {
    try {
      const in20h = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
      const { data: pending } = await supabase
        .from('queue').select('id')
        .eq('client_id', client.id)
        .eq('statut', 'planifie')
        .lte('scheduled_at', in20h)
        .limit(1);

      if (pending?.length > 0) {
        results.push({ client: client.name, skipped: true, reason: 'deja_planifie' });
        continue;
      }

      results.push(await generateForClient(client));
      await new Promise(r => setTimeout(r, 2000));

    } catch(err) {
      console.error(`❌ ${client.name}:`, err.message);
      results.push({ client: client.name, error: err.message });
    }
  }

  const ok      = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  const errors  = results.filter(r => r.error).length;
  console.log(`📊 Pipeline — ✅ ${ok} · ⏭️ ${skipped} · ❌ ${errors}`);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes manuelles
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate/:clientId', async (req, res) => {
  try {
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', req.params.clientId).single();
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json(await generateForClient(client));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/run', async (req, res) => {
  try { res.json({ success: true, results: await runAIPipeline() }); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/stock/:clientId', async (req, res) => {
  try {
    const count = await countAvailableMedia(req.params.clientId);
    const format = await decideNextFormat(req.params.clientId).catch(() => 'unknown');
    res.json({ available: count, next_format: format });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/health', async (req, res) => {
  const assemblerOk = await checkAssemblerHealth();
  res.json({ pipeline: 'ok', assembler: assemblerOk ? 'ok' : 'unavailable' });
});

module.exports = router;
module.exports.runAIPipeline = runAIPipeline;