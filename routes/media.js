// routes/media.js
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Multer — dossier tmp compatible Railway ───────────────────────────────────
const TMP_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : path.join(__dirname, '../tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// ─────────────────────────────────────────────
// GET /api/media/:clientId
// ─────────────────────────────────────────────
router.get('/:clientId', async (req, res) => {
  const { data, error } = await supabase
    .from('media')
    .select('*')
    .eq('client_id', req.params.clientId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────
// POST /api/media/upload
// ─────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    const { client_id, story_type } = req.body;

    if (!client_id) return res.status(400).json({ error: 'client_id manquant' });
    if (!req.file)  return res.status(400).json({ error: 'Aucun fichier reçu' });

    filePath = req.file.path;
    const imageData   = fs.readFileSync(filePath);
    const base64Image = imageData.toString('base64');
    const mimeType    = req.file.mimetype;
    const isVideo     = mimeType.startsWith('video');

    console.log(`📤 Upload média pour client ${client_id} — ${req.file.originalname}`);

    const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName     = `${client_id}/${Date.now()}_${safeFilename}`;

    const { error: storageError } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, imageData, { contentType: mimeType, upsert: false });

    if (storageError) throw new Error(`Storage: ${storageError.message}`);

    const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    let analyse = { sujet: 'Média uploadé', caption: '', hashtags: [], qualite: 70, potentiel_viral: 60 };

    if (!isVideo && base64Image.length < 5 * 1024 * 1024) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
              { type: 'text', text: `Analyse cette image pour Instagram. Réponds UNIQUEMENT en JSON valide sans markdown :
{
  "sujet": "description courte",
  "type_contenu": "avant_apres|produit|ambiance|coulisses|portrait|autre",
  "qualite": 85,
  "potentiel_viral": 70,
  "caption": "caption prête à publier avec emojis et hashtags",
  "hashtags": ["#hashtag1", "#hashtag2"],
  "format_recommande": "post|story|reel",
  "heure_optimale": "18:30"
}` }
            ]
          }]
        });
        const parsed = JSON.parse(response.content[0].text);
        analyse = { ...analyse, ...parsed };
      } catch(e) {
        console.warn('⚠️ Analyse IA échouée:', e.message);
      }
    } else if (isVideo) {
      analyse = { sujet: 'Vidéo uploadée', caption: '', hashtags: [], qualite: 75, potentiel_viral: 80 };
    }

    const { data, error } = await supabase
      .from('media')
      .insert([{
        client_id,
        filename:        safeFilename,
        type:            isVideo ? 'video' : 'photo',
        url:             publicUrl,
        analyse_data:    analyse,
        caption:         analyse.caption || '',
        hashtags:        analyse.hashtags || [],
        statut:          'analyse',
        qualite:         analyse.qualite || 70,
        potentiel_viral: analyse.potentiel_viral || 60,
        story_type:      story_type || null,
        used:            false
      }])
      .select();

    try { fs.unlinkSync(filePath); } catch(e) {}

    if (error) return res.status(500).json({ error: error.message });

    console.log(`✅ Média sauvegardé — score viral: ${analyse.potentiel_viral}%`);
    res.json({ success: true, media: data[0], analyse });

  } catch(err) {
    console.error('❌ Erreur upload média:', err.message);
    if (filePath) try { fs.unlinkSync(filePath); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/media/migrate-from-instagram/:clientId
// Récupère les photos via l'API Meta (URLs fraîches)
// et les stocke définitivement dans Supabase Storage
// ─────────────────────────────────────────────
router.post('/migrate-from-instagram/:clientId', async (req, res) => {
  const { clientId } = req.params;
  console.log(`📸 Migration Instagram API → Supabase pour client ${clientId}`);

  try {
    // Récupérer le token Meta du client
    const { data: account, error: accountErr } = await supabase
      .from('social_accounts')
      .select('access_token, account_id')
      .eq('client_id', clientId)
      .eq('platform', 'instagram')
      .single();

    if (accountErr || !account?.access_token) {
      return res.status(400).json({ error: 'Token Meta introuvable pour ce client' });
    }

    const token = account.access_token;
    const igAccountId = account.account_id;

    // Récupérer tous les médias via l'API Meta (jusqu'à 100)
    const metaUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media?fields=id,media_type,media_url,thumbnail_url,timestamp&limit=100&access_token=${token}`;
    const metaRes = await axios.get(metaUrl, { timeout: 15000 });
    const igMedias = metaRes.data?.data || [];

    const photos = igMedias.filter(m => m.media_type === 'IMAGE' && m.media_url);
    console.log(`📸 ${photos.length} photos trouvées via API Meta`);

    // Réponse immédiate, migration en arrière-plan
    res.json({ success: true, total: photos.length, message: `Migration de ${photos.length} photos lancée en arrière-plan` });

    let migrated = 0;
    let failed   = 0;

    for (const igMedia of photos) {
      try {
        // Télécharger la photo depuis l'URL fraîche Meta
        const imgRes = await axios.get(igMedia.media_url, {
          responseType: 'arraybuffer',
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const buffer   = Buffer.from(imgRes.data);
        const mimeType = imgRes.headers['content-type'] || 'image/jpeg';
        const ext      = mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `${clientId}/instagram_${igMedia.id}.${ext}`;

        // Upload Supabase Storage
        const { error: uploadErr } = await supabaseAdmin.storage
          .from('media')
          .upload(filename, buffer, { contentType: mimeType, upsert: true });

        if (uploadErr) throw new Error(uploadErr.message);

        const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(filename);
        const permanentUrl = urlData.publicUrl;

        // Mettre à jour ou insérer dans la table media
        const { data: existing } = await supabase
          .from('media')
          .select('id')
          .eq('client_id', clientId)
          .eq('instagram_id', igMedia.id)
          .single();

        if (existing) {
          // Mettre à jour l'URL
          await supabase
            .from('media')
            .update({ url: permanentUrl, type: 'photo' })
            .eq('id', existing.id);
        } else {
          // Insérer nouveau média
          await supabase
            .from('media')
            .insert([{
              client_id:    clientId,
              instagram_id: igMedia.id,
              filename:     `instagram_${igMedia.id}.${ext}`,
              type:         'photo',
              url:          permanentUrl,
              statut:       'importe',
              qualite:      70,
              potentiel_viral: 60,
              used:         false,
              original_post_date: igMedia.timestamp
            }]);
        }

        migrated++;
        console.log(`✅ ${migrated}/${photos.length} — ${igMedia.id}`);

        // Pause légère
        await new Promise(r => setTimeout(r, 300));

      } catch(e) {
        failed++;
        console.warn(`⚠️ Échec ${igMedia.id}: ${e.message}`);
      }
    }

    console.log(`🎉 Migration terminée : ${migrated} migrés, ${failed} échoués`);

  } catch(err) {
    console.error('❌ Erreur migration Instagram:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/media/migrate-to-supabase/:clientId
// Re-télécharge les photos Instagram CDN expirées
// ─────────────────────────────────────────────
router.post('/migrate-to-supabase/:clientId', async (req, res) => {
  const { clientId } = req.params;
  console.log(`🔄 Migration CDN → Supabase pour client ${clientId}`);

  try {
    const { data: medias, error } = await supabase
      .from('media')
      .select('id, url, filename, type')
      .eq('client_id', clientId)
      .eq('type', 'photo')
      .or('url.ilike.%cdninstagram%,url.ilike.%scontent%');

    if (error) throw error;
    if (!medias || medias.length === 0) {
      return res.json({ success: true, migrated: 0, message: 'Aucune photo à migrer' });
    }

    console.log(`📸 ${medias.length} photos à migrer`);
    res.json({ success: true, total: medias.length, message: `Migration de ${medias.length} photos lancée en arrière-plan` });

    let migrated = 0;
    let failed   = 0;

    for (const media of medias) {
      try {
        const response = await axios.get(media.url, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const buffer    = Buffer.from(response.data);
        const mimeType  = response.headers['content-type'] || 'image/jpeg';
        const ext       = mimeType.includes('png') ? 'png' : 'jpg';
        const filename  = `${clientId}/instagram_${media.id}.${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from('media')
          .upload(filename, buffer, { contentType: mimeType, upsert: true });

        if (uploadErr) throw new Error(uploadErr.message);

        const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(filename);
        const permanentUrl = urlData.publicUrl;

        await supabase.from('media').update({ url: permanentUrl }).eq('id', media.id);

        migrated++;
        console.log(`✅ Migré ${migrated}/${medias.length} — ${media.id}`);
        await new Promise(r => setTimeout(r, 200));

      } catch(e) {
        failed++;
        console.warn(`⚠️ Échec migration ${media.id}: ${e.message}`);
      }
    }

    console.log(`🎉 Migration terminée : ${migrated} migrés, ${failed} échoués`);

  } catch(err) {
    console.error('❌ Erreur migration:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/media/:id
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { data: media } = await supabase
      .from('media')
      .select('url, client_id')
      .eq('id', req.params.id)
      .single();

    if (media?.url) {
      const urlParts = media.url.split('/media/');
      if (urlParts.length > 1) {
        const storagePath = decodeURIComponent(urlParts[1].split('?')[0]);
        await supabaseAdmin.storage.from('media').remove([storagePath]);
      }
    }

    const { error } = await supabase.from('media').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;