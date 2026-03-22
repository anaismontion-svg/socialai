const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getMemory(senderId) {
  if (!conversationMemory[senderId]) {
    conversationMemory[senderId] = {
      lastSeen: null,
      isFirstContact: true,
      status: 'normal',
      reason: null,
      originalMessage: null,
      firstName: null,
      vouvoiement: true
    };
  }
  return conversationMemory[senderId];
}

function extractFirstNameFromUsername(username) {
  if (!username) return null;
  // Supprimer les chiffres, underscores, points
  const cleaned = username.replace(/[0-9._]/g, ' ').trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  if (words.length === 0) return null;
  // Retourner le premier mot capitalisé si ça ressemble à un prénom
  const candidate = words[0];
  if (candidate.length >= 3 && candidate.length <= 15) {
    return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
  }
  return null;
}

function getContactTiming(senderId) {
  const now = new Date();
  const memory = getMemory(senderId);
  const isFirst = memory.isFirstContact;

  if (isFirst) {
    memory.isFirstContact = false;
    memory.lastSeen = now;
    return 'first';
  }

  const lastSeen = new Date(memory.lastSeen);
  const diffDays = (now - lastSeen) / (1000 * 60 * 60 * 24);
  memory.lastSeen = now;

  if (diffDays > 3) return 'returning_long'; // plusieurs jours
  if (diffDays > 0.04) return 'returning_short'; // quelques heures
  return 'same_session'; // même conversation en cours
}

async function sendEmailSummary(senderInfo, reason, coordinates) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const reasonLabels = {
      'partenariat': '🤝 Demande de partenariat',
      'opportunite_commerciale': '💼 Opportunité commerciale',
      'question_personnelle': '👤 Message personnel',
      'plainte_grave': '⚠️ Réclamation grave',
      'liste_attente': '🐱 Inscription liste d\'attente',
      'hors_sujet': '❓ Demande hors sujet'
    };

    const subject = `[SocialAI] ${reasonLabels[reason] || 'Nouvelle demande'} — @lovequeendolls`;
    const text = `
Nouvelle demande reçue sur Instagram @lovequeendolls

Type : ${reasonLabels[reason] || reason}
ID Instagram : ${senderInfo.senderId}

Coordonnées communiquées :
${coordinates}

Message original :
${senderInfo.originalMessage || 'Non disponible'}

---
À rappeler dès que possible !
    `.trim();

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: 'anais.montion@gmail.com',
      subject,
      text
    });

    console.log('📧 Email résumé envoyé à anais.montion@gmail.com');
  } catch (err) {
    console.error('❌ Erreur envoi email:', err.message);
  }
}

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
besoin_humain doit être true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave, liste_attente, hors_sujet`,
    messages: [{ role: 'user', content: `Classifie ce message : "${text}"` }]
  });

  try {
    return JSON.parse(message.content[0].text.trim());
  } catch (e) {
    return { categorie: 'autre', besoin_humain: false };
  }
}

function buildGreeting(timing, memory, senderUsername = '') {
  const vouvoiement = memory.vouvoiement !== false;
  const vous = vouvoiement ? 'vous' : 'toi';
  const votre = vouvoiement ? 'votre' : 'ton';

  // Essayer d'extraire le prénom depuis le pseudo
  const guessedName = extractFirstNameFromUsername(senderUsername);

  switch (timing) {
    case 'first': {
      // 2 variantes pour le premier contact
      const variants = [
        `Bonjour,\nHeureuse de faire ${vous === 'vous' ? 'votre' : 'ta'} connaissance !`,
        `Bonjour ! Merci pour ${vous === 'vous' ? 'votre' : 'ton'} message !`
      ];
      let greeting = variants[Math.floor(Math.random() * variants.length)];

      // Proposer confirmation du prénom si on pense l'avoir deviné
      if (guessedName && !memory.firstName) {
        greeting += `\n\nHeureuse de ${vous === 'vous' ? 'vous' : 'te'} rencontrer ! ${guessedName}, c'est bien ça ?`;
        memory.firstName = guessedName;
        memory.firstNameConfirmed = false;
      }

      return greeting + '\n\n';
    }

    case 'returning_long':
      return `Et bonjour ! Comment ${vous === 'vous' ? 'allez-vous' : 'vas-tu'} ?\n\n`;

    case 'returning_short':
      return `Et bonjour !\n\n`;

    case 'same_session':
    default:
      return '';
  }
}

