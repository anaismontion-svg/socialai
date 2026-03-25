// routes/feed.js — Feed pattern adaptatif + génération de posts citation

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Analyse les performances des 20 derniers posts pour décider le prochain type
// Règles :
//   - Jamais 2 citations d'affilée
//   - Jamais 3 photos d'affilée sans citation
//   - Si les citations performent mieux → augmenter leur fréquence
//   - Si les photos performent mieux → réduire les citations
// ─────────────────────────────────────────────────────────────────────────────
async function decideNextPostType(clientId) {
  // Récupérer les 20 derniers posts
  const { data: history } = await supabase
    .from('feed_history')
    .select('post_type, engagement_score')
    .eq('client_id', clientId)
    .order('published_at', { ascending: false })
    .limit(20);

  // Pas d'historique → commencer par une photo
  if (!history || history.length === 0) return 'photo';

  const lastPost       = history[0];
  const last3          = history.slice(0, 3).map(h => h.post_type);
  const last2Citations = last3.slice(0, 2).every(t => t === 'citation');
  const last3Photos    = last3.every(t => t === 'photo' || t === 'carousel');

  // Règle absolue : jamais 2 citations d'affilée
  if (lastPost.post_type === 'citation') return 'photo';

  // Règle absolue : après 3 photos/carousels → forcer une citation
  if (last3Photos) return 'citation';

  // Analyse des performances moyennes par type
  const photoEngagement    = avgEngagement(history, ['photo', 'carousel', 'story', 'reel']);
  const citationEngagement = avgEngagement(history, ['citation']);

  // Si on n'a pas encore assez de données sur les citations → en insérer une
  const citationCount = history.filter(h => h.post_type === 'citation').length;
  if (citationCount < 3) return 'citation';

  // Décision basée sur les performances
  const ratio = citationEngagement > 0
    ? citationEngagement / (photoEngagement || 1)
    : 0;

  // Citations performent 20%+ mieux → 1 citation toutes les 2 photos
  if (ratio > 1.2) {
    const photosSinceLastCitation = history.findIndex(h => h.post_type === 'citation');
    if (photosSinceLastCitation >= 2) return 'citation';
  }

  // Citations performent moins bien → 1 citation toutes les 4 photos
  const photosSinceLastCitation = history.findIndex(h => h.post_type === 'citation');
  if (photosSinceLastCitation >= 4) return 'citation';

  return 'photo';
}

