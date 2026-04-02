const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

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
// TEXTE DE BASE — ACCOMPAGNEMENT ADOPTION
// ─────────────────────────────────────────────
const TEXTE_BASE_ACCOMPAGNEMENT = `A la chatterie Love Queen Dolls, nous ne vendons pas de chaton. Nous accompagnons chaque famille jusqu'à la réalisation de leur rêve : trouver le compagnon idéal. Nous vous aidons pour votre choix bébé, nous occupons du suivi vétérinaire, donnons des conseils d'intégration... Et restons disponibles même des années après pour toutes vos questions !`;

// ─────────────────────────────────────────────
// CATÉGORIES DE MÉDIAS POUR LA STORY CHATS
// ─────────────────────────────────────────────
const STORY_CHAT_CATEGORIES = [
  'chaton_disponible',
  'chat_adulte',
  'avant_apres',
  'video_chaton',
  'famille_adoption'
];

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────
function getPlan(client) {
  return PLANS[(client.plan || 'starter').toLowerCase()] || PLANS.starter;
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
  date.setHours([9, 12, 18, 20][Math.floor(Math.random() * 4)], 0, 0, 0);
  return date;
}

async function getClientFrequency(client) {
  return getPlan(client).postsPerWeek >= 7 ? 'daily' : '3x_week';
}

// Récupère un média non utilisé, en rotation parmi les catégories disponibles
async function getAvailableMedia(clientId, categories = null) {
  // Si plusieurs catégories possibles, on essaie dans l'ordre aléatoire
  if (Array.isArray(categories) && categories.length > 0) {
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    for (const cat of shuffled) {
      const { data } = await supabase
        .from('media').select('*')
        .eq('client_id', clientId)
        .eq('used', false)
        .eq('story_category', cat)
        .order('created_at', { ascending: true }) // FIFO pour éviter les répétitions
        .limit(1);
      if (data?.[0]) return data[0];
    }
  }
  // Fallback : n'importe quel média non utilisé
  const { data } = await supabase
    .from('media').select('*')
    .eq('client_id', clientId)
    .eq('used', false)
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0] || null;
}

