const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function calculatePerformanceScore(post, allPosts) {
  if (!allPosts || allPosts.length === 0) return 0;
  const maxLikes    = Math.max(...allPosts.map(p => p.likes    || 0)) || 1;
  const maxComments = Math.max(...allPosts.map(p => p.comments || 0)) || 1;
  const maxReach    = Math.max(...allPosts.map(p => p.reach    || 0)) || 1;
  const likesScore    = ((post.likes    || 0) / maxLikes)    * 40;
  const commentsScore = ((post.comments || 0) / maxComments) * 35;
  const reachScore    = ((post.reach    || 0) / maxReach)    * 25;
  return Math.round(likesScore + commentsScore + reachScore);
}

async function fetchInstagramPosts(igAccountId, accessToken) {
  const posts = [];
  let url = `https://graph.instagram.com/${igAccountId}/media?fields=id,caption,media_type,media_url,timestamp,like_count,comments_count&access_token=${accessToken}&limit=50`;
  while (url) {
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error('❌ Erreur API Instagram:', data.error.message); break; }
    if (data.data) posts.push(...data.data);
    url = data.paging?.next || null;
  }
  return posts;
}

async function fetchPostReach(postId, accessToken) {
  try {
    const res  = await fetch(`https://graph.instagram.com/${postId}/insights?metric=reach&access_token=${accessToken}`);
    const data = await res.json();
    return data?.data?.[0]?.values?.[0]?.value || 0;
  } catch { return 0; }
}

async function syncInstagramHistory(clientId, igAccountId, accessToken) {
  console.log(`📥 Sync historique Instagram pour client ${clientId}...`);
  const igPosts = await fetchInstagramPosts(igAccountId, accessToken);
  console.log(`   → ${igPosts.length} posts récupérés depuis Instagram`);

  const { data: existingMedia } = await supabase
    .from('media')
    .select('instagram_post_id')
    .eq('client_id', clientId)
    .not('instagram_post_id', 'is', null);

  const existingIds = new Set((existingMedia || []).map(m => m.instagram_post_id));
  const toInsert = [];

  for (const post of igPosts) {
    if (existingIds.has(post.id)) continue;
    if (post.media_type === 'VIDEO') continue;
    const reach = await fetchPostReach(post.id, accessToken);
    toInsert.push({
      client_id:          clientId,
      instagram_post_id:  post.id,
      url:                post.media_url,
      caption:            post.caption || '',
      likes:              post.like_count     || 0,
      comments:           post.comments_count || 0,
      reach:              reach,
      views:              0,
      original_post_date: post.timestamp,
      used:               true,
      recycled:           false,
      use_count:          1,
      performance_score:  0,
      is_top_content:     false,
      source:             'instagram_history'
    });
  }

  if (toInsert.length === 0) {
    console.log(`   ✅ Aucun nouveau post à importer pour client ${clientId}`);
    return;
  }

  const { error } = await supabase.from('media').insert(toInsert);
  if (error) { console.error('❌ Erreur insertion media:', error.message); return; }
  console.log(`   ✅ ${toInsert.length} posts importés pour client ${clientId}`);
  await recalculateScores(clientId);
}

async function recalculateScores(clientId) {
  const { data: allPosts } = await supabase
    .from('media')
    .select('id, likes, comments, reach')
    .eq('client_id', clientId)
    .not('instagram_post_id', 'is', null);

  if (!allPosts || allPosts.length === 0) return;

  for (const post of allPosts) {
    const score = calculatePerformanceScore(post, allPosts);
    await supabase.from('media').update({
      performance_score: score,
      is_top_content:    score >= 60
    }).eq('id', post.id);
  }
  console.log(`   ✅ Scores recalculés pour client ${clientId}`);
}

async function syncAllClients() {
  console.log('🔄 Démarrage sync Instagram pour tous les clients...');
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('platform', 'instagram')
    .eq('is_active', true);

  if (!accounts || accounts.length === 0) { console.log('Aucun compte Instagram actif'); return; }

  for (const account of accounts) {
    try {
      await syncInstagramHistory(account.client_id, account.account_id, account.access_token);
    } catch (err) {
      console.error(`❌ Erreur sync client ${account.client_id}:`, err.message);
    }
  }
  console.log('✅ Sync Instagram terminée');
}

async function updatePostStats(clientId, igAccountId, accessToken) {
  const { data: mediaPosts } = await supabase
    .from('media')
    .select('id, instagram_post_id')
    .eq('client_id', clientId)
    .not('instagram_post_id', 'is', null);

  if (!mediaPosts || mediaPosts.length === 0) return;

  for (const media of mediaPosts) {
    try {
      const res  = await fetch(`https://graph.instagram.com/${media.instagram_post_id}?fields=like_count,comments_count&access_token=${accessToken}`);
      const data = await res.json();
      if (data.error) continue;
      const reach = await fetchPostReach(media.instagram_post_id, accessToken);
      await supabase.from('media').update({
        likes:    data.like_count     || 0,
        comments: data.comments_count || 0,
        reach:    reach
      }).eq('id', media.id);
    } catch { /* silencieux */ }
  }
  await recalculateScores(clientId);
}

async function updateAllStats() {
  console.log('🔁 Mise à jour des stats Instagram...');
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('platform', 'instagram')
    .eq('is_active', true);

  if (!accounts) return;
  for (const account of accounts) {
    try {
      await updatePostStats(account.client_id, account.account_id, account.access_token);
    } catch (err) {
      console.error(`❌ Erreur stats client ${account.client_id}:`, err.message);
    }
  }
  console.log('✅ Stats mises à jour');
}

module.exports = {
  syncInstagramHistory,
  syncAllClients,
  updatePostStats,
  updateAllStats,
  recalculateScores,
  calculatePerformanceScore
};