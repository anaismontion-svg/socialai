const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isNewDayOrFirstContact(senderId) {
  const now = new Date();
  const memory = conversationMemory[senderId];

  if (!memory) {
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
  if (process.env.CONTACT_PHONE) return process.env.CONTACT_PHONE;
  try {
    const { data } = await axios.get('https://graph.instagram.com/v19.0/me', {
      params: { fields: 'phone_number', access_token: accessToken }
    });
    if (data.phone_number) return data.phone_number;
  } catch (e) {}
  console.warn('⚠️ Numéro de téléphone non disponible — ajoutez CONTACT_PHONE dans vos variables Railway');
  return null;
}

async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown, sans explication.

Les catégories possibles sont :
- "renseignement" : question sur les chatons, disponibilités, tarifs, délais, soins, race Ragdoll
- "compliment" : message positif, coup de cœur, remerciement
- "liste_attente" : demande pour s'inscrire sur la liste d'attente
- "partenariat" : proposition de collaboration, sponsoring, affiliation
- "opportunite_commerciale" : opportunité business
- "question_personnelle" : message qui semble venir d'un proche ou ami
- "plainte_grave" : réclamation sérieuse, litige
- "autre" : tout le reste

Réponds avec exactement ce format : {"categorie":"...","besoin_humain":true/false}
besoin_humain doit être true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave`,
    messages: [{ role: 'user', content: `Classifie ce message : "${text}"` }]
  });

  try {
    return JSON.parse(message.content[0].text.trim());
  } catch (e) {
    return { categorie: 'autre', besoin_humain: false };
  }
}

async function generateReply(context, accountName = '', senderId = '', accessToken = '', accountDescription = '') {
  const { isFirst, isNewDay } = isNewDayOrFirstContact(senderId);

  let greeting = '';
  if (isFirst) {
    greeting = Math.random() > 0.5
      ? 'Bonjour, enchantée, merci pour votre intérêt ! '
      : 'Bonjour, merci beaucoup pour votre message ! ';
  } else if (isNewDay) {
    greeting = 'Bonjour, ravie de vous retrouver ! ';
  }

  const contextInfo = accountDescription || '';

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.

Contexte sur ce compte :
${contextInfo}

Règles de communication :
- Tu vouvoies TOUJOURS les personnes par défaut
- Si la personne te tutoie, tu peux adopter le tutoiement naturellement
- Ton ton est élégant, chaleureux et humain — jamais robotique
- Tu utilises des émojis avec subtilité (2-3 max par message)
- Tes réponses font 2-3 phrases, naturelles et variées
- Tu ne répètes jamais la même formule
- Tu parles des Ragdolls avec passion et expertise
- Tu ne "vends" pas un chaton — tu accompagnes les familles dans leur projet d'adoption
- Tu mentionnes la liste d'attente sur www.lovequeendolls.com quand c'est pertinent
- Tu invites toujours doucement à en savoir plus ou à poser des questions

Règles absolues :
- Ne commence JAMAIS par une salutation — elle est déjà gérée séparément
- Ne sois JAMAIS générique ou copier-coller
- Varie toujours tes formulations`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Réponds à ce message reçu sur Instagram (sans salutation) : "${context}"` }]
  });

  const body = message.content[0].text;
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

  return `${greeting}Nous avons bien reçu votre message et allons nous renseigner pour vous apporter la meilleure réponse possible. Nous revenons vers vous très rapidement ! ✨ ${contactLine}`;
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
      { recipient: { id: recipientId }, message: { text: reply } },
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