// Récupère un média différent de celui utilisé hier pour cette story
async function getMediaRotation(clientId, source, categories = null) {
  // Trouver le média utilisé hier pour cette source
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const { data: lastUsed } = await supabase
    .from('queue')
    .select('media_id, media_url')
    .eq('client_id', clientId)
    .eq('source', source)
    .gte('created_at', yesterday.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const lastMediaId = lastUsed?.[0]?.media_id;

  // Récupérer un média différent
  if (Array.isArray(categories) && categories.length > 0) {
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    for (const cat of shuffled) {
      let query = supabase.from('media').select('*')
        .eq('client_id', clientId)
        .eq('story_category', cat)
        .order('created_at', { ascending: true })
        .limit(5);
      const { data: candidates } = await query;
      if (!candidates?.length) continue;
      // Choisir un média différent du dernier
      const different = candidates.find(m => m.id !== lastMediaId);
      if (different) return different;
      if (candidates[0]) return candidates[0]; // Fallback si un seul média
    }
  }

  // Fallback général avec rotation
  let query = supabase.from('media').select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
    .limit(10);
  const { data: all } = await query;
  if (!all?.length) return null;
  const different = all.find(m => m.id !== lastMediaId);
  return different || all[0];
}

// ─────────────────────────────────────────────
// ANTI-DOUBLON — 1 story par type par 24h
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
// NETTOYAGE DES DOUBLONS
// ─────────────────────────────────────────────
async function cleanDuplicateStories(clientId) {
  const sources = [
    'story_chats_chatons',
    'story_qui_sommes_nous',
    'story_accompagnement',
    'story_repost_post'
  ];
  for (const source of sources) {
    const { data: stories } = await supabase
      .from('queue').select('id, scheduled_at')
      .eq('client_id', clientId).eq('source', source)
      .eq('statut', 'planifie')
      .order('scheduled_at', { ascending: true });
    if (!stories || stories.length <= 1) continue;
    const byDay = {};
    const toDelete = [];
    for (const s of stories) {
      const day = new Date(s.scheduled_at).toDateString();
      if (byDay[day]) toDelete.push(s.id);
      else byDay[day] = s.id;
    }
    if (toDelete.length > 0) {
      await supabase.from('queue').delete().in('id', toDelete);
      console.log(`🗑️ ${toDelete.length} doublon(s) supprimé(s) pour "${source}"`);
    }
  }
}

// ─────────────────────────────────────────────
// STORY 1 — PRÉSENTATION CHATS / CHATONS
// Photo différente chaque jour + caption IA
// ─────────────────────────────────────────────
async function planifierStoryChatsChatons(client, scheduledAt) {
  const media = await getMediaRotation(client.id, 'story_chats_chatons', STORY_CHAT_CATEGORIES);
  if (!media?.url) {
    console.warn(`⚠️ ${client.name} — Story chats/chatons : aucun média disponible`);
    return false;
  }

  // Générer une caption courte et variée avec l'IA
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 150, temperature: 1,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de la chatterie Love Queen Dolls, éleveuse de Ragdolls.
Génère une caption TRÈS courte et émotionnelle pour une story Instagram présentant ${
  media.story_category === 'chaton_disponible' ? 'un chaton Ragdoll disponible à l\'adoption' :
  media.story_category === 'chat_adulte'       ? 'un de nos magnifiques Ragdolls adultes' :
  media.story_category === 'video_chaton'      ? 'un adorable chaton Ragdoll en vidéo' :
  media.story_category === 'avant_apres'       ? 'l\'évolution d\'un de nos Ragdolls de chaton à adulte' :
  media.story_category === 'famille_adoption'  ? 'une famille heureuse avec son Ragdoll adopté' :
  'un de nos Ragdolls'}.
- Maximum 2 phrases
- 1-2 emojis
- Ton chaleureux et passionné
- Varie TOUJOURS (jamais la même formule)
Retourne uniquement la caption.`
    }]
  });

  const caption = response.content[0].text.trim();

  await supabase.from('queue').insert({
    client_id: client.id, media_id: media.id, media_url: media.url, caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_chats_chatons'
  });

  console.log(`📸 Story chats/chatons planifiée pour ${client.name} — média: ${media.story_category || 'général'}`);
  return true;
}

// ─────────────────────────────────────────────
// STORY 2 — QUI SOMMES-NOUS ?
// Photo de la chatterie/éleveuse + texte varié
// ─────────────────────────────────────────────
async function planifierStoryQuiSommesNous(client, scheduledAt) {
  const media = await getMediaRotation(client.id, 'story_qui_sommes_nous', ['chatterie', 'equipe', 'coulisses', 'elevage']);
  const mediaUrl = media?.url || null;

  if (!mediaUrl) {
    console.warn(`⚠️ ${client.name} — Story "qui sommes-nous" : aucun média. Uploadez des photos taggées "chatterie" ou "elevage".`);
    return false;
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 120, temperature: 1,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de Love Queen Dolls, chatterie Ragdoll passionnée.
Génère une caption TRÈS courte pour une story "qui sommes-nous / présentation de la chatterie".
- Maximum 2 phrases courtes
- 1-2 emojis
- Ton humain, authentique, passionné
- Varie chaque jour (coulisses, passion, histoire, valeurs...)
- Ne répète JAMAIS la même formule
Retourne uniquement la caption.`
    }]
  });

  const caption = response.content[0].text.trim();

  await supabase.from('queue').insert({
    client_id: client.id, media_id: media?.id || null, media_url: mediaUrl, caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_qui_sommes_nous'
  });

  console.log(`📸 Story "qui sommes-nous" planifiée pour ${client.name}`);
  return true;
}

