// ================================================================
//  SocialAI — templateRenderService.js
//  Rendu SVG → PNG 1080×1920 pour publication Instagram
//  Chemin : services/templateRenderService.js
// ================================================================

const puppeteer = require('puppeteer');
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
//  svgToPng(svgString)
//  Convertit un SVG en Buffer PNG 1080×1920
// ----------------------------------------------------------------
async function svgToPng(svgString) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Format story Instagram : 1080×1920
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

    // Scale le SVG (viewBox 270×480) → 1080×1920 (×4)
    const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1920px; overflow: hidden; background: #fff; }
  .container {
    width: 1080px;
    height: 1920px;
    display: flex;
    align-items: stretch;
  }
  .container svg {
    width: 1080px !important;
    height: 1920px !important;
  }
</style>
</head>
<body>
<div class="container">${svgString}</div>
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Attendre que les polices soient chargées
    await page.evaluate(() => document.fonts.ready);

    const buffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1080, height: 1920 },
    });

    return buffer;
  } finally {
    if (browser) await browser.close();
  }
}

// ----------------------------------------------------------------
//  uploadToStorage(buffer, clientId, storyTheme)
//  Upload le PNG sur Supabase Storage
// ----------------------------------------------------------------
async function uploadToStorage(buffer, clientId, storyTheme) {
  const date = new Date().toISOString().split('T')[0];
  const filename = `${clientId}/${date}_${storyTheme}_${Date.now()}.png`;

  const { data, error } = await supabase.storage
    .from('stories')
    .upload(filename, buffer, {
      contentType: 'image/png',
      upsert: false,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from('stories')
    .getPublicUrl(filename);

  return urlData.publicUrl;
}

// ----------------------------------------------------------------
//  generateStoryImage(clientId, storyTheme, storyData)
//  Pipeline complet : template → SVG → PNG → Storage
//  Retourne l'URL publique du PNG
// ----------------------------------------------------------------
async function generateStoryImage(clientId, storyTheme, storyData = {}) {
  const { templateRotationService } = require('./templateRotationService');

  // 1. Obtenir le template du jour pour ce thème
  const { templateId, templateVars } = await templateRotationService
    .getNextTemplate(clientId, storyTheme);

  // 2. Rendre le SVG
  const svgString = renderSVG(templateId, templateVars, storyData);

  // 3. Convertir en PNG
  const pngBuffer = await svgToPng(svgString);

  // 4. Upload sur Supabase Storage
  const imageUrl = await uploadToStorage(pngBuffer, clientId, storyTheme);

  // 5. Sauvegarder en base
  await supabase.from('stories_generated').insert({
    client_id: clientId,
    story_theme: storyTheme,
    template_id: templateId,
    svg_content: svgString,
    image_url: imageUrl,
    custom_data: storyData,
  });

  return { imageUrl, templateId, svgString };
}

module.exports = {
  renderSVG,
  svgToPng,
  uploadToStorage,
  generateStoryImage,
};