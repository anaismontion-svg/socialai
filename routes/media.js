const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const upload = multer({ dest: '/tmp/' });

router.get('/:clientId', async (req, res) => {
  const { data, error } = await supabase
    .from('media')
    .select('*')
    .eq('client_id', req.params.clientId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { client_id, story_type } = req.body;
    const file = req.file;
    const imageData = fs.readFileSync(file.path);
    const base64Image = imageData.toString('base64');
    const mimeType = file.mimetype;
    const isVideo = mimeType.startsWith('video');

    // ── Upload dans Supabase Storage ────────────────────────────────────────
    const fileName = `${client_id}/${Date.now()}_${file.originalname}`;
    const { data: storageData, error: storageError } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, imageData, {
        contentType: mimeType,
        upsert: false
      });

    if (storageError) throw new Error(storageError.message);

    // Récupérer l'URL publique
    const { data: urlData } = supabaseAdmin.storage
      .from('media')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // ── Analyse IA (uniquement pour les images) ─────────────────────────────
    let analyse = { sujet: 'Média uploadé', caption: '', hashtags: [] };

    if (!isVideo) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64Image }
            },
            {
              type: 'text',
              text: `Analyse cette image pour Instagram/Facebook. Réponds UNIQUEMENT en JSON valide sans markdown :
{
  "sujet": "description courte",
  "type_contenu": "avant_apres|produit|ambiance|coulisses|portrait|autre",
  "qualite": 85,
  "potentiel_viral": 70,
  "caption": "caption prête à publier avec emojis et hashtags",
  "hashtags": ["#hashtag1", "#hashtag2"],
  "format_recommande": "post|story|reel",
  "heure_optimale": "18:30"
}`
            }
          ]
        }]
      });

      try {
        analyse = JSON.parse(response.content[0].text);
      } catch(e) {
        analyse = { sujet: 'Média uploadé', caption: '', hashtags: [] };
      }
    }

    // ── Sauvegarder en base ─────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('media')
      .insert([{
        client_id,
        filename: file.originalname,
        type: isVideo ? 'video' : 'photo',
        url: publicUrl,
        analyse_data: analyse,
        caption: analyse.caption || '',
        hashtags: analyse.hashtags || [],
        statut: 'analyse',
        qualite: analyse.qualite || null,
        potentiel_viral: analyse.potentiel_viral || null,
        story_type: story_type || null,
        used: false
      }])
      .select();

    fs.unlinkSync(file.path);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, media: data[0], analyse });

  } catch(err) {
    console.error(err);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const { data: media } = await supabase
    .from('media')
    .select('url')
    .eq('id', req.params.id)
    .single();

  if (media?.url) {
    const path = media.url.split('/media/')[1];
    if (path) await supabaseAdmin.storage.from('media').remove([path]);
  }

  const { error } = await supabase
    .from('media')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;