const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mémoire en RAM : { senderId: { lastSeen: Date, isFirstContact: bool } }
const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isNewDayOrFirstContact(senderId) {
  const now = new Date();
  const memory = conversationMemory[senderId];

  if (!memory) {
    // Première fois qu'on voit cette personne
    conversationMemory[senderId] = { lastSeen: now, isFirstContact: true };
    return { isFirst: true, isNewDay: false };
  }

  const lastSeen = new Date(memory.lastSeen);
  const isNewDay =
    lastSeen.getDate() !== now.getDate() ||
    lastSeen.getMonth() !== now.getMonth() ||
    lastSeen.getFullYear() !== now.getFullYear();

  conversationMemory[senderId].lastSeen = now;

  return { isFirst: false, isNewDay };
}

async function getPhoneNumber(accessToken) {
  // Priorité 1 : variable d'environnement
  if (process.env.CONTACT_PHONE) return process.env.CONTACT_PHONE;

  // Priorité 2 : tentative via l'API Meta
  try {
    const { data } = await axios.get('https://graph.instagram.com/v19.0/me', {
      params: {
        fields: 'phone_number',
        access_token: accessToken
      }
    });
    if (data.phone_number) return data.phone_number;
  } catch (e) {
    // Silencieux, on log en dessous
  }

  console.warn('⚠️ Numéro de téléphone non disponible — ajoutez CONTACT_PHONE dans vos variables Railway (ex: CONTACT_PHONE=+33612345678)');
  return null;
}

async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown, sans explication.

Les catégories possibles sont :
- "renseignement" : question sur les produits, prix, délais, disponibilité, soins des poupées
- "compliment" : message positif, coup de cœur, remerciement
- "commande" : suivi de commande, livraison
- "partenariat" : proposition de collaboration, sponsoring, affiliation
- "opportunite_commerciale" : achat en gros, revendeur, opportunité business
- "question_personnelle" : message qui semble venir d'un proche ou ami
- "plainte_grave" : réclamation sérieuse, litige, remboursement
- "autre" : tout le reste

Réponds avec exactement ce format : {"categorie":"...","besoin_humain":true/false}
besoin_humain doit être true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave`,
    messages: [{
      role: 'user',
      content: `Classifie ce message : "${text}"`
    }]
  });

  try {
    return JSON.parse(message.content[0].text.trim());
  } catch (e) {
    console.warn('⚠️ Erreur classification, fallback IA par défaut');
    return { categorie: 'autre', besoin_humain: false };
  }
}

async function generateReply(context, accountName = '', senderId = '', accessToken = '') {
  const { isFirst, isNewDay } = isNewDayOrFirstContact(senderId);

  let greeting = '';
  if (isFirst) {
    greeting = Math.random() > 0.5
      ? 'Bonjour, enchantée, merci pour votre intérêt ! '
      : 'Bonjour, merci beaucoup pour votre message ! ';
  } else if (isNewDay) {
    greeting = 'Bonjour, ravie de vous retrouver ! ';
  }

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}, une boutique de poupées de collection haut de gamme.

Ton style :
- Ton élégant, chaleureux et humain — jamais robotique
- Tu utilises des émojis avec subtilité (2-3 max par message)
- Tes réponses font 2-3 phrases, naturelles et variées
- Tu ne répètes jamais la même formule
- Tu parles des poupées avec passion et expertise
- Tu mentionnes les collections, la qualité artisanale, les éditions limitées quand c'est pertinent
- Tu invites toujours doucement à l'action (poser des questions, découvrir la collection)

Règles absolues :
- Ne commence JAMAIS par une salutation — elle est déjà gérée séparément
- Ne sois JAMAIS générique ou copier-coller
- Varie toujours tes formulations`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Réponds à ce message reçu sur Instagram (sans salutation, elle est déjà ajoutée) : "${context}"`
    }]
  });

  const body = message.content[0].text;

  // Délai selon longueur du message
  const delayMs = body.length > 200 ? 3000 : Math.random() > 0.5 ? 2000 : 1000;
  await delay(delayMs);

  return greeting + body;
}

async function generateHumanNeededReply(accountName = '', accessToken = '', senderId = '') {
  const { isFirst, isNewDay } = isNewDayOrFirstContact(senderId);

  let greeting = '';
  if (isFirst) {
    greeting = Math.random() > 0.5
      ? 'Bonjour, enchantée, merci pour votre intérêt ! '
      : 'Bonjour, merci beaucoup pour votre message ! ';
  } else if (isNewDay) {
    greeting = 'Bonjour, ravie de vous retrouver ! ';
  }

  const phone = await getPhoneNumber(accessToken);
  const contactLine = phone
    ? `Si votre demande est urgente, n'hésitez pas à nous appeler directement au ${phone}. 📞`
    : `Si votre demande est urgente, n'hésitez pas à nous contacter via notre profil. 📩`;

  await delay(2000);

  return `${greeting}Nous avons bien reçu votre message et nous allons nous renseigner pour vous apporter la meilleure réponse possible. Nous revenons vers vous très rapidement ! ✨ ${contactLine}`;
}

async function replyToComment(commentId, reply, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v19.0/${commentId}/replies`,
      { message: reply },
      { params: { access_token: accessToken } }
    );
    console.log(`✅ Réponse envoyée au commentaire ${commentId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur commentaire ${commentId}:`, error.response?.data || error.message);
    throw error;
  }
}

async function replyToDM(recipientId, reply, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: reply }
      },
      { params: { access_token: accessToken } }
    );
    console.log(`✅ DM envoyé à ${recipientId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur DM à ${recipientId}:`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = { classifyMessage, generateReply, generateHumanNeededReply, replyToComment, replyToDM };