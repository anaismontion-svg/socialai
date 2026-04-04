const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');
const Anthropic = require('@anthropic-ai/sdk');
const { getNextReviewForClient } = require('./google-reviews');

const supabase      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// FORFAITS
// ─────────────────────────────────────────────
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
  return PLANS[(client.plan || 'starter').toLowerCase()] || PLANS.starter;
}

// ─────────────────────────────────────────────
// DATES
// ─────────────────────────────────────────────
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
  date.setHours([9, 12, 18, 20][Math.floor(Math.random() * 4)], 0, 0, 0);
  return date;
}

async function getClientFrequency(client) {
  return getPlan(client).postsPerWeek >= 7 ? 'daily' : '3x_week';
}

// ─────────────────────────────────────────────
// SÉLECTION MÉDIA
// ─────────────────────────────────────────────
async function getAvailableMedia(clientId, categories = null) {
  let candidates = [];

  if (Array.isArray(categories) && categories.length > 0) {
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    for (const cat of shuffled) {
      const { data } = await supabase
        .from('media').select('*')
        .eq('client_id', clientId)
        .eq('used', false)
        .eq('reserved', false)
        .eq('story_category', cat)
        .order('created_at', { ascending: true })
        .limit(10);
      if (data?.length) { candidates = data; break; }
    }
  }

  if (!candidates.length) {
    const { data } = await supabase
      .from('media').select('*')
      .eq('client_id', clientId)
      .eq('used', false)
      .eq('reserved', false)
      .order('created_at', { ascending: true })
      .limit(10);
    candidates = data || [];
  }

  if (!candidates.length) {
    console.warn(`⚠️ ${clientId} — Plus de médias libres, réutilisation des réservés`);
    const { data } = await supabase
      .from('media').select('*')
      .eq('client_id', clientId)
      .eq('used', false)
      .order('reserved_at', { ascending: true })
      .limit(10);
    candidates = data || [];
  }

  if (!candidates.length) return null;

  const chosen = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];
  await supabase.from('media').update({
    reserved:    true,
    reserved_at: new Date().toISOString()
  }).eq('id', chosen.id);

  console.log(`🔒 Média réservé : ${chosen.filename || chosen.id}`);
  return chosen;
}

async function getMediaRotation(clientId, source, categories = null) {
  const { data: lastUsed } = await supabase
    .from('queue')
    .select('media_id')
    .eq('client_id', clientId)
    .eq('source', source)
    .not('media_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);

  const recentMediaIds = lastUsed?.map(r => r.media_id).filter(Boolean) || [];
  let candidates = [];

  if (Array.isArray(categories) && categories.length > 0) {
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    for (const cat of shuffled) {
      const { data } = await supabase
        .from('media').select('*')
        .eq('client_id', clientId)
        .eq('used', false)
        .eq('reserved', false)
        .eq('story_category', cat)
        .order('created_at', { ascending: true })
        .limit(10);
      if (data?.length) { candidates = [...candidates, ...data]; }
    }
  }

  if (!candidates.length) {
    const { data } = await supabase
      .from('media').select('*')
      .eq('client_id', clientId)
      .eq('used', false)
      .eq('reserved', false)
      .order('created_at', { ascending: true })
      .limit(20);
    candidates = data || [];
  }

  if (!candidates.length) {
    const { data } = await supabase
      .from('media').select('*')
      .eq('client_id', clientId)
      .eq('used', false)
      .order('reserved_at', { ascending: true })
      .limit(10);
    candidates = data || [];
  }

  if (!candidates.length) return null;

  const different = candidates.filter(m => !recentMediaIds.includes(m.id));
  const chosen = different.length > 0
    ? different[Math.floor(Math.random() * Math.min(different.length, 5))]
    : candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];

  await supabase.from('media').update({
    reserved:    true,
    reserved_at: new Date().toISOString()
  }).eq('id', chosen.id);

  console.log(`🔒 Média réservé (rotation) : ${chosen.filename || chosen.id} — catégorie: ${chosen.story_category || 'générale'}`);
  return chosen;
}

// ─────────────────────────────────────────────
// ANTI-DOUBLON STORIES
// ─────────────────────────────────────────────
async function storyDejaPlanifeePour(clientId, source, depuisDate) {
  const jusqu = new Date(depuisDate);
  jusqu.setHours(jusqu.getHours() + 26);
  const { data } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', clientId)
    .eq('source', source)
    .in('statut', ['planifie', 'en_cours', 'publie'])
    .gte('scheduled_at', depuisDate.toISOString())
    .lt('scheduled_at', jusqu.toISOString());
  return (data && data.length > 0);
}