// ─────────────────────────────────────────────
// STORY 3 — ACCOMPAGNEMENT ADOPTION
// L'IA varie autour du texte de base validé
// ─────────────────────────────────────────────
async function planifierStoryAccompagnement(client, scheduledAt) {
  // Récupérer le texte de base personnalisé (back office) ou utiliser le défaut
  const { data: template } = await supabase
    .from('story_templates').select('content')
    .eq('client_id', client.id).eq('type', 'accompagnement').single();

  const texteBase = template?.content?.texte_base || TEXTE_BASE_ACCOMPAGNEMENT;

  // L'IA reformule différemment chaque jour
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 200, temperature: 1,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de Love Queen Dolls, chatterie Ragdoll.

Voici le message clé à transmettre sur notre accompagnement à l'adoption :
"${texteBase}"

Reformule ce message pour une story Instagram aujourd'hui.
Règles STRICTES :
- Garde L'ESSENCE et les informations du message original
- Reformule avec des mots et une structure DIFFÉRENTS à chaque fois
- Maximum 3 phrases
- 2 emojis maximum
- Ton chaleureux, humain, jamais commercial
- Termine par un appel à l'action doux (ex: "Posez-nous vos questions en DM 💌")

Retourne uniquement la caption reformulée.`
    }]
  });

  const caption = response.content[0].text.trim();

  // Utiliser un média varié (photo de famille, chaton, accompagnement...)
  const media = await getMediaRotation(client.id, 'story_accompagnement',
    ['famille_adoption', 'chaton_disponible', 'chat_adulte', 'coulisses', 'elevage']);
  const mediaUrl = media?.url || null;

  await supabase.from('queue').insert({
    client_id: client.id, media_id: media?.id || null, media_url: mediaUrl, caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_accompagnement'
  });

  console.log(`📸 Story accompagnement planifiée pour ${client.name}`);
  return true;
}

// ─────────────────────────────────────────────
// STORY 4 — REPOST DU DERNIER POST
// Reprend le dernier post publié ou planifié
// ─────────────────────────────────────────────
async function planifierStoryRepost(client, scheduledAt) {
  // Chercher le post publié aujourd'hui en priorité
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  let postRef = null;

  // 1. Post publié aujourd'hui
  const { data: postAujourdhui } = await supabase
    .from('queue').select('media_url, caption, media_id')
    .eq('client_id', client.id)
    .in('type', ['post', 'recycled', 'special'])
    .eq('statut', 'publie')
    .gte('published_at', today.toISOString())
    .lt('published_at', tomorrow.toISOString())
    .order('published_at', { ascending: false })
    .limit(1);

  if (postAujourdhui?.[0]) {
    postRef = postAujourdhui[0];
  } else {
    // 2. Dernier post publié (même si pas aujourd'hui)
    const { data: dernierPost } = await supabase
      .from('queue').select('media_url, caption, media_id')
      .eq('client_id', client.id)
      .in('type', ['post', 'recycled', 'special'])
      .eq('statut', 'publie')
      .order('published_at', { ascending: false })
      .limit(1);

    if (dernierPost?.[0]) postRef = dernierPost[0];
  }

  if (!postRef?.media_url) {
    // 3. Fallback : prochain post planifié
    const { data: prochainPost } = await supabase
      .from('queue').select('media_url, caption, media_id')
      .eq('client_id', client.id)
      .in('type', ['post', 'recycled', 'special'])
      .eq('statut', 'planifie')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1);

    if (prochainPost?.[0]) postRef = prochainPost[0];
  }

  if (!postRef?.media_url) {
    console.warn(`⚠️ ${client.name} — Story repost : aucun post trouvé`);
    return false;
  }

  // Caption courte pour le repost
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 80, temperature: 1,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de Love Queen Dolls (chatterie Ragdoll).
Génère une caption ultra-courte pour une story qui reposte ce post :
"${(postRef.caption || '').slice(0, 100)}"

- Maximum 1 phrase
- 1 emoji
- Encourage à voir le post (ex: "Notre post du jour 👆", "Vous avez vu notre dernière publication ? 👀")
- Varie chaque jour
Retourne uniquement la caption.`
    }]
  });

  const caption = response.content[0].text.trim();

  await supabase.from('queue').insert({
    client_id: client.id, media_id: postRef.media_id || null,
    media_url: postRef.media_url, caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_repost_post'
  });

  console.log(`📸 Story repost planifiée pour ${client.name}`);
  return true;
}

