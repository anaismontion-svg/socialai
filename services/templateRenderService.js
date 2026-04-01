// ================================================================
//  SocialAI — templateRenderService.js
//  Version simplifiée sans puppeteer (conversion PNG à implémenter plus tard)
//  Chemin : services/templateRenderService.js
// ================================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ----------------------------------------------------------------
//  Les 30 templates SVG (fonctions de rendu)
//  Import depuis le fichier partagé front/back
// ----------------------------------------------------------------
const { renderTemplate } = require('../shared/templates');

// ----------------------------------------------------------------
//  renderSVG(templateId, clientVars, storyData)
//  Génère le SVG final avec les données de la story
//
//  storyData selon le thème :
//    avant_apres   : { beforeText, afterText, photoUrl }
//    presentation  : { title, description }
//    tarifs        : { service, price, detail }
//    nouveau_post  : { postCaption, postImageUrl }
//    personnalisee : { message, photoUrl }
// ----------------------------------------------------------------
function renderSVG(templateId, clientVars, storyData = {}) {
  const vars = {
    ...clientVars,
    // Injecter les données spécifiques au thème
    tagline: storyData.title || storyData.service || clientVars.tagline,
    customText: storyData.description || storyData.message || '',
    price: storyData.price || '',
  };

  return renderTemplate(templateId, vars);
}

// ----------------------------------------------------------------
//  generateStoryImage(clientId, storyTheme, storyData)
//  Pour l'instant : génère le SVG et le sauvegarde en base
//  La conversion PNG sera ajoutée ultérieurement
// ----------------------------------------------------------------
async function generateStoryImage(clientId, storyTheme, storyData = {}) {
  const { getNextTemplate } = require('./templateRotationService');

  // 1. Obtenir le template du jour pour ce thème
  const { templateId, templateVars } = await getNextTemplate(clientId, storyTheme);

  // 2. Rendre le SVG
  const svgString = renderSVG(templateId, templateVars, storyData);

  // 3. Sauvegarder en base (sans image PNG pour l'instant)
  await supabase.from('stories_generated').insert({
    client_id: clientId,
    story_theme: storyTheme,
    template_id: templateId,
    svg_content: svgString,
    custom_data: storyData,
  });

  return { svgString, templateId, imageUrl: null };
}

module.exports = {
  renderSVG,
  generateStoryImage,
};