const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BEST_HOURS = {
  post: [9, 12, 18, 20],
  story: [8, 12, 17, 21]
};

function getNextPublishDate(lastDate, frequency) {
  const date = new Date(lastDate || Date.now());
  if(frequency === 'daily') {
    date.setDate(date.getDate() + 1);
  } else if(frequency === '3x_week') {
    const day = date.getDay();
    if(day < 1) date.setDate(date.getDate() + (1 - day));
    else if(day < 3) date.setDate(date.getDate() + (3 - day));
    else if(day < 5) date.setDate(date.getDate() + (5 - day));
    else date.setDate(date.getDate() + (8 - day));
  }
  const hour = BEST_HOURS.post[Math.floor(Math.random() * BEST_HOURS.post.length)];
  date.setHours(hour, 0, 0, 0);
  return date;
}

function getStoryTime(storyIndex) {
  const now = new Date();
  const hour = BEST_HOURS.story[storyIndex] || BEST_HOURS.story[0];
  now.setHours(hour, 0, 0, 0);
  return now;
}

async function getClientPhase(client) {
  const createdAt = new Date(client.created_at);
  const now = new Date();
  const diffDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
  return diffDays < 90 ? 'daily' : '3x_week';
}

async function getAvailableMedia(clientId, storyType = null) {
  let query = supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('used', false);
  if(storyType) query = query.eq('story_type', storyType);
  const { data } = await query.limit(1);
  return data?.[0] || null;
}

async function selectRecyclablePost(clientId) {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Récupérer les top posts éligibles au recyclage
  const { data: topPosts } = await supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_top_content', true)
    .eq('recycled', false)
    .lt('original_post_date', twoMonthsAgo.toISOString())
    .order('performance_score', { ascending: false })
    .limit(10);

  if(!topPosts || topPosts.length === 0) return null;

  // Vérifier qu'on n'a pas recyclé un post cette semaine
  const { data: recentRecycled } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', clientId)
    .eq('type', 'recycled')
    .gte('created_at', oneWeekAgo.toISOString());

  if(recentRecycled && recentRecycled.length > 0) {
    console.log('⏭️ Un post recyclé a déjà été planifié cette semaine');
    return null;
  }

  return topPosts[0];
}

async function generateRecycledCaption(originalCaption, client, performanceScore) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Tu es un expert en community management Instagram.

Ce post a obtenu un score de performance de ${performanceScore}/100 — il a très bien marché !

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Ton : ${client.tone || 'professionnel'}

Caption originale :
"${originalCaption}"

Réécris cette caption pour la rendre encore plus engageante et virale.
- Garde l'essence du message original
- Améliore l'accroche (première ligne cruciale)
- Ajoute un call-to-action plus fort
- Optimise les hashtags (garde les performants, ajoute des tendances)
- Rends-la 20% plus percutante
- Maximum 150 mots

Ne mets pas de guillemets autour de la caption.`
    }]
  });

  return message.content[0].text;
}

async function schedulePostsForClient(client) {
  console.log(`📅 Planification pour ${client.name}...`);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  const { data: existingPosts } = await supabase
    .from('queue')
    .select('id, scheduled_at')
    .eq('client_id', client.id)
    .eq('statut', 'planifie')
    .eq('type', 'post')
    .lte('scheduled_at', nextWeek.toISOString());

  const phase = await getClientPhase(client);
  const targetPerWeek = phase === 'daily' ? 7 : 3;

  if(existingPosts && existingPosts.length >= targetPerWeek) {
    console.log(`✅ ${client.name} a déjà ${existingPosts.length} posts planifiés`);
    return;
  }

  const toCreate = targetPerWeek - (existingPosts?.length || 0);

  const { data: lastPost } = await supabase
    .from('queue')
    .select('scheduled_at')
    .eq('client_id', client.id)
    .eq('type', 'post')
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let lastDate = lastPost?.[0]?.scheduled_at || new Date();

  for(let i = 0; i < toCreate; i++) {
    const scheduledAt = getNextPublishDate(lastDate, phase);
    lastDate = scheduledAt;

    // ── Règle 80/20 : 1 post recyclé max par semaine ─────────────────────────
    const shouldRecycle = i === Math.floor(toCreate / 2);
    let media = null;
    let caption = '';
    let postType = 'post';

    if(shouldRecycle) {
      const recyclable = await selectRecyclablePost(client.id);
      if(recyclable) {
        media = recyclable;
        caption = await generateRecycledCaption(
          recyclable.caption,
          client,
          recyclable.performance_score
        );
        postType = 'recycled';

        // Marquer comme recyclé
        await supabase.from('media').update({
          recycled: true,
          last_used_at: new Date().toISOString(),
          use_count: (recyclable.use_count || 0) + 1
        }).eq('id', recyclable.id);

        console.log(`♻️ Post recyclé planifié pour ${client.name} (score: ${recyclable.performance_score})`);
      }
    }

    // Si pas de recyclage, prendre un nouveau média
    if(!media) {
      media = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption = await generateCaption(client, 'image', topPosts);
      postType = 'post';
    }

    await supabase.from('queue').insert({
      client_id: client.id,
      media_id: media?.id || null,
      media_url: media?.url || null,
      caption,
      scheduled_at: scheduledAt.toISOString(),
      type: postType,
      platform: 'instagram',
      statut: 'planifie'
    });

    console.log(`📌 Post "${postType}" planifié pour ${client.name} le ${scheduledAt.toLocaleDateString()}`);
  }
}

async function scheduleStoriesForClient(client) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data: existingStories } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .eq('statut', 'planifie')
    .gte('scheduled_at', today.toISOString())
    .lt('scheduled_at', tomorrow.toISOString());

  if(existingStories && existingStories.length >= 4) return;

  const storyTypes = [
    { type: 'entreprise', label: 'Story entreprise' },
    { type: 'tarifs', label: 'Story tarifs' },
    { type: 'avant_apres', label: 'Story avant/après' },
    { type: 'repost', label: 'Repost du post du jour' }
  ];

  for(let i = 0; i < storyTypes.length; i++) {
    const storyDef = storyTypes[i];
    const scheduledAt = getStoryTime(i);
    const media = await getAvailableMedia(client.id, storyDef.type);

    let mediaUrl = media?.url || null;
    if(storyDef.type === 'repost') {
      const { data: todayPost } = await supabase
        .from('queue')
        .select('media_url')
        .eq('client_id', client.id)
        .eq('type', 'post')
        .gte('scheduled_at', today.toISOString())
        .lt('scheduled_at', tomorrow.toISOString())
        .limit(1);
      mediaUrl = todayPost?.[0]?.media_url || mediaUrl;
    }

    await supabase.from('queue').insert({
      client_id: client.id,
      media_id: media?.id || null,
      media_url: mediaUrl,
      caption: storyDef.label,
      scheduled_at: scheduledAt.toISOString(),
      type: 'story',
      platform: 'instagram',
      statut: 'planifie'
    });

    console.log(`📸 Story "${storyDef.label}" planifiée pour ${client.name}`);
  }
}

async function runScheduler() {
  console.log('🗓️ Lancement du planificateur...');

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if(!clients || clients.length === 0) {
    console.log('Aucun client actif trouvé');
    return;
  }

  for(const client of clients) {
    try {
      await schedulePostsForClient(client);
      await scheduleStoriesForClient(client);
    } catch(err) {
      console.error(`❌ Erreur planification pour ${client.name}:`, err.message);
    }
  }

  console.log('✅ Planificateur terminé');
}

module.exports = { runScheduler };