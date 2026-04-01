// routes/branding.js — Génération et gestion des thèmes visuels par client

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Génère 4 thèmes visuels via Claude ───────────────────────────────────────
async function generateBrandingProposals(client) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Tu es un expert en branding et design Instagram.

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Description : ${client.description || 'non précisée'}
Ton souhaité : ${client.tone || 'professionnel'}

Génère 4 thèmes visuels Instagram distincts et cohérents avec l'univers de ce client.
Chaque thème doit avoir une identité forte et différente des autres.
Adapte les couleurs, fonts et styles à l'univers du client.

Réponds UNIQUEMENT en JSON valide sans markdown :
[
  {
    "id": 1,
    "theme_name": "Nom du thème",
    "description": "Description courte de l'ambiance",
    "palette": {
      "primary": "#hex",
      "secondary": "#hex",
      "dark": "#hex",
      "light": "#hex",
      "text_dark": "#hex",
      "text_light": "#hex"
    },
    "fonts": {
      "titre": "Lora-Italic",
      "corps": "Poppins-Light"
    },
    "logo_style": "thick",
    "logo_position": "top-left",
    "feed_pattern": ["photo", "citation", "photo", "photo", "citation", "photo"],
    "tagline": "Tagline courte et percutante",
    "gradient_top": true,
    "frame_border": true
  }
]

Règles importantes :
- Fonts disponibles : "Lora-Italic", "Lora-Regular", "Poppins-Light", "Poppins-Regular", "Poppins-Medium"
- logo_style : "thick" (trait épais) | "normal" | "thin" (trait fin)
- logo_position : "top-left" | "top-right" | "bottom-right" | "bottom-left"
- Les 4 thèmes doivent être vraiment différents (pas juste des variantes de couleurs)
- Colle à l'univers du client : une boulangerie n'aura pas les mêmes couleurs qu'un cabinet d'avocats`
    }]
  });

  try {
    return JSON.parse(message.content[0].text);
  } catch(e) {
    throw new Error('Erreur parsing thèmes Claude : ' + e.message);
  }
}

// ── GET /api/branding/client/:clientId ───────────────────────────────────────
// Retourne les variables template pour la page de sélection des templates
router.get('/client/:clientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('name, branding, branding_status')
      .eq('id', req.params.clientId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Client introuvable' });

    const b = data.branding || {};
    const palette = b.palette || {};

    res.json({
      business_name:   data.name          || '',
      primary_color:   palette.primary    || '#C9A98A',
      secondary_color: palette.dark       || '#2D2D2D',
      accent_color:    palette.light      || '#F5EDE3',
      font_title:      b.fonts?.titre     || 'Georgia, serif',
      font_body:       b.fonts?.corps     || 'system-ui, sans-serif',
      tagline:         b.tagline          || '',
      website:         '',
      hashtag:         '',
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/branding/proposals/:clientId ─────────────────────────────────────
// Génère et retourne les 4 thèmes pour un client
router.get('/proposals/:clientId', async (req, res) => {
  try {
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.clientId)
      .single();

    if (error || !client) return res.status(404).json({ error: 'Client introuvable' });

    // Si des propositions existent déjà, les retourner directement
    if (client.branding_proposals) {
      return res.json({ proposals: client.branding_proposals, cached: true });
    }

    // Générer les 4 thèmes via Claude
    const proposals = await generateBrandingProposals(client);

    // Sauvegarder les propositions et passer en status 'choosing'
    await supabase
      .from('clients')
      .update({
        branding_proposals: proposals,
        branding_status: 'choosing'
      })
      .eq('id', client.id);

    res.json({ proposals, cached: false });

  } catch(err) {
    console.error('❌ Erreur génération thèmes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/branding/choose/:clientId ──────────────────────────────────────
// Sauvegarde le thème choisi (avec éventuelles modifications manuelles)
router.post('/choose/:clientId', async (req, res) => {
  try {
    const { branding } = req.body;
    if (!branding) return res.status(400).json({ error: 'Branding manquant' });

    const { error } = await supabase
      .from('clients')
      .update({
        branding,
        branding_status: 'done'
      })
      .eq('id', req.params.clientId);

    if (error) throw new Error(error.message);

    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/branding/regenerate/:clientId ───────────────────────────────────
// Régénère 4 nouveaux thèmes (si le client n'est pas satisfait)
router.post('/regenerate/:clientId', async (req, res) => {
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.clientId)
      .single();

    if (!client) return res.status(404).json({ error: 'Client introuvable' });

    // Forcer la régénération en effaçant les anciennes propositions
    await supabase
      .from('clients')
      .update({ branding_proposals: null })
      .eq('id', client.id);

    const proposals = await generateBrandingProposals(client);

    await supabase
      .from('clients')
      .update({
        branding_proposals: proposals,
        branding_status: 'choosing'
      })
      .eq('id', client.id);

    res.json({ proposals });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/branding/status/:clientId ───────────────────────────────────────
// Retourne le statut de configuration du branding
router.get('/status/:clientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('branding_status, branding')
      .eq('id', req.params.clientId)
      .single();

    if (error) throw new Error(error.message);
    res.json(data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;