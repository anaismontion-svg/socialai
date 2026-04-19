const axios     = require('axios');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// LIMITES STRICTES PAR JOUR
// ─────────────────────────────────────────────
const LIMITES_JOUR = {
  post:    1,  // max 1 post par jour
  story:   4,  // max 4 stories par jour
  reel:    1,
  special: 1,
};

async function countPublicationsAujourdhui(clientId, type) {
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  const fin = new Date();
  fin.setHours(23, 59, 59, 999);

  const { count } = await supabase
    .from('queue')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('type', type)
    .eq('statut', 'publie')
    .gte('scheduled_at', debut.toISOString())
    .lte('scheduled_at', fin.toISOString());

  return count || 0;
}

async function sendLowContentAlert(client) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to:   process.env.GMAIL_USER,
      subject: `🚨 URGENT — Contenu faible pour ${client.name}`,
      text: `Le compte de votre client ${client.name} manque de contenu.\nIl reste moins de 5 médias disponibles.\n---\nSocialAI — Alerte automatique`
    });
    console.log(`📧 Alerte contenu faible envoyée pour ${client.name}`);
  } catch (err) {
    console.error('❌ Erreur envoi alerte:', err.message);
  }
}

async function generateCaption(client, mediaType, topPosts = []) {
  const topPostsContext = topPosts.length > 0
    ? `\nVoici les posts qui ont le mieux marché :\n${topPosts.map(p => `- "${p.caption}" (${p.likes || 0} likes, ${p.comments || 0} commentaires)`).join('\n')}`
    : '';
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Tu es un expert en community management Instagram et Facebook.
Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Ton souhaité : ${client.tone || 'professionnel'}
Type de média : ${mediaType}
${topPostsContext}
Génère une caption engageante pour Instagram/Facebook.
- Commence par une phrase accrocheuse
- Utilise des émojis pertinents (3-5 max)
- Ajoute 5 hashtags pertinents à la fin
- Maximum 150 mots
- Ton naturel et humain, jamais robotique
- Ne mets pas de guillemets autour de la caption`
    }]
  });
  return message.content[0].text;
}

async function getTopPosts(clientId) {
  const { data } = await supabase
    .from('queue').select('caption, likes, comments')
    .eq('client_id', clientId).eq('statut', 'publie')
    .order('likes', { ascending: false }).limit(3);
  return data || [];
}

async function waitForContainer(accessToken, containerId, maxAttempts = 24) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusRes = await axios.get(
      `https://graph.instagram.com/v19.0/${containerId}`,
      { params: { fields: 'status_code', access_token: accessToken } }
    );
    const status = statusRes.data.status_code;
    console.log(`  ⏳ Container ${containerId} — statut : ${status} (tentative ${i + 1}/${maxAttempts})`);
    if (status === 'FINISHED') return true;
    if (status === 'ERROR') throw new Error(`Container ${containerId} en erreur`);
  }
  throw new Error(`Timeout container ${containerId} après ${maxAttempts * 5}s`);
}

