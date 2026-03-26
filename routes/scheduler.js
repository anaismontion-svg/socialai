const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');
const { syncAllClients, updateAllStats, recalculateScores } = require('./instagram-sync');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BEST_HOURS = {
  post:  [9, 12, 18, 20],
  story: [8, 12, 17, 21]
};

// ─────────────────────────────────────────────
// DÉFINITION DES FORFAITS
// ─────────────────────────────────────────────
const PLANS = {
  starter: {
    postsPerWeek:        3,
    storiesPerDay:       1,
    recyclage:           false,
    reponseDM:           false,
    reponseCommentaires: false,
    postsSpeciauxMax:    1,
    analyseHistorique:   true,
    voirModifierPosts:   1,
  },
  pro: {
    postsPerWeek:        7,
    storiesPerDay:       1,
    recyclage:           true,
    reponseDM:           true,
    reponseCommentaires: true,
    postsSpeciauxMax:    999,
    analyseHistorique:   true,
    voirModifierPosts:   999,
  }
};

function getPlan(client) {
  const plan = (client.plan || 'starter').toLowerCase();
  return PLANS[plan] || PLANS.starter;
}

// ─────────────────────────────────────────────
// UTILITAIRES DATES
// ─────────────────────────────────────────────
function getNextPublishDate(lastDate, frequency) {
  const date = new Date(lastDate || Date.now());
  if (frequency === 'daily') {
    date.setDate(date.getDate() + 1);
  } else if (frequency === '3x_week') {
    const day = date.getDay();
    if      (day < 1) date.setDate(date.getDate() + (1 - day));
    else if (day < 3) date.setDate(date.getDate() + (3 - day));
    else if (day < 5) date.setDate(date.getDate() + (5 - day));
    else              date.setDate(date.getDate() + (8 - day));
  }
  const hour = BEST_HOURS.post[Math.floor(Math.random() * BEST_HOURS.post.length)];
  date.setHours(hour, 0, 0, 0);
  return date;
}

function getStoryTime(storyIndex) {
  const now  = new Date();
  const hour = BEST_HOURS.story[storyIndex] || BEST_HOURS.story[0];
  now.setHours(hour, 0, 0, 0);
  return now;
}

async function getClientFrequency(client) {
  const plan = getPlan(client);
  if (plan.postsPerWeek >= 7) return 'daily';
  return '3x_week';
}

// ─────────────────────────────────────────────
// MÉDIAS DISPONIBLES
// ✅ FIX : ne filtre plus par story_type — prend n'importe quel média dispo
// ─────────────────────────────────────────────
async function getAvailableMedia(clientId) {
  const { data } = await supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('used', false)
    .order('potentiel_viral', { ascending: false }) // meilleurs médias en premier
    .limit(1);
  return data?.[0] || null;
}

// ─────────────────────────────────────────────
// RECYCLAGE PRO
// ─────────────────────────────────────────────
async function selectRecyclablePost(clientId) {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data: recentRecycled } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', clientId)
    .eq('type', 'recycled')
    .gte('created_at', oneWeekAgo.toISOString());

  if (recentRecycled && recentRecycled.length > 0) {
    console.log('⏭️ Un post recyclé a déjà été planifié cette semaine');
    return null;
  }

  const { data: topPosts } = await supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_top_content', true)
    .eq('recycled', false)
    .lt('original_post_date', twoMonthsAgo.toISOString())
    .order('performance_score', { ascending: false })
    .limit(10);

  if (!topPosts || topPosts.length === 0) return null;
  return topPosts[0];
}

