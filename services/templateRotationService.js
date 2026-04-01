// ================================================================
//  SocialAI — templateRotationService.js
//  Service de rotation équitable des templates pour Aria
//  Chemin : services/templateRotationService.js
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const STORY_THEMES = [
  'avant_apres',
  'presentation',
  'tarifs',
  'nouveau_post',
  'personnalisee',
];

// ----------------------------------------------------------------
//  getNextTemplate(clientId, storyTheme)
// ----------------------------------------------------------------
async function getNextTemplate(clientId, storyTheme) {
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('selected_templates, template_vars')
    .eq('id', clientId)
    .single();

  if (clientErr || !client?.selected_templates?.length) {
    throw new Error(`Client ${clientId} sans templates validés`);
  }

  const available = client.selected_templates;

  const { data: history } = await supabase
    .from('aria_template_rotation')
    .select('template_id, used_at')
    .eq('client_id', clientId)
    .eq('story_theme', storyTheme)
    .order('used_at', { ascending: false })
    .limit(available.length);

  const usedIds = (history || []).map(h => h.template_id);

  let nextTemplate = available.find(id => !usedIds.includes(id));

  if (!nextTemplate) {
    const usedSet = new Map(usedIds.map((id, i) => [id, i]));
    nextTemplate = available.reduce((oldest, id) => {
      const rank = usedSet.has(id) ? usedSet.get(id) : -1;
      const oldestRank = usedSet.has(oldest) ? usedSet.get(oldest) : -1;
      return rank > oldestRank ? id : oldest;
    });
  }

  await supabase.from('aria_template_rotation').insert({
    client_id: clientId,
    story_theme: storyTheme,
    template_id: nextTemplate,
  });

  return {
    templateId: nextTemplate,
    templateVars: client.template_vars,
  };
}

// ----------------------------------------------------------------
//  getDailyTemplates(clientId)
// ----------------------------------------------------------------
async function getDailyTemplates(clientId) {
  const daily = {};
  for (const theme of STORY_THEMES) {
    try {
      daily[theme] = await getNextTemplate(clientId, theme);
    } catch (err) {
      console.error(`Erreur template pour ${clientId}/${theme}:`, err.message);
      daily[theme] = null;
    }
  }
  return daily;
}

// ----------------------------------------------------------------
//  saveValidatedTemplates(clientId, templateIds, templateVars)
// ----------------------------------------------------------------
async function saveValidatedTemplates(clientId, templateIds, templateVars) {
  if (!templateIds || templateIds.length < 15) {
    throw new Error('Minimum 15 templates requis');
  }

  const { error } = await supabase
    .from('clients')
    .update({
      selected_templates: templateIds,
      template_vars: templateVars,
      templates_validated_at: new Date().toISOString(),
    })
    .eq('id', clientId);

  if (error) throw error;

  return { success: true, count: templateIds.length };
}

// ----------------------------------------------------------------
//  getRotationStats(clientId)
// ----------------------------------------------------------------
async function getRotationStats(clientId) {
  const { data, error } = await supabase
    .from('aria_template_rotation')
    .select('template_id, story_theme, used_at')
    .eq('client_id', clientId)
    .order('used_at', { ascending: false });

  if (error) throw error;

  const stats = {};
  (data || []).forEach(row => {
    if (!stats[row.template_id]) {
      stats[row.template_id] = { total: 0, byTheme: {}, lastUsed: null };
    }
    stats[row.template_id].total++;
    stats[row.template_id].byTheme[row.story_theme] =
      (stats[row.template_id].byTheme[row.story_theme] || 0) + 1;
    if (!stats[row.template_id].lastUsed) {
      stats[row.template_id].lastUsed = row.used_at;
    }
  });

  return stats;
}

module.exports = {
  getNextTemplate,
  getDailyTemplates,
  saveValidatedTemplates,
  getRotationStats,
  STORY_THEMES,
};