// ─────────────────────────────────────────────
// NETTOYAGE DOUBLONS
// ─────────────────────────────────────────────
async function cleanDuplicateStories(clientId) {
  const sources = [
    'story_template_entreprise',
    'story_template_tarifs',
    'story_template_temoignage',
    'story_template_avant_apres',
    'story_repost_post',
    'story_chats_chatons',
    'story_qui_sommes_nous',
    'story_accompagnement',
  ];
  for (const source of sources) {
    const { data: stories } = await supabase
      .from('queue').select('id, scheduled_at, media_id')
      .eq('client_id', clientId).eq('source', source)
      .eq('statut', 'planifie')
      .order('scheduled_at', { ascending: true });
    if (!stories || stories.length <= 1) continue;
    const byDay = {};
    const toDelete = [];
    const mediaToFree = [];
    for (const s of stories) {
      const day = new Date(s.scheduled_at).toDateString();
      if (byDay[day]) {
        toDelete.push(s.id);
        if (s.media_id) mediaToFree.push(s.media_id);
      } else {
        byDay[day] = s.id;
      }
    }
    if (toDelete.length > 0) {
      await supabase.from('queue').delete().in('id', toDelete);
      if (mediaToFree.length > 0) {
        await supabase.from('media').update({ reserved: false, reserved_at: null }).in('id', mediaToFree);
      }
      console.log(`🗑️ ${toDelete.length} doublon(s) supprimé(s) pour "${source}"`);
    }
  }
}