// ─────────────────────────────────────────────
// STORY PERSONNALISÉE À LA DEMANDE (client.html)
// Appelée depuis client-portal.js
// ─────────────────────────────────────────────
async function planifierStoryPersonnalisee(clientId, message, mediaUrl, scheduledAt) {
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
  if (!client) throw new Error('Client introuvable');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 150, temperature: 1,
    messages: [{
      role: 'user',
      content: `Tu gères le compte Instagram de Love Queen Dolls, chatterie Ragdoll.
Le client souhaite une story personnalisée avec ce message :
"${message}"

Génère une caption story adaptée :
- Maximum 2 phrases
- 1-2 emojis
- Ton chaleureux et authentique
- Adapté à une story Instagram
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
// PLANIFICATION 4 STORIES — ANTI-DOUBLON STRICT
// ─────────────────────────────────────────────
async function scheduleFixedStoriesForClient(client) {
  if (client.status === 'paused') return;

  // Calculer la base de la prochaine série
  const { data: lastStory } = await supabase
    .from('queue')
    .select('scheduled_at, published_at, statut')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .in('statut', ['planifie', 'en_cours', 'publie'])
    .not('source', 'eq', 'story_personnalisee') // Ignorer les stories perso pour le calcul
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let serieBase;
  if (lastStory?.[0]) {
    const ref = lastStory[0].published_at || lastStory[0].scheduled_at;
    serieBase = new Date(ref);
    const heuresDepuisRef = (Date.now() - serieBase.getTime()) / (1000 * 60 * 60);

    if (heuresDepuisRef < 20) {
      // Stories déjà planifiées pour aujourd'hui → demain à 8h
      serieBase = new Date();
      serieBase.setDate(serieBase.getDate() + 1);
      serieBase.setHours(8, 0, 0, 0);
    } else {
      // Stories passées → nouvelle série maintenant + 15 min
      serieBase = new Date();
      serieBase.setMinutes(serieBase.getMinutes() + 15);
    }
  } else {
    // Aucune story → commencer dans 15 minutes
    serieBase = new Date();
    serieBase.setMinutes(serieBase.getMinutes() + 15);
  }

  // Les 4 stories espacées de 3h sur la journée
  const storySlots = [
    { hoursOffset: 0, fn: planifierStoryChatsChatons,    source: 'story_chats_chatons'    },
    { hoursOffset: 3, fn: planifierStoryQuiSommesNous,   source: 'story_qui_sommes_nous'  },
    { hoursOffset: 6, fn: planifierStoryAccompagnement,  source: 'story_accompagnement'   },
    { hoursOffset: 9, fn: planifierStoryRepost,          source: 'story_repost_post'      },
  ];

  let storyPlanifiees = 0;

  for (const slot of storySlots) {
    const scheduledAt = new Date(serieBase);
    scheduledAt.setHours(scheduledAt.getHours() + slot.hoursOffset);

    // ANTI-DOUBLON : vérifier si cette source est déjà planifiée dans les 26h
    const dejaPresente = await storyDejaPlanifeePour(client.id, slot.source, serieBase);
    if (dejaPresente) {
      console.log(`⏭️ ${client.name} — "${slot.source}" déjà planifiée, ignorée`);
      continue;
    }

    try {
      const ok = await slot.fn(client, scheduledAt);
      if (ok) storyPlanifiees++;
    } catch(err) {
      console.error(`❌ Erreur story ${slot.source}:`, err.message);
    }
  }

  if (storyPlanifiees > 0) {
    console.log(`✅ ${client.name} — ${storyPlanifiees} story(s) planifiée(s) à partir du ${serieBase.toLocaleString('fr-FR')}`);
  } else {
    console.log(`ℹ️ ${client.name} — Toutes les stories sont déjà planifiées`);
  }
}

// ─────────────────────────────────────────────
// RECYCLAGE
// ─────────────────────────────────────────────
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

  const plan = getPlan(client);
  const frequency = await getClientFrequency(client);
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);

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

  let lastDate = lastPost?.[0]?.scheduled_at || new Date();
  const recycleIndex = plan.recyclage ? Math.floor(toCreate / 2) : -1;

  for (let i = 0; i < toCreate; i++) {
    const scheduledAt = getNextPublishDate(lastDate, frequency);
    lastDate = scheduledAt;
    let media = null, caption = '', postType = 'post';

    if (i === recycleIndex && plan.recyclage) {
      const recyclable = await selectRecyclablePost(client.id);
      if (recyclable) {
        media = recyclable;
        caption = await generateRecycledCaption(recyclable.caption, client, recyclable.performance_score,
          { likes: recyclable.likes, comments: recyclable.comments, reach: recyclable.reach });
        postType = 'recycled';
        await supabase.from('media').update({ recycled: true, last_used_at: new Date().toISOString(), use_count: (recyclable.use_count || 0) + 1 }).eq('id', recyclable.id);
      }
    }

    if (!media) {
      media = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption = await generateCaption(client, 'image', topPosts);
      postType = 'post';
    }

    if (!media?.url) { console.warn(`⚠️ ${client.name} — aucun média, post ignoré`); continue; }

    await supabase.from('queue').insert({
      client_id: client.id, media_id: media.id || null, media_url: media.url, caption,
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
  const { data: clients } = await supabase.from('clients').select('*').in('status', ['active', 'paused']);
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