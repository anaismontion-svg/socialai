// ================================================================
//  SocialAI — templateRotationService.js
//  Service de rotation équitable des templates pour Aria
//  Chemin : services/templateRotationService.js
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Thèmes de stories qu'Aria publie chaque jour
const STORY_THEMES = [
  'avant_apres',
  'presentation',
  'tarifs',
  'nouveau_post',
  'personnalisee',
];

// ----------------------------------------------------------------
//  getNextTemplate(clientId, storyTheme)
//  Retourne le prochain template à utiliser pour ce thème
//  Logique : round-robin équitable sur les templates validés
// ----------------------------------------------------------------
async function getNextTemplate(clientId, storyTheme) {
  // 1. Récupérer les templates validés du client
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('selected_templates, template_vars')
    .eq('id', clientId)
    .single();

  if (clientErr || !client?.selected_templates?.length) {
    throw new Error(`Client ${clientId} sans templates validés`);
  }

  const available = client.selected_templates;

  // 2. Récupérer l'historique d'utilisation pour ce thème
  const { data: history } = await supabase
    .from('aria_template_rotation')
    .select('template_id, used_at')
    .eq('client_id', clientId)
    .eq('story_theme', storyTheme)
    .order('used_at', { ascending: false })
    .limit(available.length);

  const usedIds = (history || []).map(h => h.template_id);

  // 3. Trouver le prochain template pas encore utilisé (round-robin)
  //    Si tous ont été utilisés, recommencer depuis le moins récent
  let nextTemplate = available.find(id => !usedIds.includes(id));

  if (!nextTemplate) {
    // Tous utilisés → prendre celui qui n'a pas été utilisé le plus longtemps
    const usedSet = new Map(usedIds.map((id, i) => [id, i]));
    nextTemplate = available.reduce((oldest, id) => {
      const rank = usedSet.has(id) ? usedSet.get(id) : -1;
      const oldestRank = usedSet.has(oldest) ? usedSet.get(oldest) : -1;
      return rank > oldestRank ? id : oldest;
    });
  }

  // 4. Enregistrer l'utilisation
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
//  Retourne tous les templates du jour pour les 5 thèmes
//  Appelé par Aria chaque matin
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
//  Sauvegarde la sélection du client après onboarding
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
      onboarding_step: 3, // étape suivante de l'onboarding
    })
    .eq('id', clientId);

  if (error) throw error;

  return { success: true, count: templateIds.length };
}

// ----------------------------------------------------------------
//  getRotationStats(clientId)
//  Stats pour le back office : combien de fois chaque template utilisé
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