// ─────────────────────────────────────────────
// GÉNÉRATION CAPTION DEPUIS TEMPLATE
// ─────────────────────────────────────────────
async function generateCaptionFromTemplate(type, content, clientName, googleReview = null) {
  const prompts = {
    entreprise: `Tu gères le compte Instagram de ${clientName}.
Génère une caption courte pour une story de présentation de l'entreprise.
Informations disponibles :
- Titre : ${content.titre || ''}
- Accroche : ${content.sous_titre || ''}
- Description : ${content.texte || ''}
Règles : max 2 phrases, 1-2 emojis, ton chaleureux et authentique, varie à chaque fois.
Retourne uniquement la caption.`,

    tarifs: `Tu gères le compte Instagram de ${clientName}.
Génère une caption courte pour une story présentant les tarifs/services.
Informations :
- Titre : ${content.titre || ''}
- Services : ${(content.services || '').replace(/<br>/g, ', ')}
Règles : max 2 phrases, 1-2 emojis, ton accessible et valorisant, jamais commercial.
Retourne uniquement la caption.`,

    temoignage: googleReview
      ? `Tu gères le compte Instagram de ${clientName}.
Génère une caption courte pour une story témoignage client basée sur cet avis Google 5 étoiles :
Avis de ${googleReview.author} : "${googleReview.text}"
Règles : max 2 phrases, 1-2 emojis, met en valeur la satisfaction client, cite le prénom si possible.
Retourne uniquement la caption.`
      : `Tu gères le compte Instagram de ${clientName}.
Génère une caption courte pour une story témoignage client.
Témoignage : "${content.texte || ''}"
Client : ${content.nom_client || ''} — Note : ${content.note || 5}/5 étoiles
Règles : max 2 phrases, 1-2 emojis, met en valeur la satisfaction client.
Retourne uniquement la caption.`,

    avant_apres: `Tu gères le compte Instagram de ${clientName}.
Génère une caption courte pour une story avant/après.
Titre : ${content.titre || 'Avant / Après'}
Règles : max 2 phrases, 1-2 emojis, crée de la curiosité et de l'émotion.
Retourne uniquement la caption.`,
  };

  const prompt = prompts[type];
  if (!prompt) return `✨ Découvrez ${clientName}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text.trim();
}

// ─────────────────────────────────────────────
// STORIES DEPUIS TEMPLATES VALIDÉS
// ─────────────────────────────────────────────
const TEMPLATE_SOURCES = [
  { type: 'entreprise',  source: 'story_template_entreprise',  hoursOffset: 0 },
  { type: 'tarifs',      source: 'story_template_tarifs',      hoursOffset: 3 },
  { type: 'temoignage',  source: 'story_template_temoignage',  hoursOffset: 6 },
  { type: 'avant_apres', source: 'story_template_avant_apres', hoursOffset: 9 },
];

async function scheduleFixedStoriesForClient(client) {
  if (client.status === 'paused') return;

  const { data: templates } = await supabase
    .from('story_templates')
    .select('*')
    .eq('client_id', client.id)
    .eq('actif', true);

  if (!templates?.length) {
    console.warn(`⚠️ ${client.name} — Aucun template de story validé`);
    return;
  }

  const { data: lastStory } = await supabase
    .from('queue')
    .select('scheduled_at, published_at, statut')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .in('statut', ['planifie', 'en_cours', 'publie'])
    .not('source', 'eq', 'story_personnalisee')
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let serieBase;
  if (lastStory?.[0]) {
    const ref = lastStory[0].published_at || lastStory[0].scheduled_at;
    serieBase = new Date(ref);
    const heuresDepuisRef = (Date.now() - serieBase.getTime()) / (1000 * 60 * 60);
    if (heuresDepuisRef < 20) {
      serieBase = new Date();
      serieBase.setDate(serieBase.getDate() + 1);
      serieBase.setHours(8, 0, 0, 0);
    } else {
      serieBase = new Date();
      serieBase.setMinutes(serieBase.getMinutes() + 15);
    }
  } else {
    serieBase = new Date();
    serieBase.setMinutes(serieBase.getMinutes() + 15);
  }

  let storyPlanifiees = 0;

  for (const slot of TEMPLATE_SOURCES) {
    const template = templates.find(t => t.type === slot.type);
    if (!template) {
      console.log(`⏭️ ${client.name} — template "${slot.type}" non trouvé ou inactif`);
      continue;
    }

    const scheduledAt = new Date(serieBase);
    scheduledAt.setHours(scheduledAt.getHours() + slot.hoursOffset);

    const dejaPresente = await storyDejaPlanifeePour(client.id, slot.source, serieBase);
    if (dejaPresente) {
      console.log(`⏭️ ${client.name} — "${slot.source}" déjà planifiée, ignorée`);
      continue;
    }

    try {
      const visualUrl = template.visuel_url || template.content?.photo_url || null;

      // Pour les témoignages → récupérer un avis Google si disponible
      let googleReview = null;
      if (slot.type === 'temoignage' && client.google_place_id) {
        googleReview = await getNextReviewForClient(client.id, client.google_place_id);
        if (googleReview) {
          console.log(`⭐ Avis Google récupéré pour ${client.name} : ${googleReview.author}`);
        }
      }

      const caption = await generateCaptionFromTemplate(
        slot.type,
        template.content || {},
        client.name,
        googleReview
      );

      await supabase.from('queue').insert({
        client_id:    client.id,
        media_url:    visualUrl,
        caption,
        scheduled_at: scheduledAt.toISOString(),
        type:         'story',
        platform:     'instagram',
        statut:       'planifie',
        source:       slot.source,
      });

      console.log(`📸 Story "${slot.type}" planifiée pour ${client.name}${googleReview ? ' — avis Google ⭐' : ' — template validé'}`);
      storyPlanifiees++;
    } catch(err) {
      console.error(`❌ Erreur story ${slot.source}:`, err.message);
    }
  }

  await planifierStoryRepost(client, new Date(serieBase.getTime() + 12 * 60 * 60 * 1000));

  if (storyPlanifiees > 0) {
    console.log(`✅ ${client.name} — ${storyPlanifiees} story(s) planifiée(s)`);
  } else {
    console.log(`ℹ️ ${client.name} — Toutes les stories sont déjà planifiées`);
  }
}

// ─────────────────────────────────────────────
// STORY REPOST DU DERNIER POST
// ─────────────────────────────────────────────
async function planifierStoryRepost(client, scheduledAt) {
  const dejaPresente = await storyDejaPlanifeePour(client.id, 'story_repost_post', new Date(scheduledAt.getTime() - 12 * 60 * 60 * 1000));
  if (dejaPresente) {
    console.log(`⏭️ ${client.name} — story repost déjà planifiée`);
    return false;
  }

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  let postRef = null;

  const { data: postAujourdhui } = await supabase
    .from('queue').select('media_url, caption, media_id')
    .eq('client_id', client.id)
    .in('type', ['post', 'recycled', 'special'])
    .eq('statut', 'publie')
    .gte('published_at', today.toISOString())
    .lt('published_at', tomorrow.toISOString())
    .order('published_at', { ascending: false }).limit(1);

  if (postAujourdhui?.[0]) {
    postRef = postAujourdhui[0];
  } else {
    const { data: dernierPost } = await supabase
      .from('queue').select('media_url, caption, media_id')
      .eq('client_id', client.id)
      .in('type', ['post', 'recycled', 'special'])
      .eq('statut', 'publie')
      .order('published_at', { ascending: false }).limit(1);
    if (dernierPost?.[0]) postRef = dernierPost[0];
  }

  if (!postRef?.media_url) {
    const { data: prochainPost } = await supabase
      .from('queue').select('media_url, caption, media_id')
      .eq('client_id', client.id)
      .in('type', ['post', 'recycled', 'special'])
      .eq('statut', 'planifie')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true }).limit(1);
    if (prochainPost?.[0]) postRef = prochainPost[0];
  }

  if (!postRef?.media_url) {
    console.warn(`⚠️ ${client.name} — Story repost : aucun post trouvé`);
    return false;
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 80,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de ${client.name}.
Génère une caption ultra-courte pour une story qui reposte ce post :
"${(postRef.caption || '').slice(0, 100)}"
- Maximum 1 phrase
- 1 emoji
- Encourage à voir le post (ex: "Notre post du jour 👆")
- Varie chaque jour
Retourne uniquement la caption.`
    }]
  });
  const caption = response.content[0].text.trim();

  await supabase.from('queue').insert({
    client_id:    client.id,
    media_id:     postRef.media_id || null,
    media_url:    postRef.media_url,
    caption,
    scheduled_at: scheduledAt.toISOString(),
    type:         'story',
    platform:     'instagram',
    statut:       'planifie',
    source:       'story_repost_post'
  });
  console.log(`📸 Story repost planifiée pour ${client.name}`);
  return true;
}

