const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');
const { syncAllClients, updateAllStats, recalculateScores } = require('./instagram-sync');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BEST_HOURS = {
  post:  [9, 12, 18, 20],
  story: [8, 11, 15, 19]
};

const PLANS = {
  starter: {
    postsPerWeek: 3, storiesPerDay: 4, recyclage: false,
    reponseDM: false, reponseCommentaires: false,
    postsSpeciauxMax: 1, analyseHistorique: true
  },
  pro: {
    postsPerWeek: 7, storiesPerDay: 4, recyclage: true,
    reponseDM: true, reponseCommentaires: true,
    postsSpeciauxMax: 999, analyseHistorique: true
  }
};

function getPlan(client) {
  return PLANS[(client.plan||'starter').toLowerCase()] || PLANS.starter;
}

function getNextPublishDate(lastDate, frequency) {
  const date = new Date(lastDate || Date.now());
  if (frequency === 'daily') {
    date.setDate(date.getDate() + 1);
  } else {
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

async function getClientFrequency(client) {
  return getPlan(client).postsPerWeek >= 7 ? 'daily' : '3x_week';
}

async function getAvailableMedia(clientId, category = null) {
  let query = supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('used', false)
    .order('potentiel_viral', { ascending: false });

  if (category) query = query.eq('story_category', category);
  const { data } = await query.limit(1);
  return data?.[0] || null;
}

async function selectRecyclablePost(clientId) {
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data: recentRecycled } = await supabase
    .from('queue').select('id').eq('client_id', clientId)
    .eq('type', 'recycled').gte('created_at', oneWeekAgo.toISOString());

  if (recentRecycled?.length > 0) return null;

  const { data: topPosts } = await supabase
    .from('media').select('*').eq('client_id', clientId)
    .eq('is_top_content', true).eq('recycled', false)
    .lt('original_post_date', twoMonthsAgo.toISOString())
    .order('performance_score', { ascending: false }).limit(10);

  return topPosts?.[0] || null;
}

async function generateRecycledCaption(originalCaption, client, performanceScore, postStats) {
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 500,
    messages: [{ role: 'user', content: `Expert community management Instagram.
Score : ${performanceScore}/100 | Stats : ${postStats?.likes} likes, ${postStats?.comments} commentaires
Client : ${client.name} | Ton : ${client.tone || 'professionnel'}
Caption originale : "${originalCaption}"
Réécris plus engageant. Max 150 mots. Retourne uniquement la caption.` }]
  });
  return message.content[0].text;
}

const ASSEMBLER_URL = process.env.ASSEMBLER_URL || 'http://localhost:5001';

async function generateStoryVisual(client, storyType, content) {
  try {
    await axios.get(`${ASSEMBLER_URL}/health`, { timeout: 5000 });

    const payload = {
      client_id:   client.id,
      client_name: client.name,
      branding:    client.branding || {},
      story_type:  storyType,
      content
    };

    const response = await axios.post(
      `${ASSEMBLER_URL}/story`,
      payload,
      { responseType: 'arraybuffer', timeout: 60000 }
    );

    const buffer   = Buffer.from(response.data);
    const filename = `story_${storyType}_${Date.now()}.jpg`;
    const path     = `stories/${client.id}/${filename}`;

    const { error } = await supabaseAdmin.storage
      .from('media')
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

    if (error) throw new Error(`Upload: ${error.message}`);

    const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
    return data.publicUrl;
  } catch(err) {
    console.warn(`⚠️ Assembleur story indisponible: ${err.message}`);
    return null;
  }
}

async function getStoryTemplate(clientId, type) {
  const { data } = await supabase
    .from('story_templates')
    .select('*')
    .eq('client_id', clientId)
    .eq('type', type)
    .eq('actif', true)
    .single();
  return data || null;
}

async function planifierStoryEntreprise(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'entreprise');
  let mediaUrl = template?.visuel_url || null;

  const needsRegen = !mediaUrl ||
    (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);

  if (needsRegen) {
    const content = template?.content || {
      titre:     client.name,
      sous_titre: client.description || 'Découvrez notre univers',
      texte:     client.description || ''
    };
    const newUrl = await generateStoryVisual(client, 'entreprise', content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({
        client_id:    client.id,
        type:         'entreprise',
        visuel_url:   newUrl,
        generated_at: new Date().toISOString(),
        content,
        actif:        true
      }, { onConflict: 'client_id,type' });
    }
  }

  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    mediaUrl = media?.url || null;
  }

  if (!mediaUrl) {
    console.warn(`⚠️ ${client.name} — Story entreprise ignorée : aucun visuel`);
    return false;
  }

  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl,
    caption: `${client.name} — Qui sommes-nous ?`,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_entreprise'
  });
  console.log(`📸 Story entreprise planifiée pour ${client.name}`);
  return true;
}

