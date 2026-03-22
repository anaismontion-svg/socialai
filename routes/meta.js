const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const {
  classifyMessage,
  generateReply,
  generateHumanNeededReply,
  scheduleFollowUp,
  cancelFollowUp,
  processFollowUps,
  replyToComment,
  replyToDM
} = require('./ai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const APP_SECRET    = process.env.META_APP_SECRET;
const REDIRECT_URI  = process.env.META_REDIRECT_URI;
const VERIFY_TOKEN  = process.env.META_VERIFY_TOKEN;

// ── Job de relance — vérifie toutes les heures ────────────────────────────────
setInterval(async () => {
  console.log('⏰ Vérification des relances...');
  await processFollowUps(supabase);
}, 60 * 60 * 1000);
processFollowUps(supabase);

// ── Auth OAuth Meta ───────────────────────────────────────────────────────────
router.get('/auth/meta', (req, res) => {
  res.redirect(`https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=911028448504932&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights`);
});

router.get('/auth/meta/callback', async (req, res) => {
  const { code, client_id } = req.query;
  try {
    const { data: tokenData } = await axios.post(
      `https://api.instagram.com/oauth/access_token`,
      new URLSearchParams({
        client_id: '911028448504932',
        client_secret: APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code
      })
    );

    const { data: longToken } = await axios.get(
      `https://graph.instagram.com/access_token`,
      { params: { grant_type: 'ig_exchange_token', client_secret: APP_SECRET, access_token: tokenData.access_token } }
    );

    const { data: igData } = await axios.get(
      `https://graph.instagram.com/v19.0/me`,
      { params: { fields: 'id,name,username', access_token: longToken.access_token } }
    );

    const { data: upsertData, error: upsertError } = await supabase
      .from('social_accounts')
      .upsert({
        client_id: client_id || null,
        platform: 'instagram',
        account_id: igData.id,
        account_name: igData.username || igData.name,
        access_token: longToken.access_token,
        token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      }, { onConflict: 'account_id' });

    console.log('Upsert error:', upsertError);
    res.json({ success: true, account: igData.username, dbError: upsertError });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur OAuth Meta', details: err.response?.data });
  }
});

// ── Webhook verification ──────────────────────────────────────────────────────
router.get('/webhook/meta', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Webhook réception messages ────────────────────────────────────────────────
router.post('/webhook/meta', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  res.sendStatus(200);

  if (body.object !== 'instagram') return;

  for (const entry of body.entry) {
    console.log('🔑 entry.id reçu:', entry.id);

    // ── Récupérer le compte + infos client ──────────────────────────────────
    const { data: account } = await supabase
      .from('social_accounts')
      .select('access_token, account_name, description, client_id')
      .eq('account_id', entry.id)
      .single();

    if (!account) { console.warn('⚠️ Compte introuvable pour', entry.id); continue; }

    // Récupérer les infos du client (solo ou équipe, email de contact)
    let isSoloEntrepreneur = true;
    let clientEmail = null;

    if (account.client_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('solo_entrepreneur, email')
        .eq('id', account.client_id)
        .single();

      if (client) {
        // Si la colonne solo_entrepreneur n'existe pas encore, on reste à true par défaut
        isSoloEntrepreneur = client.solo_entrepreneur !== false;
        clientEmail = client.email || null;
      }
    }

    // ── DMs ──────────────────────────────────────────────────────────────────
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message) continue;

        const senderId   = event.sender?.id;
        const messageText = event.message?.text;
        const senderUsername = event.sender?.username || '';

        if (!messageText || senderId === entry.id) continue;

        console.log('📩 DM reçu de', senderId, ':', messageText);

        try {
          await cancelFollowUp(supabase, senderId);

          const classification = await classifyMessage(messageText);
          console.log('🔍 Classification:', classification);

          if (classification.besoin_humain) {
            console.log('🙋 Intervention humaine requise (', classification.categorie, ')');
            const transitionReply = await generateHumanNeededReply(
              account.account_name,
              account.access_token,
              senderId,
              classification.categorie,
              messageText,
              senderUsername,
              isSoloEntrepreneur
            );
            if (transitionReply) {
              await replyToDM(senderId, transitionReply, account.access_token);
            }
            continue;
          }

          const reply = await generateReply(
            messageText,
            account.account_name,
            senderId,
            account.access_token,
            account.description,
            senderUsername,
            isSoloEntrepreneur,
            clientEmail
          );

          if (reply) {
            console.log('🤖 Réponse DM:', reply);
            await replyToDM(senderId, reply, account.access_token);
            await scheduleFollowUp(supabase, senderId, entry.id, account.access_token);
          }

        } catch (err) {
          console.error('❌ Erreur DM:', err.response?.data || err.message);
        }
      }
    }

    // ── Commentaires ──────────────────────────────────────────────────────────
    if (entry.changes) {
      for (const change of entry.changes) {
        console.log('📣 Événement:', change.field, change.value);

        if (change.field !== 'comments') continue;

        const commentId   = change.value?.id;
        const commentText = change.value?.text;
        if (!commentId || !commentText) continue;

        console.log('💬 Commentaire reçu:', commentText);

        try {
          const classification = await classifyMessage(commentText);
          console.log('🔍 Classification:', classification);

          if (classification.besoin_humain) {
            console.log('🙋 Commentaire sensible (', classification.categorie, ') — laissé sans réponse');
            continue;
          }

          const reply = await generateReply(
            commentText,
            account.account_name,
            change.value?.from?.id || '',
            account.access_token,
            account.description,
            change.value?.from?.username || '',
            isSoloEntrepreneur,
            clientEmail
          );

          if (reply) {
            console.log('🤖 Réponse commentaire:', reply);
            await replyToComment(commentId, reply, account.access_token);
          }

        } catch (err) {
          console.error('❌ Erreur commentaire:', err.response?.data || err.message);
        }
      }
    }
  }
});

module.exports = router;