async function publishToInstagram(accessToken, igAccountId, mediaUrl, caption, mediaType) {
  try {
    const containerRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media`, null,
      { params: {
        image_url: mediaType === 'image' ? mediaUrl : undefined,
        video_url: mediaType === 'video' ? mediaUrl : undefined,
        media_type: mediaType === 'video' ? 'REELS' : 'IMAGE',
        caption, access_token: accessToken
      }}
    );
    const containerId = containerRes.data.id;
    console.log(`  ⏳ Container créé (${containerId}), attente validation Meta...`);
    await waitForContainer(accessToken, containerId);
    const publishRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`, null,
      { params: { creation_id: containerId, access_token: accessToken } }
    );
    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('❌ Erreur publication Instagram:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

async function publishCarouselToInstagram(accessToken, igAccountId, mediaUrls, caption) {
  try {
    const childIds = [];
    for (const url of mediaUrls) {
      const isVideo = url.match(/\.(mp4|mov|avi)$/i);
      const childRes = await axios.post(
        `https://graph.instagram.com/v19.0/${igAccountId}/media`, null,
        { params: {
          image_url: !isVideo ? url : undefined,
          video_url: isVideo ? url : undefined,
          media_type: isVideo ? 'VIDEO' : 'IMAGE',
          is_carousel_item: true, access_token: accessToken
        }}
      );
      const childId = childRes.data.id;
      console.log(`  ⏳ Container slide créé (${childId}), attente...`);
      await waitForContainer(accessToken, childId);
      childIds.push(childId);
      console.log(`  📎 Slide ${childIds.length}/${mediaUrls.length} prête`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const parentRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media`, null,
      { params: { media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: accessToken }}
    );
    const parentId = parentRes.data.id;
    console.log(`  ⏳ Container carousel parent créé (${parentId}), attente...`);
    await waitForContainer(accessToken, parentId);
    const publishRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`, null,
      { params: { creation_id: parentId, access_token: accessToken }}
    );
    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('❌ Erreur publication carousel:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

async function publishStoryToInstagram(accessToken, igAccountId, mediaUrl, mediaType) {
  try {
    if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.startsWith('http')) {
      throw new Error(`URL média invalide pour la story: "${mediaUrl}"`);
    }
    const isVideo = mediaType === 'video' || /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl);
    const params = { media_type: 'STORIES', access_token: accessToken };
    if (isVideo) { params.video_url = mediaUrl; } else { params.image_url = mediaUrl; }

    const containerRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media`, null, { params }
    );
    const containerId = containerRes.data.id;
    console.log(`  ⏳ Container story créé (${containerId}), attente...`);
    await waitForContainer(accessToken, containerId);
    const publishRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`, null,
      { params: { creation_id: containerId, access_token: accessToken }}
    );
    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('❌ Erreur publication story:', JSON.stringify(err.response?.data || err.message, null, 2));
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

async function markMediaAsUsed(mediaId) {
  if (!mediaId) return;
  try {
    const { data: current } = await supabase
      .from('media').select('use_count').eq('id', mediaId).single();
    await supabase.from('media').update({
      used:         true,
      reserved:     false,
      reserved_at:  null,
      last_used_at: new Date().toISOString(),
      use_count:    (current?.use_count || 0) + 1
    }).eq('id', mediaId);
  } catch(err) {
    console.error(`❌ Erreur markMediaAsUsed ${mediaId}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// MOTEUR PRINCIPAL DE PUBLICATION
// avec limites strictes par jour
// ─────────────────────────────────────────────
async function processQueue() {
  const now = new Date();

  const { data: accountsData } = await supabase
    .from('social_accounts').select('client_id, access_token, account_id')
    .eq('platform', 'instagram');

  if (!accountsData || accountsData.length === 0) return;

  const validClientIds   = accountsData.map(a => a.client_id);
  const accountsByClient = {};
  accountsData.forEach(a => { accountsByClient[a.client_id] = a; });

  const { data: items, error } = await supabase
    .from('queue').select('*, clients(*)')
    .eq('statut', 'planifie')
    .lte('scheduled_at', now.toISOString())
    .in('client_id', validClientIds)
    .order('scheduled_at', { ascending: true })
    .limit(10);

  if (error || !items || items.length === 0) return;

  console.log(`📤 ${items.length} publication(s) à traiter...`);

  // Compteurs par client pour cette session
  const sessionCount = {};

  for (const item of items) {
    const client = item.clients;
    if (!client) continue;

    try {
      const socialAccount = accountsByClient[client.id];
      if (!socialAccount) {
        console.warn(`⚠️ Pas de compte Instagram pour ${client.name}`);
        continue;
      }

      // ── VÉRIFICATION LIMITE QUOTIDIENNE ──────────────────────────────────
      const typeNorm = ['post', 'recycled', 'special'].includes(item.type) ? 'post' : item.type;
      const limite = LIMITES_JOUR[typeNorm] || 1;

      // Compter les publications du jour depuis la DB
      const dejaPublieeDB = await countPublicationsAujourdhui(client.id, item.type);

      // Compter aussi les publications de cette session
      const keySession = `${client.id}_${typeNorm}`;
      const dejaPublieeSession = sessionCount[keySession] || 0;

      const totalPubliee = dejaPublieeDB + dejaPublieeSession;

      if (totalPubliee >= limite) {
        console.warn(`🚫 ${client.name} — Limite atteinte pour "${typeNorm}" (${totalPubliee}/${limite}) — item ignoré`);
        // Repousser l'item à demain pour ne pas le republier
        const demain = new Date();
        demain.setDate(demain.getDate() + 1);
        demain.setHours(9, 0, 0, 0);
        await supabase.from('queue').update({
          scheduled_at: demain.toISOString()
        }).eq('id', item.id);
        continue;
      }

      let caption = item.caption;
      if (!caption) {
        const topPosts = await getTopPosts(client.id);
        caption = await generateCaption(client, item.type, topPosts);
      }

      let result;
      const mediaIdsUsed = [];

      if (item.type === 'carousel') {
        let mediaUrls = item.media_urls || [];
        if (!mediaUrls.length && item.media_ids?.length) {
          const { data: medias } = await supabase
            .from('media').select('url, id').in('id', item.media_ids);
          mediaUrls = medias?.map(m => m.url) || [];
          medias?.forEach(m => mediaIdsUsed.push(m.id));
        }
        if (mediaUrls.length < 2) throw new Error('Carousel requiert au moins 2 slides');
        result = await publishCarouselToInstagram(
          socialAccount.access_token, socialAccount.account_id, mediaUrls, caption
        );

      } else if (item.type === 'story') {
        let storyUrl = item.media_url;
        if (!storyUrl && item.media_id) {
          const { data: media } = await supabase
            .from('media').select('url, type').eq('id', item.media_id).single();
          if (media?.url) storyUrl = media.url;
        }
        if (!storyUrl || !storyUrl.startsWith('http')) {
          console.warn(`⚠️ ${client.name} — Story ignorée (pas de média valide)`);
          await supabase.from('queue').update({
            statut: 'erreur',
            error_message: 'Aucun média disponible pour cette story'
          }).eq('id', item.id);
          continue;
        }
        console.log(`📖 Publication story pour ${client.name} (source: ${item.source})`);
        const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(storyUrl);
        result = await publishStoryToInstagram(
          socialAccount.access_token, socialAccount.account_id,
          storyUrl, isVideo ? 'video' : 'image'
        );
        if (item.media_id && item.source !== 'story_repost_post') {
          mediaIdsUsed.push(item.media_id);
        }

      } else {
        let mediaUrl = item.media_url;
        if (!mediaUrl && item.media_id) {
          const { data: media } = await supabase
            .from('media').select('url, type').eq('id', item.media_id).single();
          if (media) mediaUrl = media.url;
        }
        if (!mediaUrl) throw new Error('Aucun média disponible');
        if (item.media_id) mediaIdsUsed.push(item.media_id);
        const mediaType = item.type === 'reel' ? 'video' : 'image';
        result = await publishToInstagram(
          socialAccount.access_token, socialAccount.account_id, mediaUrl, caption, mediaType
        );
      }

      if (result.success) {
        await supabase.from('queue').update({
          statut:            'publie',
          published_at:      now.toISOString(),
          caption,
          instagram_post_id: result.postId
        }).eq('id', item.id);

        for (const mediaId of mediaIdsUsed) {
          await markMediaAsUsed(mediaId);
        }

        // Incrémenter le compteur de session
        sessionCount[keySession] = (sessionCount[keySession] || 0) + 1;

        console.log(`✅ Publié pour ${client.name} — ${item.type} (${totalPubliee + 1}/${limite} aujourd'hui)`);

      } else {
        if (item.media_id) {
          await supabase.from('media').update({ reserved: false, reserved_at: null }).eq('id', item.media_id);
        }
        await supabase.from('queue').update({
          statut: 'erreur', error_message: result.error
        }).eq('id', item.id);
        console.error(`❌ Échec publication pour ${client.name}:`, result.error);
      }

    } catch (err) {
      console.error(`❌ Erreur traitement item ${item.id}:`, err.message);
      if (item.media_id) {
        await supabase.from('media').update({ reserved: false, reserved_at: null }).eq('id', item.media_id);
      }
      await supabase.from('queue').update({
        statut: 'erreur', error_message: err.message
      }).eq('id', item.id);
    }
  }
}

async function checkLowContent() {
  const { data: clients } = await supabase.from('clients').select('*').eq('status', 'active');
  if (!clients) return;
  for (const client of clients) {
    const { count } = await supabase
      .from('media').select('*', { count: 'exact', head: true })
      .eq('client_id', client.id).eq('used', false);
    if (count !== null && count < 5) {
      console.warn(`⚠️ Contenu faible pour ${client.name} (${count} médias restants)`);
      await sendLowContentAlert(client);
    }
  }
}

module.exports = { processQueue, checkLowContent, generateCaption, getTopPosts };