async function planifierStoryTarifs(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'tarifs');

  let mediaUrl = null;
  let mediaId  = null;
  const mediaTaggee = await getAvailableMedia(client.id, 'tarifs');

  if (mediaTaggee?.url) {
    mediaUrl = mediaTaggee.url;
    mediaId  = mediaTaggee.id;
  } else if (template?.visuel_url) {
    mediaUrl = template.visuel_url;
  } else {
    const content = template?.content || {
      titre:    'Nos tarifs',
      services: client.description || 'Contactez-nous pour en savoir plus'
    };
    const newUrl = await generateStoryVisual(client, 'tarifs', content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({
        client_id: client.id, type: 'tarifs',
        visuel_url: newUrl, generated_at: new Date().toISOString(),
        content, actif: true
      }, { onConflict: 'client_id,type' });
    }
  }

  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    if (media?.url) { mediaUrl = media.url; mediaId = media.id; }
  }

  if (!mediaUrl) {
    console.warn(`⚠️ ${client.name} — Story tarifs ignorée : aucun visuel`);
    return false;
  }

  await supabase.from('queue').insert({
    client_id: client.id, media_id: mediaId, media_url: mediaUrl,
    caption: 'Nos services & tarifs ✨',
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_tarifs'
  });
  console.log(`📸 Story tarifs planifiée pour ${client.name}`);
  return true;
}

async function planifierStoryTemoignage(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'temoignage');
  let mediaUrl = template?.visuel_url || null;

  const needsRegen = !mediaUrl ||
    (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);

  if (needsRegen && template?.content) {
    const newUrl = await generateStoryVisual(client, 'temoignage', template.content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({
        client_id: client.id, type: 'temoignage',
        visuel_url: newUrl, generated_at: new Date().toISOString(),
        content: template.content, actif: true
      }, { onConflict: 'client_id,type' });
    }
  }

  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id, 'temoignage');
    mediaUrl = media?.url || null;
    if (!mediaUrl) {
      const anyMedia = await getAvailableMedia(client.id);
      mediaUrl = anyMedia?.url || null;
    }
  }

  if (!mediaUrl) {
    console.warn(`⚠️ ${client.name} — Story témoignage ignorée : configurez un témoignage dans le back office`);
    return false;
  }

  const caption = template?.content?.texte
    ? `"${template.content.texte.slice(0, 80)}..." ⭐`
    : 'Ce que nos clients disent de nous ⭐';

  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl,
    caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_temoignage'
  });
  console.log(`📸 Story témoignage planifiée pour ${client.name}`);
  return true;
}

async function planifierStoryAvantApres(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'avant_apres');
  let mediaUrl = template?.visuel_url || null;

  const needsRegen = !mediaUrl ||
    (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);

  if (needsRegen) {
    const mediaAvant = await getAvailableMedia(client.id, 'avant');
    const mediaApres = await getAvailableMedia(client.id, 'apres');

    if (mediaAvant?.url && mediaApres?.url) {
      const content = {
        url_avant: mediaAvant.url,
        url_apres: mediaApres.url,
        titre:     template?.content?.titre || 'Avant / Après',
        sous_titre: client.name
      };
      const newUrl = await generateStoryVisual(client, 'avant_apres', content);
      if (newUrl) {
        mediaUrl = newUrl;
        await supabase.from('story_templates').upsert({
          client_id: client.id, type: 'avant_apres',
          visuel_url: newUrl, generated_at: new Date().toISOString(),
          content, actif: true
        }, { onConflict: 'client_id,type' });
      }
    }
  }

  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    mediaUrl = media?.url || null;
  }

  if (!mediaUrl) {
    console.warn(`⚠️ ${client.name} — Story avant/après ignorée : uploadez 2 photos taggées 'avant' et 'apres'`);
    return false;
  }

  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl,
    caption: 'La transformation parle d\'elle-même ✨',
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_avant_apres'
  });
  console.log(`📸 Story avant/après planifiée pour ${client.name}`);
  return true;
}

