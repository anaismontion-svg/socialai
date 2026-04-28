// routes/story-assets.js
// Gestion des visuels story PRÉ-VALIDÉS par le community manager
// Aria NE CRÉE JAMAIS ces visuels — elle les utilise en rotation

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TMP_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : path.join(__dirname, '../tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 20 * 1024 * 1024 } });

const STORY_TYPES = ['entreprise', 'temoignage', 'avant_apres'];

// ─────────────────────────────────────────────
// GET /api/story-assets/:clientId
// Récupère tous les visuels validés d'un client
// ─────────────────────────────────────────────
router.get('/:clientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('story_assets')
      .select('*')
      .eq('client_id', req.params.clientId)
      .order('type')
      .order('position');
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
// POST /api/story-assets/upload
// Upload d'un visuel validé (image JPG/PNG)
// ─────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    const { client_id, type } = req.body;

    if (!client_id) return res.status(400).json({ error: 'client_id manquant' });
    if (!type || !STORY_TYPES.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valeurs : ${STORY_TYPES.join(', ')}` });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    filePath = req.file.path;
    const imageData = fs.readFileSync(filePath);
    const mimeType = req.file.mimetype;

    // Compter le nombre de visuels existants pour ce type (pour calculer la position)
    const { count } = await supabase
      .from('story_assets')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .eq('type', type);

    const position = (count || 0) + 1;
    const filename = `story-assets/${client_id}/${type}_${position}_${Date.now()}.jpg`;

    // Upload dans Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('media')
      .upload(filename, imageData, { contentType: mimeType, upsert: false });

    if (uploadError) throw new Error(`Storage: ${uploadError.message}`);

    const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(filename);

    // Sauvegarder en BDD
    const { data, error } = await supabase
      .from('story_assets')
      .insert([{
        client_id,
        type,
        url: urlData.publicUrl,
        position,
        actif: true
      }])
      .select();

    if (error) throw error;

    try { fs.unlinkSync(filePath); } catch(e) {}

    console.log(`✅ Story asset uploadé — ${type} position ${position} pour client ${client_id}`);
    res.json({ success: true, asset: data[0] });

  } catch(err) {
    console.error('❌ Erreur upload story asset:', err.message);
    if (filePath) try { fs.unlinkSync(filePath); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/story-assets/:id
// Supprime un visuel validé
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { data: asset } = await supabase
      .from('story_assets').select('url').eq('id', req.params.id).single();

    if (asset?.url) {
      const urlParts = asset.url.split('/media/');
      if (urlParts.length > 1) {
        const storagePath = decodeURIComponent(urlParts[1].split('?')[0]);
        await supabaseAdmin.storage.from('media').remove([storagePath]);
      }
    }

    await supabase.from('story_assets').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/story-assets/:id/toggle
// Active / désactive un visuel
// ─────────────────────────────────────────────
router.patch('/:id/toggle', async (req, res) => {
  const { actif } = req.body;
  try {
    await supabase.from('story_assets').update({ actif }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// FONCTION UTILITAIRE : choisir le visuel du jour
// Rotation basée sur le numéro du jour de l'année
// Aria l'utilise pour planifier les stories
// ─────────────────────────────────────────────
async function getStoryAssetDuJour(clientId, type, date = new Date()) {
  const { data: assets } = await supabase
    .from('story_assets')
    .select('*')
    .eq('client_id', clientId)
    .eq('type', type)
    .eq('actif', true)
    .order('position');

  if (!assets || assets.length === 0) return null;

  // Rotation basée sur le numéro du jour de l'année
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date - startOfYear;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const index = dayOfYear % assets.length;

  return assets[index];
}

module.exports = router;
module.exports.getStoryAssetDuJour = getStoryAssetDuJour;