function avgEngagement(history, types) {
  const posts = history.filter(h => types.includes(h.post_type) && h.engagement_score > 0);
  if (!posts.length) return 0;
  return posts.reduce((sum, p) => sum + p.engagement_score, 0) / posts.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Génère un batch de 5 citations via Claude pour un client
// Stockées en base, consommées une par une par le pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function generateCitations(client, count = 5) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Tu es expert en community management Instagram.

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Description : ${client.description || ''}
Ton : ${client.tone || 'chaleureux et professionnel'}

Génère ${count} citations percutantes pour des posts Instagram de type "citation visuelle".
Ces citations doivent :
- Refléter l'univers et les valeurs de ce client
- Inspirer, émouvoir ou faire sourire
- NE JAMAIS être commerciales ("achetez", "commandez", "prix"...)
- Mettre en valeur le savoir-faire, la passion, l'authenticité
- Être courtes : 1 à 2 phrases maximum (15 mots max)
- Pouvoir être lues en 3 secondes sur un écran

Exemples de bons styles selon le secteur :
- Chatterie : "Chaque chaton porte en lui une histoire d'amour qui n'attend que vous."
- Boulangerie : "Le bon pain, c'est celui qui sent la maison avant même d'entrer."
- Coach sport : "Le plus grand défi, c'est de commencer. Le reste, c'est du mouvement."
- Beauté : "Prendre soin de soi, c'est la première forme de respect."

Réponds UNIQUEMENT en JSON valide :
["citation 1", "citation 2", "citation 3", "citation 4", "citation 5"]`
    }]
  });

  try {
    const citations = JSON.parse(message.content[0].text);
    // Sauvegarder en base
    const rows = citations.map(texte => ({
      client_id: client.id,
      texte,
      used: false
    }));
    await supabase.from('citations').insert(rows);
    console.log(`✍️ ${citations.length} citations générées pour ${client.name}`);
    return citations;
  } catch(e) {
    throw new Error('Erreur parsing citations : ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Récupère la prochaine citation disponible
// Si le stock est vide → en génère 5 nouvelles
// ─────────────────────────────────────────────────────────────────────────────
async function getNextCitation(client) {
  // Chercher une citation non utilisée
  const { data: available } = await supabase
    .from('citations')
    .select('*')
    .eq('client_id', client.id)
    .eq('used', false)
    .order('created_at', { ascending: true })
    .limit(1);

  if (available && available.length > 0) {
    return available[0];
  }

  // Stock vide → générer un nouveau batch
  console.log(`📝 Stock citations vide pour ${client.name} — génération...`);
  await generateCitations(client, 5);

  // Récupérer la première
  const { data: fresh } = await supabase
    .from('citations')
    .select('*')
    .eq('client_id', client.id)
    .eq('used', false)
    .order('created_at', { ascending: true })
    .limit(1);

  return fresh?.[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marque une citation comme utilisée
// ─────────────────────────────────────────────────────────────────────────────
async function markCitationUsed(citationId) {
  await supabase
    .from('citations')
    .update({ used: true })
    .eq('id', citationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enregistre un post dans l'historique du feed
// ─────────────────────────────────────────────────────────────────────────────
async function recordFeedPost(clientId, postType, format, queueId, metaPostId = null) {
  const { error } = await supabase
    .from('feed_history')
    .insert([{
      client_id:    clientId,
      queue_id:     queueId,
      post_type:    postType,
      format,
      meta_post_id: metaPostId,
      published_at: new Date().toISOString()
    }]);

  if (error) console.error('❌ Erreur feed_history:', error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Met à jour les métriques d'un post 48h après publication
// Appelé par un cron dans server.js
// ─────────────────────────────────────────────────────────────────────────────
async function updatePostMetrics(accessToken, metaPostId, feedHistoryId) {
  try {
    const axios = require('axios');
    const { data } = await axios.get(
      `https://graph.instagram.com/v19.0/${metaPostId}/insights`,
      {
        params: {
          metric:       'reach,impressions,likes_count,comments_count,saved,shares',
          access_token: accessToken
        }
      }
    );

    const metrics = {};
    data.data?.forEach(m => { metrics[m.name] = m.values?.[0]?.value || 0; });

    const reach    = metrics.reach || 0;
    const likes    = metrics.likes_count || 0;
    const comments = metrics.comments_count || 0;
    const saves    = metrics.saved || 0;
    const shares   = metrics.shares || 0;

    // Score d'engagement pondéré
    const engagement_score = reach > 0
      ? ((likes * 1) + (comments * 3) + (saves * 5) + (shares * 4)) / reach * 100
      : 0;

    await supabase
      .from('feed_history')
      .update({ reach, likes, comments, saves, shares, engagement_score })
      .eq('id', feedHistoryId);

    console.log(`📊 Métriques mises à jour pour post ${metaPostId} — score: ${engagement_score.toFixed(2)}`);
  } catch(err) {
    console.error(`❌ Erreur métriques ${metaPostId}:`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron : met à jour les métriques des posts publiés il y a 48h
// ─────────────────────────────────────────────────────────────────────────────
async function syncPostMetrics() {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const twentyDaysAgo      = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

  // Posts publiés entre 48h et 20 jours (Meta API limite à 30 jours)
  const { data: posts } = await supabase
    .from('feed_history')
    .select('id, client_id, meta_post_id, engagement_score')
    .not('meta_post_id', 'is', null)
    .lte('published_at', fortyEightHoursAgo)
    .gte('published_at', twentyDaysAgo)
    .eq('engagement_score', 0); // Pas encore mis à jour

  if (!posts?.length) return;
  console.log(`📈 Mise à jour métriques pour ${posts.length} posts...`);

  for (const post of posts) {
    const { data: account } = await supabase
      .from('social_accounts')
      .select('access_token')
      .eq('client_id', post.client_id)
      .eq('platform', 'instagram')
      .single();

    if (account?.access_token) {
      await updatePostMetrics(account.access_token, post.meta_post_id, post.id);
      await new Promise(r => setTimeout(r, 1000)); // Pause entre appels API
    }
  }
}

module.exports = {
  decideNextPostType,
  getNextCitation,
  markCitationUsed,
  recordFeedPost,
  syncPostMetrics,
  generateCitations
};