// ─────────────────────────────────────────────
// PLANIFICATION 4 STORIES FIXES — ANTI-DOUBLON CORRIGÉ
// ─────────────────────────────────────────────
async function scheduleFixedStoriesForClient(client) {
  if (client.status === 'paused') return;

  const storySlots = [
    { hour: 8,  fn: planifierStoryEntreprise,  source: 'story_fixe_entreprise'  },
    { hour: 11, fn: planifierStoryTarifs,      source: 'story_fixe_tarifs'      },
    { hour: 15, fn: planifierStoryTemoignage,  source: 'story_fixe_temoignage'  },
    { hour: 19, fn: planifierStoryAvantApres,  source: 'story_fixe_avant_apres' },
  ];

  for (const slot of storySlots) {
    // Calculer la date cible pour ce slot
    const scheduledAt = new Date();
    scheduledAt.setHours(slot.hour, 0, 0, 0);

    // Si l'heure est déjà passée → planifier pour demain
    if (scheduledAt <= new Date()) {
      scheduledAt.setDate(scheduledAt.getDate() + 1);
    }

    // Fenêtre de vérification : le jour de scheduledAt (minuit → minuit+1)
    const dayStart = new Date(scheduledAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // ✅ Vérifier si cette source est déjà planifiée CE jour-là (peu importe le statut)
    const { data: existing } = await supabase
      .from('queue')
      .select('id')
      .eq('client_id', client.id)
      .eq('source', slot.source)
      .gte('scheduled_at', dayStart.toISOString())
      .lt('scheduled_at', dayEnd.toISOString())
      .in('statut', ['planifie', 'publie']);

    if (existing && existing.length > 0) {
      // Déjà planifiée ou publiée pour ce jour → skip
      continue;
    }

    await slot.fn(client, scheduledAt);
  }
}

// ─────────────────────────────────────────────
// PLANIFICATION POSTS CLASSIQUES
// ─────────────────────────────────────────────
async function schedulePostsForClient(client) {
  if (client.status === 'paused') {
    console.log(`⏸️ ${client.name} est en pause`);
    return;
  }

  console.log(`📅 Planification posts pour ${client.name}...`);

  const plan          = getPlan(client);
  const frequency     = await getClientFrequency(client);
  const targetPerWeek = plan.postsPerWeek;
  const nextWeek      = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  const { data: existingPosts } = await supabase
    .from('queue').select('id, scheduled_at')
    .eq('client_id', client.id).eq('statut', 'planifie')
    .in('type', ['post', 'recycled'])
    .lte('scheduled_at', nextWeek.toISOString());

  if (existingPosts && existingPosts.length >= targetPerWeek) {
    console.log(`✅ ${client.name} a déjà ${existingPosts.length} posts planifiés`);
    return;
  }

  const toCreate = targetPerWeek - (existingPosts?.length || 0);
  const { data: lastPost } = await supabase
    .from('queue').select('scheduled_at')
    .eq('client_id', client.id).in('type', ['post', 'recycled'])
    .order('scheduled_at', { ascending: false }).limit(1);

  let lastDate       = lastPost?.[0]?.scheduled_at || new Date();
  const recycleIndex = plan.recyclage ? Math.floor(toCreate / 2) : -1;

  for (let i = 0; i < toCreate; i++) {
    const scheduledAt = getNextPublishDate(lastDate, frequency);
    lastDate = scheduledAt;

    let media = null, caption = '', postType = 'post';

    if (i === recycleIndex && plan.recyclage) {
      const recyclable = await selectRecyclablePost(client.id);
      if (recyclable) {
        media    = recyclable;
        caption  = await generateRecycledCaption(recyclable.caption, client, recyclable.performance_score,
          { likes: recyclable.likes, comments: recyclable.comments, reach: recyclable.reach });
        postType = 'recycled';
        await supabase.from('media').update({
          recycled: true, last_used_at: new Date().toISOString(),
          use_count: (recyclable.use_count || 0) + 1
        }).eq('id', recyclable.id);
      }
    }

    if (!media) {
      media   = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption  = await generateCaption(client, 'image', topPosts);
      postType = 'post';
    }

    const mediaUrl = media?.url || null;
    if (!mediaUrl) {
      console.warn(`⚠️ ${client.name} — aucun média disponible, post ignoré`);
      continue;
    }

    await supabase.from('queue').insert({
      client_id: client.id, media_id: media?.id || null,
      media_url: mediaUrl, caption,
      scheduled_at: scheduledAt.toISOString(),
      type: postType, platform: 'instagram', statut: 'planifie'
    });
    console.log(`📌 Post "${postType}" planifié pour ${client.name} le ${scheduledAt.toLocaleDateString('fr-FR')}`);
  }
}

// ─────────────────────────────────────────────
// PLANIFICATEUR PRINCIPAL
// ─────────────────────────────────────────────
async function runScheduler() {
  console.log('🗓️ Lancement du planificateur...');

  const { data: clients } = await supabase
    .from('clients').select('*')
    .in('status', ['active', 'paused']);

  if (!clients?.length) { console.log('Aucun client'); return; }

  for (const client of clients) {
    try {
      await schedulePostsForClient(client);
      await scheduleFixedStoriesForClient(client);
    } catch (err) {
      console.error(`❌ Erreur planification ${client.name}:`, err.message);
    }
  }

  console.log('✅ Planificateur terminé');
}

module.exports = {
  runScheduler,
  schedulePostsForClient,
  scheduleFixedStoriesForClient,
  selectRecyclablePost,
  generateRecycledCaption,
  getPlan,
  PLANS
};