async function generateReply(context, accountName = '', senderId = '', accessToken = '', accountDescription = '', senderUsername = '') {
  const memory = getMemory(senderId);

  // Détecter le vouvoiement/tutoiement dans le message
  const tutoiementKeywords = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i;
  if (tutoiementKeywords.test(context)) {
    memory.vouvoiement = false;
  }

  // Si on attend les coordonnées
  if (memory.status === 'waiting_coordinates') {
    memory.status = 'coordinates_received';
    await delay(2000);

    await sendEmailSummary(
      { senderId, originalMessage: memory.originalMessage },
      memory.reason,
      context
    );

    return `Merci beaucoup pour ces informations ! 😊\n\nNous allons transmettre votre demande et quelqu'un de notre équipe reviendra vers vous très prochainement.\n\nÀ très vite ! ✨`;
  }

  // Si coordonnées déjà reçues — on ne répond plus
  if (memory.status === 'coordinates_received') {
    console.log('🔕 Coordonnées déjà reçues — message laissé en NON LU');
    return null;
  }

  const timing = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);

  const vouvoiement = memory.vouvoiement !== false;

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.

Contexte sur ce compte :
${accountDescription}

RÈGLES ABSOLUES SUR LE CONTENU :
- Ce compte parle EXCLUSIVEMENT de chats Ragdoll. Si quelqu'un dit "chiens", "lapins" ou toute autre espèce, corrige TOUJOURS gentiment : "Vous voulez dire nos Ragdolls ?" ou "Je crois que vous voulez parler de nos Ragdolls !"
- Tu parles des Ragdolls avec passion et expertise
- Tu ne "vends" pas un chaton — tu accompagnes les familles dans leur projet d'adoption

RÈGLES DE COMMUNICATION :
- ${vouvoiement ? 'Tu vouvoies cette personne' : 'Tu tutoies cette personne (elle t\'a tutoié en premier)'}
- Ton ton est chaleureux, humain et naturel — jamais robotique
- Tu utilises des émojis avec subtilité (2-3 max par message)
- Tu aères tes messages avec des sauts de ligne entre les idées
- Maximum 2 phrases par bloc, puis saut de ligne
- Tes réponses sont variées, jamais copiées-collées

RÈGLES SUR LES INFORMATIONS PERSONNELLES :
- Ne demande JAMAIS le numéro de téléphone ou les coordonnées dès le premier message
- Essaie d'abord d'en savoir un peu plus sur la personne et son projet (sans être indiscret)
- Le prénom est une information essentielle — s'il n'est pas encore connu, trouve un moment naturel pour le demander
- Ce n'est qu'après avoir un peu échangé que tu peux demander gentiment : "Pourriez-vous m'envoyer votre numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix !"

RÈGLES ABSOLUES DE FORMAT :
- Ne commence JAMAIS par une salutation — elle est déjà ajoutée automatiquement avant ta réponse
- Ne sois JAMAIS générique
- Réponds UNIQUEMENT à ce qui est demandé, de façon précise
- Ne donne pas d'informations non demandées
- Varie toujours tes formulations`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Réponds à ce message reçu sur Instagram (sans salutation, la salutation est déjà gérée) : "${context}"` }]
  });

  const body = message.content[0].text;
  const delayMs = body.length > 200 ? 3000 : Math.random() > 0.5 ? 2000 : 1000;
  await delay(delayMs);

  return greeting + body;
}

async function generateHumanNeededReply(accountName = '', accessToken = '', senderId = '', reason = '', originalMessage = '', senderUsername = '') {
  const memory = getMemory(senderId);

  // Détecter vouvoiement/tutoiement
  const tutoiementKeywords = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i;
  if (tutoiementKeywords.test(originalMessage)) {
    memory.vouvoiement = false;
  }

  memory.status = 'waiting_coordinates';
  memory.reason = reason;
  memory.originalMessage = originalMessage;

  const timing = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const vouvoiement = memory.vouvoiement !== false;

  await delay(2000);

  const phoneRequest = vouvoiement
    ? `Pourriez-vous m'envoyer votre numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix ! 😊`
    : `Pourrais-tu m'envoyer ton numéro de téléphone ? Ce sera plus simple d'échanger directement de vive voix ! 😊`;

  return `${greeting}Merci pour votre message ! ✨\n\n${phoneRequest}\n\nJe vais transmettre votre demande pour que l'on revienne vers vous au plus vite.`;
}

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