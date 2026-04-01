// ================================================================
//  SocialAI — aria_stories_integration.js
//  Code à intégrer dans le système Aria existant
//  pour les stories quotidiennes automatiques
//
//  À fusionner avec votre fichier Aria principal
// ================================================================

const {
  getDailyTemplates,
  STORY_THEMES,
} = require('./services/templateRotationService');

const { generateStoryImage } = require('./services/templateRenderService');

// ----------------------------------------------------------------
//  CRON QUOTIDIEN : à déclencher chaque matin (ex: 8h00)
//  Génère et publie les 5 stories de la journée pour tous les clients
// ----------------------------------------------------------------
async function runDailyStoriesCron() {
  console.log('[Aria] Démarrage génération stories quotidiennes...');

  // Récupérer tous les clients avec templates validés
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, instagram_token, selected_templates, template_vars')
    .not('templates_validated_at', 'is', null)
    .not('instagram_token', 'is', null);

  for (const client of clients || []) {
    try {
      await generateDailyStoriesForClient(client);
    } catch (err) {
      console.error(`[Aria] Erreur client ${client.id}:`, err.message);
    }
  }

  console.log('[Aria] Stories quotidiennes générées.');
}

// ----------------------------------------------------------------
//  Génère et publie les stories d'UN client
// ----------------------------------------------------------------
async function generateDailyStoriesForClient(client) {
  console.log(`[Aria] Génération stories pour ${client.name}...`);

  // 1. Construire les données de chaque thème
  //    (Aria récupère le contenu du jour via son système existant)
  const storyDataByTheme = await buildDailyStoryData(client);

  // 2. Générer et publier chaque story
  for (const theme of STORY_THEMES) {
    try {
      // Générer l'image PNG
      const { imageUrl, templateId } = await generateStoryImage(
        client.id,
        theme,
        storyDataByTheme[theme] || {}
      );

      // Publier sur Instagram
      await publishStoryToInstagram(
        client.instagram_token,
        imageUrl,
        theme,
        client
      );

      console.log(`  [Aria] Story "${theme}" → Template ${templateId} ✓`);

    } catch (err) {
      console.error(`  [Aria] Erreur story "${theme}":`, err.message);
    }

    // Délai entre les publications (éviter le rate limiting Instagram)
    await sleep(3000);
  }
}

// ----------------------------------------------------------------
//  buildDailyStoryData(client)
//  Construit les données texte/contenu pour chaque thème du jour
//  Aria génère les textes via Claude API selon le thème
// ----------------------------------------------------------------
async function buildDailyStoryData(client) {
  // Récupérer les infos du client pour contexte Aria
  const { data: clientInfo } = await supabase
    .from('clients')
    .select('name, activity, services, tarifs, description')
    .eq('id', client.id)
    .single();

  // Récupérer le dernier post Instagram du client (pour thème nouveau_post)
  const lastPost = await getLastInstagramPost(client.instagram_token);

  // Générer les contenus via Claude (utiliser votre système Aria existant)
  const storyContents = await generateStoryContentsWithAria(clientInfo, lastPost);

  return {
    avant_apres: {
      title: storyContents.avantApresTitle || 'Résultats de nos clients',
      beforeText: 'Avant',
      afterText: 'Après nos soins',
    },
    presentation: {
      title: storyContents.presentationTitle || `${clientInfo.name}`,
      description: storyContents.presentationText || clientInfo.description,
    },
    tarifs: {
      service: storyContents.tarifsService || 'Nos prestations',
      price: storyContents.tarifsPrice || 'À partir de 49€',
      detail: storyContents.tarifsDetail || 'Contactez-nous',
    },
    nouveau_post: {
      title: 'Notre dernière publication',
      description: lastPost?.caption?.substring(0, 80) || 'Retrouvez notre dernier post',
      postImageUrl: lastPost?.media_url,
    },
    personnalisee: {
      title: storyContents.customTitle || 'Bonne journée !',
      message: storyContents.customMessage || clientInfo.tagline,
    },
  };
}

// ----------------------------------------------------------------
//  generateStoryContentsWithAria(clientInfo, lastPost)
//  Appel Claude API pour générer les textes des stories
//  À adapter selon votre système Aria existant
// ----------------------------------------------------------------
async function generateStoryContentsWithAria(clientInfo, lastPost) {
  const prompt = `Tu es Aria, l'assistante IA de ${clientInfo.name}.
  
  Génère des textes courts et accrocheurs pour 5 stories Instagram aujourd'hui.
  Activité du client : ${clientInfo.activity}
  Services : ${clientInfo.services}
  
  Réponds en JSON avec ces clés :
  - avantApresTitle (max 30 chars)
  - presentationTitle (max 30 chars)  
  - presentationText (max 60 chars)
  - tarifsService (max 25 chars)
  - tarifsPrice (max 20 chars)
  - tarifsDetail (max 30 chars)
  - customTitle (max 30 chars)
  - customMessage (max 50 chars)`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {}; // Fallback sur les textes par défaut
  }
}

// ----------------------------------------------------------------
//  publishStoryToInstagram(token, imageUrl, theme, client)
//  Publication sur Instagram via l'API Graph existante
//  (adapter selon votre code de publication existant)
// ----------------------------------------------------------------
async function publishStoryToInstagram(token, imageUrl, theme, client) {
  // Utiliser votre système de publication Instagram existant
  // C'est le même flow que vos publications posts/stories actuelles
  // Remplacer par votre fonction existante de publication

  const igUserId = client.instagram_user_id;

  // 1. Créer le conteneur média
  const containerRes = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        media_type: 'STORIES',
        access_token: token,
      }),
    }
  );
  const { id: containerId } = await containerRes.json();

  // 2. Publier
  await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: token,
    }),
  });
}

async function getLastInstagramPost(token) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/me/media?fields=id,caption,media_url,timestamp&limit=1&access_token=${token}`
    );
    const data = await res.json();
    return data.data?.[0] || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------
//  HANDLER pour story personnalisée à la demande
//  Appelé quand le client fait une demande spécifique à Aria
// ----------------------------------------------------------------
async function generateCustomStory(clientId, customMessage) {
  return await generateStoryImage(clientId, 'personnalisee', {
    title: 'Message spécial',
    message: customMessage,
  });
}

module.exports = {
  runDailyStoriesCron,
  generateDailyStoriesForClient,
  generateCustomStory,
};

// ----------------------------------------------------------------
//  CRON setup (à ajouter dans votre scheduler existant)
//  Exemple avec node-cron :
//
//  const cron = require('node-cron');
//  const { runDailyStoriesCron } = require('./aria_stories_integration');
//
//  // Chaque jour à 8h00
//  cron.schedule('0 8 * * *', runDailyStoriesCron);
// ----------------------------------------------------------------