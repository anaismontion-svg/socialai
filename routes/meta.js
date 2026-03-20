
const express = require('express');
const router = express.Router();
const axios = require('axios');

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

const SCOPES = [
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_manage_engagement',
  'pages_messaging',
  'pages_read_user_content',
  'read_insights',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'instagram_content_publish',
  'instagram_manage_insights',
  'pages_show_list'
].join(',');

router.get('/auth/meta', (req, res) => {
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=code`;
  res.redirect(url);
});

router.get('/auth/meta/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { data: shortToken } = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });

    const { data: longToken } = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortToken.access_token
      }
    });

    const { data: pagesData } = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
      params: { access_token: longToken.access_token }
    });

    console.log('Pages connectées:', pagesData.data);
    res.json({ success: true, pages: pagesData.data });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Erreur OAuth Meta' });
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

  if (body.object === 'page') {
    for (const entry of body.entry) {
      if (entry.messaging) {
        for (const event of entry.messaging) {
          if (event.message) {
            console.log('DM reçu:', event.message.text);
          }
        }
      }
      if (entry.changes) {
        for (const change of entry.changes) {
          console.log('Événement:', change.field, change.value);
        }
      }
    }
  }
});

module.exports = router;