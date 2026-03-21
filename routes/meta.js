const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { generateReply, replyToComment, replyToDM } = require('./ai');

const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

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
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: APP_SECRET,
          access_token: tokenData.access_token
        }
      }
    );

    const { data: igData } = await axios.get(
      `https://graph.instagram.com/v19.0/me`,
      {
        params: {
          fields: 'id,name,username',
          access_token: longToken.access_token
        }
      }
    );

    const { data: upsertData, error: upsertError } = await supabase.from('social_accounts').upsert({
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

router.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post('/webhook/meta', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = JSON.parse(req.body);
  res.sendStatus(200);

  if (body.object === 'instagram') {
    for (const entry of body.entry) {

      // ── DMs ──────────────────────────────────────────────────────────────
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.message) {
            const senderId = event.sender?.id;
            const messageText = event.message?.text;
            if (!messageText || senderId === entry.id) continue;
            console.log('📩 DM reçu de', senderId, ':', messageText);
            try {
              const { data: accounts } = await supabase
                .from('social_accounts')
                .select('access_token, account_name')
                .eq('account_id', entry.id)
                .single();
              if (!accounts) { console.warn('⚠️ Compte introuvable'); continue; }
              const reply = await generateReply(messageText, 'professionnel', accounts.account_name);
              console.log('🤖 Réponse DM:', reply);
              await replyToDM(senderId, reply, accounts.access_token);
            } catch (err) {
              console.error('❌ Erreur DM:', err.response?.data || err.message);
            }
          }
        }
      }

      // ── Commentaires ─────────────────────────────────────────────────────
      if (entry.changes) {
        for (const change of entry.changes) {
          console.log('📣 Événement:', change.field, change.value);
          if (change.field === 'comments') {
            const commentId = change.value?.id;
            const commentText = change.value?.text;
            if (!commentId || !commentText) continue;
            console.log('💬 Commentaire reçu:', commentText);
            try {
              const { data: accounts } = await supabase
                .from('social_accounts')
                .select('access_token, account_name')
                .eq('account_id', entry.id)
                .single();
              if (!accounts) { console.warn('⚠️ Compte introuvable'); continue; }
              const reply = await generateReply(commentText, 'professionnel', accounts.account_name);
              console.log('🤖 Réponse commentaire:', reply);
              await replyToComment(commentId, reply, accounts.access_token);
            } catch (err) {
              console.error('❌ Erreur commentaire:', err.response?.data || err.message);
            }
          }
        }
      }

    }
  }
});

module.exports = router;
