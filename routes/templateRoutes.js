// ================================================================
//  SocialAI — templateRoutes.js
//  Routes Express pour le système de templates
//  Chemin : routes/templateRoutes.js
// ================================================================

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const {
  saveValidatedTemplates,
  getDailyTemplates,
  getRotationStats,
  STORY_THEMES,
} = require('../services/templateRotationService');
const { generateStoryImage } = require('../services/templateRenderService');
const { renderTemplate } = require('../shared/templates');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Accès admin requis' });
  }
  next();
}

// ================================================================
//  ROUTES CLIENT
// ================================================================

// POST /api/templates/validate
router.post('/validate', async (req, res) => {
  try {
    const { clientId, templateIds, templateVars } = req.body;

    if (!clientId || !templateIds) {
      return res.status(400).json({ error: 'clientId et templateIds requis' });
    }

    if (templateIds.length < 15) {
      return res.status(400).json({
        error: 'Minimum 15 templates requis',
        provided: templateIds.length,
      });
    }

    const result = await saveValidatedTemplates(clientId, templateIds, templateVars);

    await notifyAriaTemplatesReady(clientId);

    res.json({
      success: true,
      message: `${result.count} templates validés avec succès`,
      nextStep: 'onboarding_complete',
    });
  } catch (err) {
    console.error('Erreur validation templates:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/templates/client/:clientId
router.get('/client/:clientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('selected_templates, template_vars, templates_validated_at')
      .eq('id', req.params.clientId)
      .single();

    if (error) throw error;

    res.json({
      selectedTemplates: data.selected_templates || [],
      templateVars: data.template_vars || {},
      validatedAt: data.templates_validated_at,
      count: (data.selected_templates || []).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/templates/preview/:templateId
router.get('/preview/:templateId', async (req, res) => {
  try {
    const { templateId } = req.params;
    const { clientId } = req.query;

    let templateVars = {};

    if (clientId) {
      const { data } = await supabase
        .from('clients')
        .select('template_vars')
        .eq('id', clientId)
        .single();
      templateVars = data?.template_vars || {};
    }

    const svg = renderTemplate(templateId, templateVars);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
//  ROUTES ARIA
// ================================================================

// GET /api/templates/daily/:clientId
router.get('/daily/:clientId', async (req, res) => {
  try {
    const daily = await getDailyTemplates(req.params.clientId);
    res.json({
      date: new Date().toISOString().split('T')[0],
      clientId: req.params.clientId,
      templates: daily,
      themes: STORY_THEMES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates/generate-story
router.post('/generate-story', async (req, res) => {
  try {
    const { clientId, storyTheme, storyData } = req.body;

    if (!clientId || !storyTheme) {
      return res.status(400).json({ error: 'clientId et storyTheme requis' });
    }

    if (!STORY_THEMES.includes(storyTheme)) {
      return res.status(400).json({
        error: `Thème invalide. Options: ${STORY_THEMES.join(', ')}`,
      });
    }

    const result = await generateStoryImage(clientId, storyTheme, storyData || {});
    res.json({
      success: true,
      imageUrl: result.imageUrl,
      templateId: result.templateId,
      theme: storyTheme,
    });
  } catch (err) {
    console.error('Erreur génération story:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates/generate-all-daily/:clientId
router.post('/generate-all-daily/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { customStoryData } = req.body || {};
    const results = {};
    const errors = {};

    for (const theme of STORY_THEMES) {
      try {
        const storyData = customStoryData?.[theme] || getDefaultStoryData(theme);
        results[theme] = await generateStoryImage(clientId, theme, storyData);
      } catch (err) {
        errors[theme] = err.message;
      }
    }

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      generated: results,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
//  ROUTES ADMIN
// ================================================================

router.get('/admin/stats/:clientId', requireAdmin, async (req, res) => {
  try {
    const stats = await getRotationStats(req.params.clientId);
    res.json({ clientId: req.params.clientId, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/stories/:clientId', requireAdmin, async (req, res) => {
  try {
    const { limit = 30, theme } = req.query;
    let query = supabase
      .from('stories_generated')
      .select('*')
      .eq('client_id', req.params.clientId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (theme) query = query.eq('story_theme', theme);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ stories: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/client/:clientId/vars', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('clients')
      .update({ template_vars: req.body.templateVars })
      .eq('id', req.params.clientId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/client/:clientId/templates', requireAdmin, async (req, res) => {
  try {
    const { templateIds } = req.body;
    if (templateIds.length < 15) {
      return res.status(400).json({ error: 'Minimum 15 templates requis' });
    }
    const { error } = await supabase
      .from('clients')
      .update({ selected_templates: templateIds })
      .eq('id', req.params.clientId);
    if (error) throw error;
    res.json({ success: true, count: templateIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
//  HELPERS
// ================================================================

function getDefaultStoryData(theme) {
  const defaults = {
    avant_apres:  { title: 'Résultats clients',      beforeText: 'Avant', afterText: 'Après' },
    presentation: { title: 'Qui sommes-nous ?',      description: 'Découvrez notre histoire' },
    tarifs:       { service: 'Nos prestations',      price: 'Sur devis', detail: 'Contactez-nous' },
    nouveau_post: { title: 'Nouvelle publication',   description: 'Retrouvez notre dernier post' },
    personnalisee:{ title: 'Message du jour',        message: 'Bonne journée !' },
  };
  return defaults[theme] || {};
}

async function notifyAriaTemplatesReady(clientId) {
  try {
    await supabase.from('aria_events').insert({
      client_id: clientId,
      event_type: 'templates_validated',
      payload: { message: 'Le client a validé ses templates stories.' },
    });
  } catch(e) {}
}

module.exports = router;