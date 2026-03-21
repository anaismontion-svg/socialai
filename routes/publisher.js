const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Envoi email alerte contenu faible ────────────────────────────────────────
async function sendLowContentAlert(client) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `🚨 URGENT — Contenu faible pour ${client.name}`,
      text: `
Bonjour,

Le compte de votre client ${client.name} manque de contenu pour continuer les publications automatiques.

Il reste moins de 5 médias disponibles dans la médiathèque.

Merci de demander à ${client.name} d'envoyer de nouvelles photos et vidéos dès que possible pour ne pas interrompre le planning de publication.

---
SocialAI — Alerte automatique
      `.trim()
    });

    console.log(`📧 Alerte contenu faible envoyée pour ${client.name}`);
  } catch (err) {
    console.error('❌ Erreur envoi alerte:', err.message);
  }
}

// ── Génération caption IA ─────────────────────────────────────────────────────
async function generateCaption(client, mediaType, topPosts = []) {
  const topPostsContext = topPosts.length > 0
    ? `\nVoici les posts qui ont le mieux marché pour ce compte (inspire-toi de leur style) :\n${topPosts.map(p => `- "${p.caption}" (${p.likes || 0} likes, ${p.comments || 0} commentaires)`).join('\n')}`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
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

// ── Récupérer les top posts du client ────────────────────────────────────────
async function getTopPosts(clientId) {
  const { data } = await supabase
    .from('queue')
    .select('caption, likes, comments')
    .eq('client_id', clientId)
    .eq('statut', 'publie')
    .order('likes', { ascending: false })
    .limit(3);
  return data || [];
}

// ── Publier un post Instagram ─────────────────────────────────────────────────
async function publishToInstagram(accessToken, igAccountId, mediaUrl, caption, mediaType) {
  try {
    // Étape 1 : Créer le container
    const containerRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media`,
      null,
      {
        params: {
          image_url: mediaType === 'image' ? mediaUrl : undefined,
          video_url: mediaType === 'video' ? mediaUrl : undefined,
          media_type: mediaType === 'video' ? 'REELS' : 'IMAGE',
          caption,
          access_token: accessToken
        }
      }
    );

    const containerId = containerRes.data.id;

    // Attendre que le container soit prêt (pour les vidéos)
    if (mediaType === 'video') {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    // Étape 2 : Publier le container
    const publishRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: containerId,
          access_token: accessToken
        }
      }
    );

    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('❌ Erreur publication Instagram:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

// ── Publier une story Instagram ───────────────────────────────────────────────
async function publishStoryToInstagram(accessToken, igAccountId, mediaUrl, mediaType) {
  try {
    const containerRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media`,
      null,
      {
        params: {
          image_url: mediaType === 'image' ? mediaUrl : undefined,
          video_url: mediaType === 'video' ? mediaUrl : undefined,
          media_type: 'STORIES',
          access_token: accessToken
        }
      }
    );

    const containerId = containerRes.data.id;

    if (mediaType === 'video') {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    const publishRes = await axios.post(
      `https://graph.instagram.com/v19.0/${igAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: containerId,
          access_token: accessToken
        }
      }
    );

    return { success: true, postId: publishRes.data.id };
  } catch (err) {
    console.error('❌ Erreur publication story:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

// ── Moteur principal de publication ──────────────────────────────────────────
async function processQueue() {
  const now = new Date();

  // Récupérer les posts prêts à publier
  const { data: items, error } = await supabase
    .from('queue')
    .select('*, clients(*)')
    .eq('statut', 'planifie')
    .lte('scheduled_at', now.toISOString())
    .limit(10);

  if (error || !items || items.length === 0) return;

  console.log(`📤 ${items.length} publication(s) à traiter...`);

  for (const item of items) {
    const client = item.clients;
    if (!client) continue;

    try {
      // Récupérer le token Instagram du compte
      const { data: socialAccount } = await supabase
        .from('social_accounts')
        .select('access_token, account_id')
        .eq('client_id', client.id)
        .eq('platform', 'instagram')
        .single();

      if (!socialAccount) {
        console.warn(`⚠️ Pas de compte Instagram pour ${client.name}`);
        continue;
      }

      // Générer la caption si elle n'existe pas
      let caption = item.caption;
      if (!caption) {
        const topPosts = await getTopPosts(client.id);
        caption = await generateCaption(client, item.type, topPosts);
      }

      // Récupérer l'URL du média
      let mediaUrl = item.media_url;
      if (!mediaUrl && item.media_id) {
        const { data: media } = await supabase
          .from('media')
          .select('url, type')
          .eq('id', item.media_id)
          .single();
        if (media) mediaUrl = media.url;
      }

      if (!mediaUrl) {
        console.warn(`⚠️ Pas de média pour l'item ${item.id}`);
        await supabase.from('queue').update({
          statut: 'erreur',
          error_message: 'Aucun média disponible'
        }).eq('id', item.id);
        continue;
      }

      // Publier selon le type
      let result;
      if (item.type === 'story') {
        result = await publishStoryToInstagram(
          socialAccount.access_token,
          socialAccount.account_id,
          mediaUrl,
          'image'
        );
      } else {
        result = await publishToInstagram(
          socialAccount.access_token,
          socialAccount.account_id,
          mediaUrl,
          caption,
          'image'
        );
      }

      // Mettre à jour le statut
      if (result.success) {
        await supabase.from('queue').update({
          statut: 'publie',
          published_at: now.toISOString(),
          caption
        }).eq('id', item.id);
        console.log(`✅ Publié pour ${client.name} — ${item.type}`);
      } else {
        await supabase.from('queue').update({
          statut: 'erreur',
          error_message: result.error
        }).eq('id', item.id);
        console.error(`❌ Échec publication pour ${client.name}:`, result.error);
      }

    } catch (err) {
      console.error(`❌ Erreur traitement item ${item.id}:`, err.message);
      await supabase.from('queue').update({
        statut: 'erreur',
        error_message: err.message
      }).eq('id', item.id);
    }
  }
}

// ── Vérification contenu faible ───────────────────────────────────────────────
async function checkLowContent() {
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const { count } = await supabase
      .from('media')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('used', false);

    if (count !== null && count < 5) {
      console.warn(`⚠️ Contenu faible pour ${client.name} (${count} médias restants)`);
      await sendLowContentAlert(client);
    }
  }
}

module.exports = { processQueue, checkLowContent, generateCaption, getTopPosts };