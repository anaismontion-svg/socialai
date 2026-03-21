const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Heures de publication optimales selon l'IA
const BEST_HOURS = {
  post: [9, 12, 18, 20],      // Heures idéales pour les posts
  story: [8, 12, 17, 21]      // Heures idéales pour les stories
};

function getNextPublishDate(lastDate, frequency) {
  const date = new Date(lastDate || Date.now());
  
  if (frequency === 'daily') {
    date.setDate(date.getDate() + 1);
  } else if (frequency === '3x_week') {
    // Lundi, Mercredi, Vendredi
    const day = date.getDay();
    if (day < 1) date.setDate(date.getDate() + (1 - day));
    else if (day < 3) date.setDate(date.getDate() + (3 - day));
    else if (day < 5) date.setDate(date.getDate() + (5 - day));
    else date.setDate(date.getDate() + (8 - day)); // Lundi suivant
  }

  // Choisir une heure optimale aléatoire
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
  // Vérifier depuis quand le client est actif
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

  if (storyType) {
    query = query.eq('story_type', storyType);
  }

  const { data } = await query.limit(1);
  return data?.[0] || null;
}

async function schedulePostsForClient(client) {
  console.log(`📅 Planification pour ${client.name}...`);

  // Vérifier combien de posts sont déjà planifiés dans les 7 prochains jours
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

  if (existingPosts && existingPosts.length >= targetPerWeek) {
    console.log(`✅ ${client.name} a déjà ${existingPosts.length} posts planifiés`);
    return;
  }

  const toCreate = targetPerWeek - (existingPosts?.length || 0);

  // Récupérer le dernier post planifié
  const { data: lastPost } = await supabase
    .from('queue')
    .select('scheduled_at')
    .eq('client_id', client.id)
    .eq('type', 'post')
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let lastDate = lastPost?.[0]?.scheduled_at || new Date();

  for (let i = 0; i < toCreate; i++) {
    const scheduledAt = getNextPublishDate(lastDate, phase);
    lastDate = scheduledAt;

    // Récupérer un média disponible
    const media = await getAvailableMedia(client.id);

    // Générer la caption
    const topPosts = await getTopPosts(client.id);
    const caption = await generateCaption(client, 'image', topPosts);

    await supabase.from('queue').insert({
      client_id: client.id,
      media_id: media?.id || null,
      media_url: media?.url || null,
      caption,
      scheduled_at: scheduledAt.toISOString(),
      type: 'post',
      platform: 'instagram',
      statut: 'planifie'
    });

    console.log(`📌 Post planifié pour ${client.name} le ${scheduledAt.toLocaleDateString()}`);
  }
}

async function scheduleStoriesForClient(client) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Vérifier si les stories du jour sont déjà planifiées
  const { data: existingStories } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .eq('statut', 'planifie')
    .gte('scheduled_at', today.toISOString())
    .lt('scheduled_at', tomorrow.toISOString());

  if (existingStories && existingStories.length >= 4) {
    return; // Stories du jour déjà planifiées
  }

  // Les 4 types de stories quotidiennes
  const storyTypes = [
    { type: 'entreprise', label: 'Story entreprise' },
    { type: 'tarifs', label: 'Story tarifs' },
    { type: 'avant_apres', label: 'Story avant/après' },
    { type: 'repost', label: 'Repost du post du jour' }
  ];

  for (let i = 0; i < storyTypes.length; i++) {
    const storyDef = storyTypes[i];
    const scheduledAt = getStoryTime(i);

    // Récupérer un média adapté au type de story
    const media = await getAvailableMedia(client.id, storyDef.type);

    // Pour le repost, récupérer le post du jour
    let mediaUrl = media?.url || null;
    if (storyDef.type === 'repost') {
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

  if (!clients || clients.length === 0) {
    console.log('Aucun client actif trouvé');
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

module.exports = { runScheduler };