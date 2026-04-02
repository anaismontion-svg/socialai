const { createClient } = require('@supabase/supabase-js');
const { generateCaption, getTopPosts } = require('./publisher');
const { syncAllClients, updateAllStats, recalculateScores } = require('./instagram-sync');
const axios = require('axios');

const supabase      = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
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
  const hour = BEST_HOURS.post[Math.floor(Math.random() * BEST_HOURS.post.length)];
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function getClientFrequency(client) {
  return getPlan(client).postsPerWeek >= 7 ? 'daily' : '3x_week';
}

async function getAvailableMedia(clientId, category = null) {
  let query = supabase
    .from('media').select('*')
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
    const payload = { client_id: client.id, client_name: client.name, branding: client.branding || {}, story_type: storyType, content };
    const response = await axios.post(`${ASSEMBLER_URL}/story`, payload, { responseType: 'arraybuffer', timeout: 60000 });
    const buffer   = Buffer.from(response.data);
    const filename = `story_${storyType}_${Date.now()}.jpg`;
    const path     = `stories/${client.id}/${filename}`;
    const { error } = await supabaseAdmin.storage.from('media').upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`Upload: ${error.message}`);
    const { data } = supabaseAdmin.storage.from('media').getPublicUrl(path);
    return data.publicUrl;
  } catch(err) {
    console.warn(`⚠️ Assembleur story indisponible: ${err.message}`);
    return null;
  }
}

async function getStoryTemplate(clientId, type) {
  const { data } = await supabase.from('story_templates').select('*')
    .eq('client_id', clientId).eq('type', type).eq('actif', true).single();
  return data || null;
}

// ─────────────────────────────────────────────
// VÉRIFICATION ANTI-DOUBLON — CLEF DU FIX
// Vérifie si une story de ce TYPE SOURCE existe déjà
// dans les prochaines 26h (marge de sécurité > 24h)
// ─────────────────────────────────────────────
async function storyDejaPlanifeePour(clientId, source, depuisDate) {
  const jusqu = new Date(depuisDate);
  jusqu.setHours(jusqu.getHours() + 26); // fenêtre 26h

  const { data } = await supabase
    .from('queue')
    .select('id, scheduled_at, statut')
    .eq('client_id', clientId)
    .eq('source', source)
    .in('statut', ['planifie', 'en_cours', 'publie'])
    .gte('scheduled_at', depuisDate.toISOString())
    .lt('scheduled_at', jusqu.toISOString());

  return (data && data.length > 0);
}

// ─────────────────────────────────────────────
// STORIES INDIVIDUELLES
// ─────────────────────────────────────────────
async function planifierStoryEntreprise(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'entreprise');
  let mediaUrl = template?.visuel_url || null;
  const needsRegen = !mediaUrl ||
    (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);
  if (needsRegen) {
    const content = template?.content || { titre: client.name, sous_titre: client.description || 'Découvrez notre univers', texte: client.description || '' };
    const newUrl = await generateStoryVisual(client, 'entreprise', content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({ client_id: client.id, type: 'entreprise', visuel_url: newUrl, generated_at: new Date().toISOString(), content, actif: true }, { onConflict: 'client_id,type' });
    }
  }
  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    mediaUrl = media?.url || null;
  }
  if (!mediaUrl) { console.warn(`⚠️ ${client.name} — Story entreprise ignorée : aucun visuel`); return false; }
  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl,
    caption: `${client.name} — Qui sommes-nous ?`,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_entreprise'
  });
  console.log(`📸 Story entreprise planifiée pour ${client.name} à ${scheduledAt.toLocaleString('fr-FR')}`);
  return true;
}

async function planifierStoryTarifs(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'tarifs');
  let mediaUrl = null, mediaId = null;
  const mediaTaggee = await getAvailableMedia(client.id, 'tarifs');
  if (mediaTaggee?.url) { mediaUrl = mediaTaggee.url; mediaId = mediaTaggee.id; }
  else if (template?.visuel_url) { mediaUrl = template.visuel_url; }
  else {
    const content = template?.content || { titre: 'Nos tarifs', services: client.description || 'Contactez-nous pour en savoir plus' };
    const newUrl = await generateStoryVisual(client, 'tarifs', content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({ client_id: client.id, type: 'tarifs', visuel_url: newUrl, generated_at: new Date().toISOString(), content, actif: true }, { onConflict: 'client_id,type' });
    }
  }
  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    if (media?.url) { mediaUrl = media.url; mediaId = media.id; }
  }
  if (!mediaUrl) { console.warn(`⚠️ ${client.name} — Story tarifs ignorée : aucun visuel`); return false; }
  await supabase.from('queue').insert({
    client_id: client.id, media_id: mediaId, media_url: mediaUrl,
    caption: 'Nos services & tarifs ✨',
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_tarifs'
  });
  console.log(`📸 Story tarifs planifiée pour ${client.name} à ${scheduledAt.toLocaleString('fr-FR')}`);
  return true;
}

