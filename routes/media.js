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
    const { client_id } = req.body;
    const file = req.file;
    const imageData = fs.readFileSync(file.path);
    const base64Image = imageData.toString('base64');
    const mimeType = file.mimetype;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
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

    let analyse;
    try {
      analyse = JSON.parse(response.content[0].text);
    } catch(e) {
      analyse = { sujet: 'Média uploadé', caption: 'Caption à générer', hashtags: [] };
    }

    const { data, error } = await supabase
      .from('media')
      .insert([{
        client_id,
        filename: file.originalname,
        type: mimeType.startsWith('video') ? 'video' : 'photo',
        analyse: analyse,
        caption: analyse.caption,
        hashtags: analyse.hashtags,
        statut: 'analyse',
        qualite: analyse.qualite,
        potentiel_viral: analyse.potentiel_viral
      }])
      .select();

    fs.unlinkSync(file.path);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, media: data[0], analyse });

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;