
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_REDIRECT_URI;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

const SCOPES = [
  'instagram_business_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'instagram_content_publish',
  'instagram_manage_insights'
].join(',');

router.get('/auth/meta', (req, res) => {
  res.redirect(`https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=911028448504932&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=instagram_business_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish,instagram_manage_insights`);
});
    const { data: longToken } = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortToken.access_token
      }
    });

    const { data: igData } = await axios.get(`https://graph.instagram.com/v19.0/me`, {
      params: {
        fields: 'id,name,username',
        access_token: longToken.access_token
      }
    });

    await supabase.from('social_accounts').upsert({
      client_id: client_id || null,
      platform: 'instagram',
      account_id: igData.id,
      account_name: igData.username || igData.name,
      access_token: longToken.access_token,
      token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    }, { onConflict: 'account_id' });

    res.json({ success: true, account: igData.username });
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