async function planifierStoryTemoignage(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'temoignage');
  let mediaUrl = template?.visuel_url || null;
  const needsRegen = !mediaUrl || (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);
  if (needsRegen && template?.content) {
    const newUrl = await generateStoryVisual(client, 'temoignage', template.content);
    if (newUrl) {
      mediaUrl = newUrl;
      await supabase.from('story_templates').upsert({ client_id: client.id, type: 'temoignage', visuel_url: newUrl, generated_at: new Date().toISOString(), content: template.content, actif: true }, { onConflict: 'client_id,type' });
    }
  }
  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id, 'temoignage') || await getAvailableMedia(client.id);
    mediaUrl = media?.url || null;
  }
  if (!mediaUrl) { console.warn(`⚠️ ${client.name} — Story témoignage ignorée`); return false; }
  const caption = template?.content?.texte ? `"${template.content.texte.slice(0, 80)}..." ⭐` : 'Ce que nos clients disent de nous ⭐';
  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl, caption,
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_temoignage'
  });
  console.log(`📸 Story témoignage planifiée pour ${client.name} à ${scheduledAt.toLocaleString('fr-FR')}`);
  return true;
}

async function planifierStoryAvantApres(client, scheduledAt) {
  const template = await getStoryTemplate(client.id, 'avant_apres');
  let mediaUrl = template?.visuel_url || null;
  const needsRegen = !mediaUrl || (template?.generated_at && (Date.now() - new Date(template.generated_at)) > 7 * 24 * 3600 * 1000);
  if (needsRegen) {
    const mediaAvant = await getAvailableMedia(client.id, 'avant');
    const mediaApres = await getAvailableMedia(client.id, 'apres');
    if (mediaAvant?.url && mediaApres?.url) {
      const content = { url_avant: mediaAvant.url, url_apres: mediaApres.url, titre: template?.content?.titre || 'Avant / Après', sous_titre: client.name };
      const newUrl = await generateStoryVisual(client, 'avant_apres', content);
      if (newUrl) {
        mediaUrl = newUrl;
        await supabase.from('story_templates').upsert({ client_id: client.id, type: 'avant_apres', visuel_url: newUrl, generated_at: new Date().toISOString(), content, actif: true }, { onConflict: 'client_id,type' });
      }
    }
  }
  if (!mediaUrl) {
    const media = await getAvailableMedia(client.id);
    mediaUrl = media?.url || null;
  }
  if (!mediaUrl) { console.warn(`⚠️ ${client.name} — Story avant/après ignorée`); return false; }
  await supabase.from('queue').insert({
    client_id: client.id, media_url: mediaUrl,
    caption: 'La transformation parle d\'elle-même ✨',
    scheduled_at: scheduledAt.toISOString(),
    type: 'story', platform: 'instagram', statut: 'planifie',
    source: 'story_fixe_avant_apres'
  });
  console.log(`📸 Story avant/après planifiée pour ${client.name} à ${scheduledAt.toLocaleString('fr-FR')}`);
  return true;
}

