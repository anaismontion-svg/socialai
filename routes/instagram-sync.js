for(let i = 0; i < toCreate; i++) {
  const scheduledAt = getNextPublishDate(lastDate, phase);
  lastDate = scheduledAt;

  // Règle 80/20 : 1 post recyclé max par semaine, reste = nouveaux médias
  const shouldRecycle = i === Math.floor(toCreate / 2); // 1 fois au milieu du planning
  let media = null;
  let caption = '';
  let postType = 'post';

  if(shouldRecycle) {
    const recyclable = await selectRecyclablePost(client.id);
    if(recyclable) {
      media = recyclable;
      caption = await generateRecycledCaption(recyclable.caption, client, recyclable.performance_score);
      postType = 'recycled';
      // Marquer comme recyclé
      await supabase.from('media').update({
        recycled: true,
        last_used_at: new Date().toISOString(),
        use_count: (recyclable.use_count || 0) + 1
      }).eq('id', recyclable.id);
      console.log(`♻️ Post recyclé planifié pour ${client.name}`);
    }
  }

  if(!media) {
    media = await getAvailableMedia(client.id);
    const topPosts = await getTopPosts(client.id);
    caption = await generateCaption(client, 'image', topPosts);
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
}