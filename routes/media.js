// routes/media.js
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth-portal');

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
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// ─────────────────────────────────────────────
// GET /api/media/:clientId
// Liste les médias d'un client
// Accessible par le client (token) ET le back office (pas de token requis pour le CM)
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
// Upload d'un média + analyse IA
// Accessible par le client ET le CM
// ─────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    const { client_id, story_type } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id manquant' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }

    filePath = req.file.path;
    const imageData = fs.readFileSync(filePath);
    const base64Image = imageData.toString('base64');
    const mimeType = req.file.mimetype;
    const isVideo = mimeType.startsWith('video');

    console.log(`📤 Upload média pour client ${client_id} — ${req.file.originalname} (${mimeType})`);

    // ── Upload dans Supabase Storage ──────────────────────────────────────────
    const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${client_id}/${Date.now()}_${safeFilename}`;

    const { error: storageError } = await supabaseAdmin.storage
      .from('media')
      .upload(fileName, imageData, { contentType: mimeType, upsert: false });

    if (storageError) throw new Error(`Storage: ${storageError.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from('media')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // ── Analyse IA Vision (images uniquement) ────────────────────────────────
    let analyse = { sujet: 'Média uploadé', caption: '', hashtags: [], qualite: 70, potentiel_viral: 60 };

    if (!isVideo && base64Image.length < 5 * 1024 * 1024) { // max 5MB base64
      try {
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
                text: `Analyse cette image pour Instagram. Réponds UNIQUEMENT en JSON valide sans markdown :
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
        const parsed = JSON.parse(response.content[0].text);
        analyse = { ...analyse, ...parsed };
      } catch(e) {
        console.warn('⚠️ Analyse IA échouée, valeurs par défaut utilisées:', e.message);
      }
    } else if (isVideo) {
      // Pour les vidéos : score par défaut élevé (reels performent bien)
      analyse = { sujet: 'Vidéo uploadée', caption: '', hashtags: [], qualite: 75, potentiel_viral: 80 };
    }

    // ── Sauvegarder en base ───────────────────────────────────────────────────
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

    // Nettoyage fichier tmp
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
// DELETE /api/media/:id
// Supprime un média (storage + base)
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { data: media } = await supabase
      .from('media')
      .select('url, client_id')
      .eq('id', req.params.id)
      .single();

    if (media?.url) {
      // Extraire le path depuis l'URL publique
      const urlParts = media.url.split('/media/');
      if (urlParts.length > 1) {
        const storagePath = decodeURIComponent(urlParts[1].split('?')[0]);
        await supabaseAdmin.storage.from('media').remove([storagePath]);
      }
    }

    const { error } = await supabase
      .from('media')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;