// routes/pipeline.js — Orchestrateur génération automatique de contenu IA
// Gère : single, story, carousel, reel, citation
// Feed pattern dynamique basé sur le style choisi par le client (A/B/C)
// Recyclage automatique des médias selon l'ancienneté du compte

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
// STYLES DE FEED
// A = Citations alternées : 50% citations · 17% single · 17% carousel · 16% reel
// B = Photos pures        : 33% single · 33% carousel · 34% reel
// C = Mix personnalisé    : défini par le client
// ─────────────────────────────────────────────────────────────────────────────
const FEED_STYLES = {
  A: { single: 17, carousel: 17, reel: 16, citation: 50 },
  B: { single: 33, carousel: 33, reel: 34, citation: 0  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Calcule l'intervalle de recyclage selon l'ancienneté du compte client
// ─────────────────────────────────────────────────────────────────────────────
function getRecycleInterval(client) {
  const createdAt = client.created_at ? new Date(client.created_at) : new Date();
  const ageMs     = Date.now() - createdAt.getTime();
  const ageDays   = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 90)  return 60;
  if (ageDays < 365) return 120;
  return 180;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recycle automatiquement les médias si stock faible
// ─────────────────────────────────────────────────────────────────────────────
async function autoRecycleIfNeeded(client) {
  const intervalDays = getRecycleInterval(client);
  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000).toISOString();
  const stock = await countAvailableMedia(client.id);

  if (stock >= 5) return 0;

  console.log(`♻️  ${client.name} — stock faible (${stock}), recyclage médias > ${intervalDays}j...`);

  const { data, error } = await supabase
    .from('media')
    .update({ used: false, used_at: null })
    .eq('client_id', client.id)
    .eq('used', true)
    .lt('used_at', cutoff)
    .select('id');

  if (error) {
    console.error(`❌ Erreur recyclage ${client.name}: ${error.message}`);
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    console.log(`✅ ${count} médias recyclés pour ${client.name} (intervalle ${intervalDays}j)`);
  } else {
    console.warn(`⚠️ Aucun média recyclable pour ${client.name}`);
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉCISION DU FORMAT selon le feed_style du client
// Lit le style A/B/C et calcule le déficit pour équilibrer la rotation
// ─────────────────────────────────────────────────────────────────────────────
async function decideNextFormat(clientId) {
  // Récupérer le feed_style du client
  const { data: clientData } = await supabase
    .from('clients')
    .select('feed_style, feed_style_custom')
    .eq('id', clientId)
    .single();

  const feedStyle = clientData?.feed_style || 'B';
  const custom    = clientData?.feed_style_custom || { single: 25, carousel: 25, reel: 25, citation: 25 };

  // Ratio cible selon le style
  const ratio = feedStyle === 'C' ? custom : (FEED_STYLES[feedStyle] || FEED_STYLES.B);

  // Récupérer les posts récents pour calculer le déficit
  const { data: recentPosts } = await supabase
    .from('queue')
    .select('type')
    .eq('client_id', clientId)
    .in('statut', ['publie', 'planifie'])
    .order('created_at', { ascending: false })
    .limit(20);

  const lastType = recentPosts?.[0]?.type;

  // Au démarrage → suivre l'ordre naturel du ratio
  if (!recentPosts || recentPosts.length < 3) {
    const sorted = Object.entries(ratio)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a);
    return sorted[0]?.[0] || 'single';
  }

  // Compter les formats récents
  const counts = { single: 0, carousel: 0, reel: 0, citation: 0 };
  for (const post of recentPosts) {
    const t = post.type;
    if (t === 'post' || t === 'single') counts.single++;
    else if (t === 'carousel')          counts.carousel++;
    else if (t === 'reel')              counts.reel++;
    else if (t === 'citation')          counts.citation++;
  }

  // Calculer le déficit par rapport au ratio cible
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const deficits = {};
  for (const [type, target] of Object.entries(ratio)) {
    if (target === 0) continue;
    const current = (counts[type] / total) * 100;
    deficits[type] = target - current;
  }

  // Ne pas répéter le même format 2 fois de suite
  const candidates = Object.entries(deficits)
    .filter(([type]) => type !== lastType)
    .sort(([, a], [, b]) => b - a);

  return candidates[0]?.[0] || 'single';
}

// ─────────────────────────────────────────────────────────────────────────────
// Génère une citation adaptée à l'univers du client
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
- Une sous-ligne optionnelle de max 8 mots

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

  // 2. Décider du format selon le feed_style du client
  let format = await decideNextFormat(client.id);
  console.log(`📐 Format décidé : ${format}`);

  const topPosts = await getTopPosts(client.id);
  let queueData  = {};

  // ── CAS CITATION ────────────────────────────────────────────────────────────
  if (format === 'citation') {
    // Vérifier ratio max 50% ce mois pour éviter la surcharge
    const ratio = await getCitationRatioThisMonth(client.id);
    if (ratio >= 0.55) {
      console.log(`📊 Trop de citations ce mois (${Math.round(ratio*100)}%) → fallback single`);
      format = 'single';
    } else {
      const citationData = await generateCitation(client, topPosts);

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
            mediaList:     [],
            format:        'citation',
            titre:         '',
            caption:       citationData.caption_post,
            citation_text: citationData.citation,
            sous_titre:    citationData.sous_titre,
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

      const { data: queueItem, error } = await supabase
        .from('queue').insert([queueData]).select();
      if (error) throw new Error(`Erreur queue citation : ${error.message}`);

      console.log(`✅ ${client.name} — citation planifiée pour ${scheduledAt}`);
      return {
        success:     true,
        client:      client.name,
        format:      'citation',
        scheduledAt,
        queueId:     queueItem[0].id
      };
    }
  }

  // ── CAS REEL ────────────────────────────────────────────────────────────────
  if (format === 'reel') {
    await autoRecycleIfNeeded(client);

    // Chercher une vidéo disponible
    const { data: videos } = await supabase
      .from('media')
      .select('*')
      .eq('client_id', client.id)
      .eq('type', 'video')
      .eq('used', false)
      .eq('reserved', false)
      .order('created_at', { ascending: true })
      .limit(5);

    if (!videos || videos.length === 0) {
      console.warn(`⚠️ ${client.name} — Aucune vidéo disponible pour reel → fallback single`);
      format = 'single';
    } else {
      const video = videos[Math.floor(Math.random() * videos.length)];

      // Réserver le média
      await supabase.from('media').update({
        reserved:    true,
        reserved_at: new Date().toISOString()
      }).eq('id', video.id);

      const caption     = await generateCaption(client, 'reel', topPosts);
      const scheduledAt = computeScheduledAt(video.analyse_data, client);

      // Marquer comme utilisé
      await supabase.from('media').update({
        used:         true,
        reserved:     false,
        reserved_at:  null,
        last_used_at: new Date().toISOString(),
        use_count:    (video.use_count || 0) + 1
      }).eq('id', video.id);

      queueData = {
        client_id:    client.id,
        type:         'reel',
        statut:       'planifie',
        caption,
        scheduled_at: scheduledAt,
        source:       'ai_auto',
        media_id:     video.id,
        media_url:    video.url,
        music_url:    null,
        music_title:  null,
      };

      const { data: queueItem, error } = await supabase
        .from('queue').insert([queueData]).select();
      if (error) throw new Error(`Erreur queue reel : ${error.message}`);

      console.log(`✅ ${client.name} — reel planifié pour ${scheduledAt}`);
      return {
        success:     true,
        client:      client.name,
        format:      'reel',
        scheduledAt,
        queueId:     queueItem[0].id
      };
    }
  }

  // ── CAS CAROUSEL ────────────────────────────────────────────────────────────
  if (format === 'carousel') {
    await autoRecycleIfNeeded(client);

    const stock = await countAvailableMedia(client.id);
    if (stock === 0) {
      console.warn(`⚠️ Stock vide pour ${client.name} → skipped`);
      return { skipped: true, reason: 'stock_vide' };
    }

    // Aria décide combien de photos selon le stock disponible
    const nbPhotos = stock >= 5 ? Math.floor(Math.random() * 3) + 3  // 3, 4 ou 5
                   : stock >= 3 ? 3
                   : stock >= 2 ? 2
                   : 1;

    if (nbPhotos < 2) {
      console.warn(`⚠️ ${client.name} — Pas assez de photos pour carousel → fallback single`);
      format = 'single';
    } else {
      const mediaList    = await selectBestMedia(client.id, { count: nbPhotos, format: 'carousel' });
      const primaryMedia = mediaList[0];

      const texts        = await generateCarouselTexts(client, mediaList, topPosts);
      const titre        = texts.titres[0];
      const caption      = texts.caption_principale || await generateCaption(client, 'carousel', topPosts);
      const titres       = texts.titres;
      const captions     = texts.captions;

      const scheduledAt  = computeScheduledAt(primaryMedia.analyse_data, client);
      let   visualUrls   = null;

      const assemblerOk = await checkAssemblerHealth();
      if (assemblerOk) {
        try {
          visualUrls = await assembleVisuals({
            client, mediaList, format: 'carousel', titre, caption, titres, captions
          });
          console.log(`🎨 ${visualUrls.length} visuel(s) carousel pour ${client.name}`);
        } catch(err) {
          console.error(`⚠️ Assembleur carousel: ${err.message}`);
        }
      }

      const finalMediaUrl  = visualUrls?.[0]  || primaryMedia.url || null;
      const finalMediaUrls = visualUrls        || mediaList.map(m => m.url).filter(Boolean);

      if (!finalMediaUrl) {
        console.error(`❌ Aucune URL média pour carousel ${client.name}`);
        return { skipped: true, reason: 'no_media_url' };
      }

      await markAsUsed(mediaList.map(m => m.id));

      queueData = {
        client_id:    client.id,
        type:         'carousel',
        statut:       'planifie',
        caption,
        scheduled_at: scheduledAt,
        source:       'ai_auto',
        media_id:     primaryMedia.id,
        media_ids:    mediaList.map(m => m.id),
        media_url:    finalMediaUrl,
        media_urls:   finalMediaUrls,
      };

      const { data: queueItem, error } = await supabase
        .from('queue').insert([queueData]).select();
      if (error) throw new Error(`Erreur queue carousel : ${error.message}`);

      console.log(`✅ ${client.name} — carousel ${nbPhotos} photos planifié pour ${scheduledAt}`);
      return {
        success:     true,
        client:      client.name,
        format:      'carousel',
        nbPhotos,
        scheduledAt,
        queueId:     queueItem[0].id
      };
    }
  }

  // ── CAS SINGLE (photo simple) — fallback final ────────────────────────────
  await autoRecycleIfNeeded(client);

  const stock = await countAvailableMedia(client.id);
  if (stock === 0) {
    const intervalDays = getRecycleInterval(client);
    console.warn(`⚠️ Contenu faible pour ${client.name} (0 médias restants) — tous utilisés dans les ${intervalDays}j`);
    return { skipped: true, reason: 'stock_vide' };
  }

  if (stock <= 2) {
    console.warn(`⚠️ Contenu faible pour ${client.name} (${stock} médias restants)`);
  }

  const mediaList    = await selectBestMedia(client.id, { count: 1, format: 'single' });
  const primaryMedia = mediaList[0];
  const caption      = await generateCaption(client, 'post carré', topPosts);
  const titre        = caption.split(/[.!?]/)[0].replace(/[#@]/g,'').trim().slice(0, 60);
  const scheduledAt  = computeScheduledAt(primaryMedia.analyse_data, client);
  let   visualUrls   = null;

  const assemblerOk = await checkAssemblerHealth();
  if (assemblerOk) {
    try {
      visualUrls = await assembleVisuals({
        client, mediaList, format: 'single', titre, caption
      });
    } catch(err) {
      console.error(`⚠️ Assembleur single: ${err.message}`);
    }
  }

  const finalMediaUrl = visualUrls?.[0] || primaryMedia.url || null;
  if (!finalMediaUrl) {
    console.error(`❌ Aucune URL média pour ${client.name}`);
    return { skipped: true, reason: 'no_media_url' };
  }

  await markAsUsed(mediaList.map(m => m.id));

  queueData = {
    client_id:    client.id,
    type:         'post',
    statut:       'planifie',
    caption,
    scheduled_at: scheduledAt,
    source:       'ai_auto',
    media_id:     primaryMedia.id,
    media_ids:    mediaList.map(m => m.id),
    media_url:    finalMediaUrl,
    media_urls:   [finalMediaUrl],
  };

  const { data: queueItem, error } = await supabase
    .from('queue').insert([queueData]).select();
  if (error) throw new Error(`Erreur queue : ${error.message}`);

  console.log(`✅ ${client.name} — single planifié pour ${scheduledAt}`);
  return {
    success:     true,
    client:      client.name,
    format:      'single',
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
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', req.params.clientId).single();
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    const count    = await countAvailableMedia(client.id);
    const format   = await decideNextFormat(client.id).catch(() => 'unknown');
    const interval = getRecycleInterval(client);
    res.json({ available: count, next_format: format, recycle_interval_days: interval });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/health', async (req, res) => {
  const assemblerOk = await checkAssemblerHealth();
  res.json({ pipeline: 'ok', assembler: assemblerOk ? 'ok' : 'unavailable' });
});

router.post('/recycle/:clientId', async (req, res) => {
  try {
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', req.params.clientId).single();
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    const intervalDays = getRecycleInterval(client);
    const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('media')
      .update({ used: false, used_at: null })
      .eq('client_id', client.id)
      .eq('used', true)
      .lt('used_at', cutoff)
      .select('id');
    if (error) throw new Error(error.message);
    res.json({ recycled: data?.length || 0, interval_days: intervalDays });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.runAIPipeline = runAIPipeline;