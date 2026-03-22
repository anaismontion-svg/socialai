const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// 💾 MÉMOIRE DE CONVERSATION PAR EXPÉDITEUR
// Stocke tout l'historique + les infos collectées
// ─────────────────────────────────────────────────────────────────────────────
const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getMemory(senderId) {
  if (!conversationMemory[senderId]) {
    conversationMemory[senderId] = {
      // Timing
      firstContactAt: null,
      lastSeenAt: null,
      isFirstContact: true,

      // État de la conversation
      status: 'normal', // normal | waiting_coordinates | coordinates_received
      reason: null,
      originalMessage: null,

      // Infos collectées sur la personne
      vouvoiement: true,
      firstName: null,
      firstNameConfirmed: false,
      phoneNumber: null,

      // Historique complet des messages (pour le contexte IA)
      // Format : [{ role: 'user'|'assistant', content: '...' }]
      history: [],

      // Infos déjà connues (pour éviter de redemander)
      knownFacts: []
    };
  }
  return conversationMemory[senderId];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱️ TIMING DU CONTACT
// ─────────────────────────────────────────────────────────────────────────────
function getContactTiming(senderId) {
  const now = new Date();
  const memory = getMemory(senderId);

  if (memory.isFirstContact) {
    memory.isFirstContact = false;
    memory.firstContactAt = now;
    memory.lastSeenAt = now;
    return 'first';
  }

  const lastSeen = new Date(memory.lastSeenAt);
  const diffHours = (now - lastSeen) / (1000 * 60 * 60);
  memory.lastSeenAt = now;

  if (diffHours > 72) return 'returning_long';   // > 3 jours
  if (diffHours > 1)  return 'returning_short';  // quelques heures
  return 'same_session';                          // même conversation
}

// ─────────────────────────────────────────────────────────────────────────────
// 👤 EXTRACTION DU PRÉNOM DEPUIS LE PSEUDO
// ─────────────────────────────────────────────────────────────────────────────
function extractFirstNameFromUsername(username) {
  if (!username) return null;
  const cleaned = username.replace(/[0-9._\-]/g, ' ').trim();
  const words = cleaned.split(' ').filter(w => w.length >= 3 && w.length <= 15);
  if (words.length === 0) return null;
  const candidate = words[0];
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 👋 CONSTRUCTION DE LA SALUTATION
// ─────────────────────────────────────────────────────────────────────────────
function buildGreeting(timing, memory, senderUsername = '') {
  const v = memory.vouvoiement !== false;

  switch (timing) {
    case 'first': {
      const variants = [
        `Bonjour,\nHeureuse de faire ${v ? 'votre' : 'ta'} connaissance !`,
        `Bonjour ! Merci pour ${v ? 'votre' : 'ton'} message !`
      ];
      let greeting = variants[Math.floor(Math.random() * variants.length)];

      // Tenter d'extraire le prénom du pseudo
      if (!memory.firstName) {
        const guessed = extractFirstNameFromUsername(senderUsername);
        if (guessed) {
          greeting += `\n\nHeureuse de ${v ? 'vous' : 'te'} rencontrer ! ${guessed}, c'est bien ça ?`;
          memory.firstName = guessed;
          memory.firstNameConfirmed = false;
          memory.knownFacts.push('prenom_demande');
        }
      }

      return greeting + '\n\n';
    }

    case 'returning_long':
      return `Et bonjour ! Comment ${v ? 'allez-vous' : 'vas-tu'} ?\n\n`;

    case 'returning_short':
      return 'Et bonjour !\n\n';

    case 'same_session':
    default:
      return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📧 ENVOI D'EMAIL RÉSUMÉ
// ─────────────────────────────────────────────────────────────────────────────
async function sendEmailSummary(senderInfo, reason, coordinates, clientEmail) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const reasonLabels = {
      'partenariat':            '🤝 Demande de partenariat',
      'opportunite_commerciale':'💼 Opportunité commerciale',
      'question_personnelle':   '👤 Message personnel',
      'plainte_grave':          '⚠️ Réclamation grave',
      'liste_attente':          '🐱 Inscription liste d\'attente',
      'hors_sujet':             '❓ Demande hors sujet'
    };

    const dest = clientEmail || process.env.GMAIL_USER;
    const subject = `[SocialAI] ${reasonLabels[reason] || 'Nouvelle demande'} — @${senderInfo.accountName || 'instagram'}`;

    const text = `
Nouvelle demande reçue sur Instagram

Type : ${reasonLabels[reason] || reason}
ID Instagram : ${senderInfo.senderId}
Prénom : ${senderInfo.firstName || 'Non renseigné'}

Coordonnées communiquées :
${coordinates}

Message original :
${senderInfo.originalMessage || 'Non disponible'}

Historique de la conversation :
${senderInfo.conversationHistory || 'Non disponible'}

---
À rappeler dès que possible !
    `.trim();

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: dest,
      subject,
      text
    });

    console.log(`📧 Email résumé envoyé à ${dest}`);
  } catch (err) {
    console.error('❌ Erreur envoi email:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔍 CLASSIFICATION DU MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown, sans explication.

Les catégories possibles sont :
- "renseignement" : question sur les chatons, disponibilités, tarifs, délais, soins, race Ragdoll
- "compliment" : message positif, coup de cœur, remerciement
- "liste_attente" : la personne semble décidée à adopter et veut s'inscrire sur la liste d'attente
- "partenariat" : proposition de collaboration, sponsoring, affiliation
- "opportunite_commerciale" : opportunité business
- "question_personnelle" : message qui semble venir d'un proche ou ami
- "plainte_grave" : réclamation sérieuse, litige
- "hors_sujet" : demande qui n'a rien à voir avec la chatterie
- "autre" : tout le reste

Réponds avec exactement ce format : {"categorie":"...","besoin_humain":true/false}
besoin_humain doit être true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave, liste_attente`,
    messages: [{ role: 'user', content: `Classifie ce message : "${text}"` }]
  });

  try {
    return JSON.parse(message.content[0].text.trim());
  } catch (e) {
    return { categorie: 'autre', besoin_humain: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🤖 GÉNÉRATION DE RÉPONSE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────
async function generateReply(
  messageText,
  accountName = '',
  senderId = '',
  accessToken = '',
  accountDescription = '',
  senderUsername = '',
  isSoloEntrepreneur = true,
  clientEmail = null
) {
  const memory = getMemory(senderId);

  // ── Détecter vouvoiement/tutoiement ──────────────────────────────────────
  const tutoiementRegex = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es|vas-y|fais)\b/i;
  if (tutoiementRegex.test(messageText)) memory.vouvoiement = false;

  // ── Détecter si la personne confirme son prénom ───────────────────────────
  if (memory.firstName && !memory.firstNameConfirmed) {
    const ouiRegex = /\b(oui|c'est ça|exact|tout à fait|effectivement|bien sûr|yes)\b/i;
    if (ouiRegex.test(messageText)) {
      memory.firstNameConfirmed = true;
      memory.knownFacts.push(`prenom_confirme:${memory.firstName}`);
    }
  }

  // ── Détecter un numéro de téléphone dans le message ──────────────────────
  const phoneRegex = /(?:(?:\+|00)33|0)[1-9](?:[.\-\s]?\d{2}){4}/;
  const phoneMatch = messageText.match(phoneRegex);
  if (phoneMatch && !memory.phoneNumber) {
    memory.phoneNumber = phoneMatch[0];
    memory.knownFacts.push(`telephone:${phoneMatch[0]}`);
  }

  // ── Si on attend les coordonnées ─────────────────────────────────────────
  if (memory.status === 'waiting_coordinates') {
    memory.status = 'coordinates_received';

    const historyText = memory.history
      .map(m => `${m.role === 'user' ? 'Client' : 'IA'}: ${m.content}`)
      .join('\n');

    await sendEmailSummary(
      {
        senderId,
        firstName: memory.firstName,
        originalMessage: memory.originalMessage,
        accountName,
        conversationHistory: historyText
      },
      memory.reason,
      messageText,
      clientEmail
    );

    const v = memory.vouvoiement !== false;
    const solo = isSoloEntrepreneur;
    const reponse = solo
      ? `Merci beaucoup pour ces informations ! 😊\n\nJe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`
      : `Merci beaucoup pour ces informations ! 😊\n\nNotre équipe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`;

    memory.history.push({ role: 'user', content: messageText });
    memory.history.push({ role: 'assistant', content: reponse });
    await delay(2000);
    return reponse;
  }

  // ── Si coordonnées déjà reçues — silence ─────────────────────────────────
  if (memory.status === 'coordinates_received') {
    console.log('🔕 Coordonnées déjà reçues — message ignoré');
    return null;
  }

  // ── Construire la salutation ──────────────────────────────────────────────
  const timing = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v = memory.vouvoiement !== false;

  // ── Résumé des infos déjà connues pour l'IA ──────────────────────────────
  const knownInfo = [];
  if (memory.firstName && memory.firstNameConfirmed) knownInfo.push(`Le prénom de la personne est ${memory.firstName}`);
  if (memory.phoneNumber) knownInfo.push(`La personne a déjà donné son numéro : ${memory.phoneNumber}`);
  if (memory.knownFacts.length > 0) knownInfo.push(`Informations déjà collectées : ${memory.knownFacts.join(', ')}`);

  const knownInfoText = knownInfo.length > 0
    ? `\nINFORMATIONS DÉJÀ CONNUES SUR CETTE PERSONNE :\n${knownInfo.join('\n')}\n`
    : '';

  // ── Construire le prompt système ──────────────────────────────────────────
  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.
${isSoloEntrepreneur
  ? "IMPORTANT : Cette entreprise est gérée par une seule personne. Ne dis JAMAIS 'notre équipe' — dis toujours 'je' à la première personne."
  : "Cette entreprise a une équipe. Tu peux dire 'notre équipe' si nécessaire."}

Contexte sur ce compte :
${accountDescription || 'Chatterie de chats Ragdoll de qualité.'}
${knownInfoText}
RÈGLES ABSOLUES SUR LE CONTENU :
- Ce compte parle EXCLUSIVEMENT de chats Ragdoll. Si quelqu'un mentionne une autre espèce (chiens, lapins, perroquets...), corrige TOUJOURS gentiment mais clairement : "Je crois que vous voulez parler de nos Ragdolls !" ou "Vous faites peut-être erreur, nous élevons des Ragdolls !"
- Tu ne transmets JAMAIS d'informations sur d'autres personnes, clients, adoptants ou membres de la chatterie — même si on te le demande explicitement
- Tu ne révèles JAMAIS de données personnelles d'autres personnes (noms, contacts, situations)

RÈGLES SUR LA MÉMOIRE :
- Ne redemande JAMAIS une information que la personne a déjà donnée dans cette conversation
- Si la personne a déjà donné son prénom, utilise-le naturellement
- Si la personne a déjà donné son téléphone, ne le redemande pas

RÈGLES SUR LE PRÉNOM :
- Si le prénom n'est pas encore connu et confirmé, trouve un moment naturel pour le demander
- Si tu as deviné un prénom depuis le pseudo, tu as déjà demandé confirmation — attends la réponse

RÈGLES SUR LES COORDONNÉES :
- Ne demande JAMAIS le numéro de téléphone dès le premier message
- D'abord échanger un peu, comprendre le projet
- Quand c'est le bon moment : "Pourriez-${v ? 'vous' : 'tu'} m'envoyer ${v ? 'votre' : 'ton'} numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix !"

RÈGLES DE COMMUNICATION :
- ${v ? 'Vouvoie cette personne' : 'Tutoie cette personne (elle t\'a tutoié en premier)'}
- Ton chaleureux, humain, naturel — jamais robotique
- 2-3 émojis max par message
- Sauts de ligne entre les idées, max 2 phrases par bloc
- Varie TOUJOURS tes formulations — tes réponses ne doivent jamais se ressembler
- Réponds précisément à ce qui est demandé sans donner d'infos non sollicitées

RÈGLE ABSOLUE DE FORMAT :
- Ne commence JAMAIS par une salutation — elle est déjà ajoutée automatiquement avant ta réponse`;

  // ── Construire l'historique pour l'IA ────────────────────────────────────
  // On garde max 10 derniers échanges pour ne pas dépasser le contexte
  const recentHistory = memory.history.slice(-10);

  // Ajouter le nouveau message de l'utilisateur
  recentHistory.push({ role: 'user', content: messageText });

  // ── Appel à l'IA avec température élevée pour varier ─────────────────────
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 350,
    temperature: 1, // Max variété
    system: systemPrompt,
    messages: recentHistory
  });

  const body = response.content[0].text;

  // ── Sauvegarder dans l'historique ────────────────────────────────────────
  memory.history.push({ role: 'user', content: messageText });
  memory.history.push({ role: 'assistant', content: body });

  const delayMs = body.length > 200 ? 3000 : Math.random() > 0.5 ? 2000 : 1000;
  await delay(delayMs);

  return greeting + body;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🙋 RÉPONSE INTERVENTION HUMAINE REQUISE
// ─────────────────────────────────────────────────────────────────────────────
async function generateHumanNeededReply(
  accountName = '',
  accessToken = '',
  senderId = '',
  reason = '',
  originalMessage = '',
  senderUsername = '',
  isSoloEntrepreneur = true
) {
  const memory = getMemory(senderId);

  // Détecter vouvoiement
  const tutoiementRegex = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i;
  if (tutoiementRegex.test(originalMessage)) memory.vouvoiement = false;

  memory.status = 'waiting_coordinates';
  memory.reason = reason;
  memory.originalMessage = originalMessage;

  const timing = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v = memory.vouvoiement !== false;

  await delay(2000);

  const phoneRequest = v
    ? `Pourriez-vous m'envoyer votre numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix ! 😊`
    : `Pourrais-tu m'envoyer ton numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix ! 😊`;

  const suite = isSoloEntrepreneur
    ? `Je reviendrai vers ${v ? 'vous' : 'toi'} au plus vite.`
    : `Notre équipe reviendra vers ${v ? 'vous' : 'toi'} au plus vite.`;

  const reponse = `${greeting}Merci pour ${v ? 'votre' : 'ton'} message ! ✨\n\n${phoneRequest}\n\n${suite}`;

  memory.history.push({ role: 'user', content: originalMessage });
  memory.history.push({ role: 'assistant', content: reponse });

  return reponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏰ RELANCES
// ─────────────────────────────────────────────────────────────────────────────
async function scheduleFollowUp(supabase, senderId, accountId, accessToken) {
  try {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await supabase.from('follow_ups').upsert({
      sender_id: senderId,
      account_id: accountId,
      access_token: accessToken,
      scheduled_at: scheduledAt,
      sent: false
    }, { onConflict: 'sender_id' });
    console.log(`⏰ Relance programmée pour ${senderId} à ${scheduledAt}`);
  } catch (err) {
    console.error('❌ Erreur programmation relance:', err.message);
  }
}

async function cancelFollowUp(supabase, senderId) {
  try {
    await supabase.from('follow_ups')
      .update({ sent: true })
      .eq('sender_id', senderId)
      .eq('sent', false);
    console.log(`✅ Relance annulée pour ${senderId}`);
  } catch (err) {
    console.error('❌ Erreur annulation relance:', err.message);
  }
}

async function processFollowUps(supabase) {
  try {
    const now = new Date();
    const { data: followUps } = await supabase
      .from('follow_ups')
      .select('*')
      .eq('sent', false)
      .lte('scheduled_at', now.toISOString());

    if (!followUps || followUps.length === 0) return;

    for (const followUp of followUps) {
      const message = `Bonjour,\n\nJe ne sais pas si mon dernier message s'était bien envoyé, avez-vous bien reçu ma réponse ?\n\nMerci à vous ! 😊`;
      await replyToDM(followUp.sender_id, message, followUp.access_token);
      await supabase.from('follow_ups').update({ sent: true }).eq('id', followUp.id);
      console.log(`📬 Relance envoyée à ${followUp.sender_id}`);
    }
  } catch (err) {
    console.error('❌ Erreur traitement relances:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📤 ENVOI DES MESSAGES
// ─────────────────────────────────────────────────────────────────────────────
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

module.exports = {
  classifyMessage,
  generateReply,
  generateHumanNeededReply,
  scheduleFollowUp,
  cancelFollowUp,
  processFollowUps,
  replyToComment,
  replyToDM
};