async function generateRecycledCaption(originalCaption, client, performanceScore, postStats) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const statsContext = postStats
    ? `Stats : ${postStats.likes} likes | ${postStats.comments} commentaires | ${postStats.reach} reach`
    : '';
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Tu es expert en community management Instagram.
Ce post a obtenu un score de ${performanceScore}/100. ${statsContext}
Client : ${client.name} | Secteur : ${client.sector || 'non précisé'} | Ton : ${client.tone || 'professionnel'}
Caption originale : "${originalCaption}"
Réécris cette caption pour la rendre encore plus engageante. Max 150 mots.
Retourne uniquement la nouvelle caption.`
    }]
  });
  return message.content[0].text;
}

// ─────────────────────────────────────────────
// PLANIFICATION POSTS — 1 CLIENT
// ─────────────────────────────────────────────
async function schedulePostsForClient(client) {
  if (client.status === 'paused') {
    console.log(`⏸️ ${client.name} est en pause — planification ignorée`);
    return;
  }

  console.log(`📅 Planification pour ${client.name} (${client.plan || 'starter'})...`);

  const plan          = getPlan(client);
  const frequency     = await getClientFrequency(client);
  const targetPerWeek = plan.postsPerWeek;
  const nextWeek      = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  const { data: existingPosts } = await supabase
    .from('queue')
    .select('id, scheduled_at')
    .eq('client_id', client.id)
    .eq('statut', 'planifie')
    .in('type', ['post', 'recycled'])
    .lte('scheduled_at', nextWeek.toISOString());

  if (existingPosts && existingPosts.length >= targetPerWeek) {
    console.log(`✅ ${client.name} a déjà ${existingPosts.length} posts planifiés`);
    return;
  }

  const toCreate   = targetPerWeek - (existingPosts?.length || 0);
  const { data: lastPost } = await supabase
    .from('queue')
    .select('scheduled_at')
    .eq('client_id', client.id)
    .in('type', ['post', 'recycled'])
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let lastDate    = lastPost?.[0]?.scheduled_at || new Date();
  const recycleIndex = plan.recyclage ? Math.floor(toCreate / 2) : -1;

  for (let i = 0; i < toCreate; i++) {
    const scheduledAt = getNextPublishDate(lastDate, frequency);
    lastDate = scheduledAt;

    let media    = null;
    let caption  = '';
    let postType = 'post';

    // Recyclage PRO
    if (i === recycleIndex && plan.recyclage) {
      const recyclable = await selectRecyclablePost(client.id);
      if (recyclable) {
        media    = recyclable;
        caption  = await generateRecycledCaption(
          recyclable.caption, client, recyclable.performance_score,
          { likes: recyclable.likes, comments: recyclable.comments, reach: recyclable.reach }
        );
        postType = 'recycled';
        await supabase.from('media').update({
          recycled:     true,
          last_used_at: new Date().toISOString(),
          use_count:    (recyclable.use_count || 0) + 1
        }).eq('id', recyclable.id);
        console.log(`♻️ Post recyclé planifié pour ${client.name} (score: ${recyclable.performance_score}/100)`);
      }
    }

    // Nouveau média
    if (!media) {
      media   = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption  = await generateCaption(client, 'image', topPosts);
      postType = 'post';
    }

    // ✅ FIX : ne jamais insérer sans media_url si media existe
    const mediaUrl = media?.url || null;
    if (!mediaUrl) {
      console.warn(`⚠️ ${client.name} — aucun média disponible, post ignoré`);
      continue;
    }

    await supabase.from('queue').insert({
      client_id:    client.id,
      media_id:     media?.id   || null,
      media_url:    mediaUrl,
      caption,
      scheduled_at: scheduledAt.toISOString(),
      type:         postType,
      platform:     'instagram',
      statut:       'planifie'
    });

    console.log(`📌 Post "${postType}" planifié pour ${client.name} le ${scheduledAt.toLocaleDateString('fr-FR')}`);
  }
}

// ─────────────────────────────────────────────
// PLANIFICATION STORIES — 1 CLIENT
// ✅ FIX MAJEUR : ne crée une story QUE si on a un média avec une URL valide
// ─────────────────────────────────────────────
async function scheduleStoriesForClient(client) {
  if (client.status === 'paused') return;

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const { data: existingStories } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .eq('statut', 'planifie')
    .gte('scheduled_at', today.toISOString())
    .lt('scheduled_at', tomorrow.toISOString());

  if (existingStories && existingStories.length >= 4) return;

  const storyTypes = [
    { type: 'entreprise',  label: 'Story entreprise' },
    { type: 'tarifs',      label: 'Story tarifs' },
    { type: 'avant_apres', label: 'Story avant/après' },
    { type: 'repost',      label: 'Repost du post du jour' }
  ];

  for (let i = 0; i < storyTypes.length; i++) {
    const storyDef    = storyTypes[i];
    const scheduledAt = getStoryTime(i);

    // ✅ FIX : chercher n'importe quel média disponible (pas de filtre story_type)
    let mediaUrl = null;
    let mediaId  = null;

    if (storyDef.type === 'repost') {
      // Pour le repost : utiliser le post du jour si disponible
      const { data: todayPost } = await supabase
        .from('queue')
        .select('media_url, media_id')
        .eq('client_id', client.id)
        .eq('type', 'post')
        .gte('scheduled_at', today.toISOString())
        .lt('scheduled_at', tomorrow.toISOString())
        .not('media_url', 'is', null)
        .limit(1);

      if (todayPost?.[0]?.media_url) {
        mediaUrl = todayPost[0].media_url;
        mediaId  = todayPost[0].media_id;
      }
    }

    // Fallback : prendre n'importe quel média disponible
    if (!mediaUrl) {
      const media = await getAvailableMedia(client.id);
      if (media?.url) {
        mediaUrl = media.url;
        mediaId  = media.id;
      }
    }

    // ✅ FIX CLEF : si toujours pas de média, on n'insère PAS la story
    if (!mediaUrl) {
      console.warn(`⚠️ ${client.name} — story "${storyDef.label}" ignorée : aucun média disponible`);
      continue;
    }

    await supabase.from('queue').insert({
      client_id:    client.id,
      media_id:     mediaId,
      media_url:    mediaUrl,
      caption:      storyDef.label,
      scheduled_at: scheduledAt.toISOString(),
      type:         'story',
      platform:     'instagram',
      statut:       'planifie'
    });

    console.log(`📸 Story "${storyDef.label}" planifiée pour ${client.name}`);
  }
}

// ─────────────────────────────────────────────
// PLANIFICATEUR PRINCIPAL
// ─────────────────────────────────────────────
async function runScheduler() {
  console.log('🗓️ Lancement du planificateur...');

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .in('status', ['active', 'paused']);

  if (!clients || clients.length === 0) {
    console.log('Aucun client trouvé');
    return;
  }

  for (const client of clients) {
    try {
      await schedulePostsForClient(client);
      await scheduleStoriesForClient(client);
    } catch (err) {
      console.error(`❌ Erreur planification pour ${client.name}:`, err.message);
    }
  }

  console.log('✅ Planificateur terminé');
}

module.exports = {
  runScheduler,
  schedulePostsForClient,
  scheduleStoriesForClient,
  selectRecyclablePost,
  generateRecycledCaption,
  getPlan,
  PLANS
};