// ─────────────────────────────────────────────
// PLANIFICATION 4 STORIES — CORRIGÉE
// Anti-doublon strict : 1 story par type par jour
// ─────────────────────────────────────────────
async function scheduleFixedStoriesForClient(client) {
  if (client.status === 'paused') return;

  // ── ÉTAPE 1 : Calculer la date de la prochaine série ─────────────────────
  // Chercher la dernière story publiée ou planifiée toutes sources confondues
  const { data: lastStory } = await supabase
    .from('queue')
    .select('scheduled_at, published_at, statut')
    .eq('client_id', client.id)
    .eq('type', 'story')
    .in('statut', ['planifie', 'en_cours', 'publie'])
    .order('scheduled_at', { ascending: false })
    .limit(1);

  let serieBase;
  if (lastStory?.[0]) {
    const ref = lastStory[0].published_at || lastStory[0].scheduled_at;
    serieBase = new Date(ref);

    // Si la dernière story est dans le futur ou moins de 20h passé → déjà planifié pour aujourd'hui
    const heuresDepuisRef = (Date.now() - serieBase.getTime()) / (1000 * 60 * 60);
    if (heuresDepuisRef < 20) {
      // La prochaine série sera demain à partir de minuit + heure de début
      serieBase.setDate(serieBase.getDate() + 1);
      serieBase.setHours(8, 0, 0, 0); // Commencer à 8h le lendemain
    } else {
      // Les stories d'aujourd'hui sont passées → nouvelle série maintenant
      serieBase = new Date();
      serieBase.setMinutes(serieBase.getMinutes() + 15);
    }
  } else {
    // Aucune story → commencer dans 15 minutes
    serieBase = new Date();
    serieBase.setMinutes(serieBase.getMinutes() + 15);
  }

  // ── ÉTAPE 2 : Les 4 slots de la série (espacés de 3h) ───────────────────
  // On espace les 4 stories sur la journée (pas en rafale à 5 min d'intervalle)
  const storySlots = [
    { hoursOffset: 0,  fn: planifierStoryEntreprise, source: 'story_fixe_entreprise'  },
    { hoursOffset: 3,  fn: planifierStoryTarifs,     source: 'story_fixe_tarifs'      },
    { hoursOffset: 6,  fn: planifierStoryTemoignage, source: 'story_fixe_temoignage'  },
    { hoursOffset: 9,  fn: planifierStoryAvantApres, source: 'story_fixe_avant_apres' },
  ];

  let storyPlanifiees = 0;

  for (const slot of storySlots) {
    const scheduledAt = new Date(serieBase);
    scheduledAt.setHours(scheduledAt.getHours() + slot.hoursOffset);

    // ── ANTI-DOUBLON STRICT ────────────────────────────────────────────────
    // Vérifier si cette source a déjà une story planifiée ou publiée
    // dans les prochaines 24h à partir de serieBase
    const dejaPresente = await storyDejaPlanifeePour(client.id, slot.source, serieBase);

    if (dejaPresente) {
      console.log(`⏭️ ${client.name} — Story "${slot.source}" déjà planifiée pour cette période, ignorée`);
      continue;
    }

    // Planifier la story
    const ok = await slot.fn(client, scheduledAt);
    if (ok) storyPlanifiees++;
  }

  if (storyPlanifiees > 0) {
    console.log(`✅ ${client.name} — ${storyPlanifiees} nouvelle(s) story(s) planifiée(s) à partir du ${serieBase.toLocaleString('fr-FR')}`);
  } else {
    console.log(`ℹ️ ${client.name} — Toutes les stories sont déjà planifiées`);
  }
}

// ─────────────────────────────────────────────
// NETTOYAGE DES DOUBLONS EXISTANTS
// Supprime les stories en double dans la queue
// ─────────────────────────────────────────────
async function cleanDuplicateStories(clientId) {
  console.log(`🧹 Nettoyage des stories en doublon pour client ${clientId}...`);

  const sources = ['story_fixe_entreprise', 'story_fixe_tarifs', 'story_fixe_temoignage', 'story_fixe_avant_apres'];

  for (const source of sources) {
    const { data: stories } = await supabase
      .from('queue')
      .select('id, scheduled_at')
      .eq('client_id', clientId)
      .eq('source', source)
      .eq('statut', 'planifie')
      .order('scheduled_at', { ascending: true });

    if (!stories || stories.length <= 1) continue;

    // Grouper par jour et ne garder que le premier de chaque jour
    const byDay = {};
    const toDelete = [];

    for (const s of stories) {
      const day = new Date(s.scheduled_at).toDateString();
      if (byDay[day]) {
        toDelete.push(s.id); // Doublon → à supprimer
      } else {
        byDay[day] = s.id;
      }
    }

    if (toDelete.length > 0) {
      await supabase.from('queue').delete().in('id', toDelete);
      console.log(`🗑️ ${toDelete.length} doublon(s) supprimé(s) pour source "${source}"`);
    }
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
        await supabase.from('media').update({ recycled: true, last_used_at: new Date().toISOString(), use_count: (recyclable.use_count || 0) + 1 }).eq('id', recyclable.id);
      }
    }

    if (!media) {
      media    = await getAvailableMedia(client.id);
      const topPosts = await getTopPosts(client.id);
      caption  = await generateCaption(client, 'image', topPosts);
      postType = 'post';
    }

    const mediaUrl = media?.url || null;
    if (!mediaUrl) { console.warn(`⚠️ ${client.name} — aucun média disponible, post ignoré`); continue; }

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
    .from('clients').select('*').in('status', ['active', 'paused']);

  if (!clients?.length) { console.log('Aucun client'); return; }

  for (const client of clients) {
    try {
      // Nettoyer les doublons existants avant de planifier
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
  cleanDuplicateStories,
  selectRecyclablePost,
  generateRecycledCaption,
  getPlan,
  PLANS
};