// ─────────────────────────────────────────────
// STORY PERSONNALISÉE
// ─────────────────────────────────────────────
async function planifierStoryPersonnalisee(clientId, message, mediaUrl, scheduledAt) {
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
  if (!client) throw new Error('Client introuvable');
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de ${client.name}.
Le client souhaite une story personnalisée avec ce message :
"${message}"
Génère une caption story adaptée :
- Maximum 2 phrases
- 1-2 emojis
- Ton chaleureux et authentique
Retourne uniquement la caption.`
    }]
  });
  const caption = response.content[0].text.trim();
  const { data, error } = await supabase.from('queue').insert({
    client_id: clientId, media_url: mediaUrl || null, caption,
    scheduled_at: scheduledAt || new Date().toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_personnalisee',
    special_request: true, special_message: message
  }).select().single();
  if (error) throw new Error(error.message);
  return { success: true, post: data, caption };
}

// ─────────────────────────────────────────────
// RECYCLAGE
// ─────────────────────────────────────────────
async function selectRecyclablePost(clientId) {
  const twoMonthsAgo = new Date(); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const oneWeekAgo   = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
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

// ─────────────────────────────────────────────
// PLANIFICATION POSTS CLASSIQUES
// ─────────────────────────────────────────────
async function schedulePostsForClient(client) {
  if (client.status === 'paused') { console.log(`⏸️ ${client.name} en pause`); return; }
  const plan      = getPlan(client);
  const frequency = await getClientFrequency(client);
  const nextWeek  = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);

  const { data: existingPosts } = await supabase
    .from('queue').select('id, scheduled_at')
    .eq('client_id', client.id).eq('statut', 'planifie')
    .in('type', ['post', 'recycled'])
    .lte('scheduled_at', nextWeek.toISOString());

  if (existingPosts && existingPosts.length >= plan.postsPerWeek) {
    console.log(`✅ ${client.name} a déjà ${existingPosts.length} posts planifiés`);
    return;
  }

  const toCreate = plan.postsPerWeek - (existingPosts?.length || 0);
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
          recycled:     true,
          reserved:     true,
          reserved_at:  new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          use_count:    (recyclable.use_count || 0) + 1
        }).eq('id', recyclable.id);
      }
    }

    if (!media) {
      media          = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption        = await generateCaption(client, 'image', topPosts);
      postType       = 'post';
    }

    if (!media?.url) { console.warn(`⚠️ ${client.name} — aucun média disponible, post ignoré`); continue; }

    await supabase.from('queue').insert({
      client_id:    client.id,
      media_id:     media.id || null,
      media_url:    media.url,
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
// PLANIFICATEUR PRINCIPAL
// ─────────────────────────────────────────────
async function runScheduler() {
  console.log('🗓️ Lancement du planificateur...');
  const { data: clients } = await supabase
    .from('clients').select('*').in('status', ['active', 'paused']);
  if (!clients?.length) { console.log('Aucun client'); return; }

  for (const client of clients) {
    try {
      await cleanDuplicateStories(client.id);
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
  planifierStoryPersonnalisee,
  cleanDuplicateStories,
  selectRecyclablePost,
  generateRecycledCaption,
  getPlan,
  PLANS
};