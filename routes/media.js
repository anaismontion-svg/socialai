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

// ── Multer ────────────────────────────────────────────────────────────────────
const TMP_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : path.join(__dirname, '../tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// ─────────────────────────────────────────────
// CATÉGORIES STORY RECONNUES PAR L'IA
// ─────────────────────────────────────────────
const STORY_CATEGORIES = {
  // Chatterie / animaux
  chaton_disponible:  'Chaton visible, mignon, disponible à l\'adoption, regard caméra',
  chat_adulte:        'Chat adulte, majestueux, posé, regardant l\'objectif',
  avant_apres:        'Deux photos côte à côte ou montage montrant une évolution, avant/après',
  video_chaton:       'Vidéo ou photo dynamique d\'un chaton jouant, en mouvement',
  famille_adoption:   'Famille humaine avec un animal, moment d\'adoption, câlin',
  // Chatterie / coulisses
  chatterie:          'Intérieur d\'une chatterie, cages, espace de vie des animaux',
  equipe:             'Personne(s) s\'occupant des animaux, soignant, portant un animal',
  coulisses:          'Coulisses d\'un élevage, préparation nourriture, nettoyage, soin',
  elevage:            'Vue d\'ensemble d\'un élevage, locaux, infrastructure',
  // Générique
  produit:            'Produit physique mis en valeur, photo produit soignée',
  ambiance:           'Photo d\'ambiance, décor, lifestyle, esthétique',
  portrait:           'Portrait d\'une personne, professionnel ou naturel',
  avant_apres_generique: 'Transformation, avant/après d\'un résultat, comparaison',
  realisation:        'Réalisation d\'un travail, résultat final, projet terminé',
  autre:              'Autre contenu ne correspondant pas aux catégories précédentes'
};

// ─────────────────────────────────────────────
// ANALYSE IA COMPLÈTE D'UNE IMAGE
// Retourne analyse + story_category automatique
// ─────────────────────────────────────────────
async function analyserImageAvecIA(base64Image, mimeType, clientInfo = null) {
  const categoriesDesc = Object.entries(STORY_CATEGORIES)
    .map(([key, desc]) => `- "${key}" : ${desc}`)
    .join('\n');

  const contextClient = clientInfo
    ? `\nContexte du client : ${clientInfo.name || ''} — secteur : ${clientInfo.sector || 'non précisé'}`
    : '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text', text: `Analyse cette image pour Instagram.${contextClient}

Catégories disponibles pour "story_category" :
${categoriesDesc}

Choisis LA catégorie la plus précise parmi cette liste exacte.
Réponds UNIQUEMENT en JSON valide sans markdown ni backticks :
{
  "sujet": "description courte de l'image en 5-10 mots",
  "story_category": "choisir une catégorie exacte dans la liste ci-dessus",
  "story_category_raison": "pourquoi cette catégorie en 1 phrase",
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

    const text = response.content[0].text.trim();
    // Nettoyer les éventuels backticks markdown
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);

    // Vérifier que la story_category est valide
    if (!STORY_CATEGORIES[parsed.story_category]) {
      parsed.story_category = 'autre';
    }

    console.log(`🧠 Analyse IA — catégorie détectée : "${parsed.story_category}" (${parsed.story_category_raison || ''})`);
    return parsed;

  } catch(e) {
    console.warn('⚠️ Analyse IA échouée:', e.message);
    return {
      sujet: 'Média uploadé',
      story_category: 'autre',
      type_contenu: 'autre',
      qualite: 70,
      potentiel_viral: 60,
      caption: '',
      hashtags: [],
      format_recommande: 'post',
      heure_optimale: '18:00'
    };
  }
}

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

    // Récupérer infos client pour contextualiser l'analyse
    const { data: clientInfo } = await supabase
      .from('clients')
      .select('name, sector, tone')
      .eq('id', client_id)
      .single();

    let analyse = {
      sujet: 'Média uploadé',
      story_category: story_type || 'autre',
      type_contenu: 'autre',
      qualite: 70,
      potentiel_viral: 60,
      caption: '',
      hashtags: [],
      format_recommande: 'post',
      heure_optimale: '18:00'
    };

    if (!isVideo && base64Image.length < 5 * 1024 * 1024) {
      // ── Analyse IA complète avec détection story_category ──
      analyse = await analyserImageAvecIA(base64Image, mimeType, clientInfo);
    } else if (isVideo) {
      analyse = {
        sujet: 'Vidéo uploadée',
        story_category: story_type || 'video_chaton',
        type_contenu: 'video',
        qualite: 75,
        potentiel_viral: 80,
        caption: '',
        hashtags: [],
        format_recommande: 'reel',
        heure_optimale: '18:00'
      };
    }

    // Si le client a forcé un story_type manuel, on respecte ça
    const finalStoryCategory = story_type || analyse.story_category || 'autre';

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
        story_category:  finalStoryCategory,
        story_type:      story_type || null,
        used:            false
      }])
      .select();

    try { fs.unlinkSync(filePath); } catch(e) {}

    if (error) return res.status(500).json({ error: error.message });

    console.log(`✅ Média sauvegardé — catégorie: "${finalStoryCategory}" — score viral: ${analyse.potentiel_viral}%`);
    res.json({ success: true, media: data[0], analyse });

  } catch(err) {
    console.error('❌ Erreur upload média:', err.message);
    if (filePath) try { fs.unlinkSync(filePath); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/media/analyse-batch/:clientId
// Ré-analyse tous les médias sans story_category
// À appeler une fois pour les médias existants
// ─────────────────────────────────────────────
router.post('/analyse-batch/:clientId', async (req, res) => {
  const { clientId } = req.params;
  console.log(`🔄 Analyse batch pour client ${clientId}`);

  try {
    const { data: clientInfo } = await supabase
      .from('clients').select('name, sector, tone').eq('id', clientId).single();

    // Médias sans story_category ou avec 'autre'
    const { data: medias } = await supabase
      .from('media')
      .select('id, url, type')
      .eq('client_id', clientId)
      .eq('type', 'photo')
      .or('story_category.is.null,story_category.eq.autre')
      .limit(50);

    if (!medias?.length) return res.json({ success: true, analysed: 0 });

    res.json({ success: true, total: medias.length, message: `Analyse de ${medias.length} médias lancée en arrière-plan` });

    let analysed = 0;
    for (const media of medias) {
      try {
        // Télécharger l'image
        const imgRes = await axios.get(media.url, {
          responseType: 'arraybuffer', timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const buffer   = Buffer.from(imgRes.data);
        const mimeType = imgRes.headers['content-type'] || 'image/jpeg';
        const base64   = buffer.toString('base64');

        const analyse = await analyserImageAvecIA(base64, mimeType, clientInfo);

        await supabase.from('media').update({
          story_category:  analyse.story_category || 'autre',
          qualite:         analyse.qualite || 70,
          potentiel_viral: analyse.potentiel_viral || 60,
          analyse_data:    analyse
        }).eq('id', media.id);

        analysed++;
        console.log(`✅ ${analysed}/${medias.length} — ${media.id} → "${analyse.story_category}"`);
        await new Promise(r => setTimeout(r, 500)); // éviter rate limit
      } catch(e) {
        console.warn(`⚠️ Échec analyse ${media.id}:`, e.message);
      }
    }
    console.log(`🎉 Analyse batch terminée : ${analysed} médias catégorisés`);

  } catch(err) {
    console.error('❌ Erreur analyse batch:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/media/migrate-from-instagram/:clientId
// ─────────────────────────────────────────────
router.post('/migrate-from-instagram/:clientId', async (req, res) => {
  const { clientId } = req.params;
  console.log(`📸 Migration Instagram API → Supabase pour client ${clientId}`);

  try {
    const { data: account, error: accountErr } = await supabase
      .from('social_accounts')
      .select('access_token, account_id')
      .eq('client_id', clientId)
      .eq('platform', 'instagram')
      .single();

    if (accountErr || !account?.access_token) {
      return res.status(400).json({ error: 'Token Meta introuvable pour ce client' });
    }

    const token       = account.access_token;
    const igAccountId = account.account_id;

    const igPhotos = [];
    let url = `https://graph.instagram.com/${igAccountId}/media?fields=id,media_type,media_url,timestamp&access_token=${token}&limit=100`;

    while (url) {
      const res2 = await axios.get(url, { timeout: 15000 });
      const data = res2.data;
      if (data.error) throw new Error(data.error.message);
      const photos = (data.data || []).filter(m => m.media_type === 'IMAGE' && m.media_url);
      igPhotos.push(...photos);
      url = data.paging?.next || null;
      if (igPhotos.length >= 200) break;
    }

    console.log(`📸 ${igPhotos.length} photos trouvées via API Instagram`);
    res.json({ success: true, total: igPhotos.length, message: `Migration de ${igPhotos.length} photos lancée en arrière-plan` });

    let migrated = 0, failed = 0;

    for (const igMedia of igPhotos) {
      try {
        const imgRes = await axios.get(igMedia.media_url, {
          responseType: 'arraybuffer', timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const buffer   = Buffer.from(imgRes.data);
        const mimeType = imgRes.headers['content-type'] || 'image/jpeg';
        const ext      = mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `${clientId}/instagram_${igMedia.id}.${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from('media')
          .upload(filename, buffer, { contentType: mimeType, upsert: true });

        if (uploadErr) throw new Error(uploadErr.message);

        const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(filename);
        const permanentUrl = urlData.publicUrl;

        const { data: existing } = await supabase
          .from('media').select('id')
          .eq('client_id', clientId)
          .eq('instagram_post_id', igMedia.id)
          .single();

        if (existing) {
          await supabase.from('media').update({ url: permanentUrl, type: 'photo' }).eq('id', existing.id);
        } else {
          await supabase.from('media').insert([{
            client_id:          clientId,
            instagram_post_id:  igMedia.id,
            filename:           `instagram_${igMedia.id}.${ext}`,
            type:               'photo',
            url:                permanentUrl,
            statut:             'importe',
            qualite:            70,
            potentiel_viral:    60,
            story_category:     'autre',
            used:               false,
            original_post_date: igMedia.timestamp
          }]);
        }

        migrated++;
        console.log(`✅ ${migrated}/${igPhotos.length} — ${igMedia.id}`);
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
// ─────────────────────────────────────────────
router.post('/migrate-to-supabase/:clientId', async (req, res) => {
  const { clientId } = req.params;
  console.log(`🔄 Migration CDN → Supabase pour client ${clientId}`);

  try {
    const { data: medias, error } = await supabase
      .from('media').select('id, url, filename, type')
      .eq('client_id', clientId).eq('type', 'photo')
      .or('url.ilike.%cdninstagram%,url.ilike.%scontent%');

    if (error) throw error;
    if (!medias || medias.length === 0) {
      return res.json({ success: true, migrated: 0, message: 'Aucune photo à migrer' });
    }

    console.log(`📸 ${medias.length} photos à migrer`);
    res.json({ success: true, total: medias.length, message: `Migration de ${medias.length} photos lancée en arrière-plan` });

    let migrated = 0, failed = 0;

    for (const media of medias) {
      try {
        const response = await axios.get(media.url, {
          responseType: 'arraybuffer', timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const buffer   = Buffer.from(response.data);
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        const ext      = mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `${clientId}/instagram_${media.id}.${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from('media').upload(filename, buffer, { contentType: mimeType, upsert: true });

        if (uploadErr) throw new Error(uploadErr.message);

        const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(filename);
        await supabase.from('media').update({ url: urlData.publicUrl }).eq('id', media.id);

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
      .from('media').select('url, client_id').eq('id', req.params.id).single();

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