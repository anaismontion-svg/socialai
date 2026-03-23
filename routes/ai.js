const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// 💾 MÉMOIRE DE CONVERSATION PAR EXPÉDITEUR
// ─────────────────────────────────────────────
const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getMemory(senderId) {
  if (!conversationMemory[senderId]) {
    conversationMemory[senderId] = {
      firstContactAt:     null,
      lastSeenAt:         null,
      isFirstContact:     true,
      status:             'normal',
      reason:             null,
      originalMessage:    null,
      vouvoiement:        true,
      firstName:          null,
      firstNameConfirmed: false,
      phoneNumber:        null,
      history:            [],
      knownFacts:         []
    };
  }
  return conversationMemory[senderId];
}

// ─────────────────────────────────────────────
// ⏱️ TIMING DU CONTACT
// ─────────────────────────────────────────────
function getContactTiming(senderId) {
  const now    = new Date();
  const memory = getMemory(senderId);
  if (memory.isFirstContact) {
    memory.isFirstContact = false;
    memory.firstContactAt = now;
    memory.lastSeenAt     = now;
    return 'first';
  }
  const diffHours = (now - new Date(memory.lastSeenAt)) / (1000 * 60 * 60);
  memory.lastSeenAt = now;
  if (diffHours > 72) return 'returning_long';
  if (diffHours > 1)  return 'returning_short';
  return 'same_session';
}

// ─────────────────────────────────────────────
// 👤 EXTRACTION PRÉNOM DEPUIS PSEUDO
// ─────────────────────────────────────────────
function extractFirstNameFromUsername(username) {
  if (!username) return null;
  const cleaned = username.replace(/[0-9._\-]/g, ' ').trim();
  const words   = cleaned.split(' ').filter(w => w.length >= 3 && w.length <= 15);
  if (words.length === 0) return null;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
}

// ─────────────────────────────────────────────
// 👋 SALUTATION DM
// ─────────────────────────────────────────────
function buildGreeting(timing, memory, senderUsername = '') {
  const v = memory.vouvoiement !== false;
  switch (timing) {
    case 'first': {
      const variants = [
        `Bonjour,\nHeureuse de faire ${v ? 'votre' : 'ta'} connaissance !`,
        `Bonjour ! Merci pour ${v ? 'votre' : 'ton'} message !`
      ];
      let greeting = variants[Math.floor(Math.random() * variants.length)];
      if (!memory.firstName) {
        const guessed = extractFirstNameFromUsername(senderUsername);
        if (guessed) {
          greeting += `\n\nHeureuse de ${v ? 'vous' : 'te'} rencontrer ! ${guessed}, c'est bien ça ?`;
          memory.firstName          = guessed;
          memory.firstNameConfirmed = false;
          memory.knownFacts.push('prenom_demande');
        }
      }
      return greeting + '\n\n';
    }
    case 'returning_long':  return `Et bonjour ! Comment ${v ? 'allez-vous' : 'vas-tu'} ?\n\n`;
    case 'returning_short': return 'Et bonjour !\n\n';
    default:                return '';
  }
}

// ─────────────────────────────────────────────
// 📧 ENVOI EMAIL RÉSUMÉ
// ─────────────────────────────────────────────
async function sendEmailSummary(senderInfo, reason, coordinates, clientEmail) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
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
    await transporter.sendMail({
      from: `SocialAI <${process.env.GMAIL_USER}>`,
      to:   dest,
      subject: `[SocialAI] ${reasonLabels[reason] || 'Nouvelle demande'} — @${senderInfo.accountName || 'instagram'}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;padding:24px;background:#0d0d14;color:#f5f4f0;border-radius:12px">
          <div style="font-size:18px;font-weight:700;margin-bottom:16px">📩 Nouvelle demande</div>
          <p style="color:#c8c6be">Type : <strong style="color:#f5f4f0">${reasonLabels[reason]||reason}</strong></p>
          <p style="color:#c8c6be">Prénom : <strong style="color:#f5f4f0">${senderInfo.firstName||'Non renseigné'}</strong></p>
          <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin:12px 0">
            <div style="font-size:11px;color:#7a7870;margin-bottom:6px">COORDONNÉES</div>
            <div style="color:#f5f4f0">${coordinates}</div>
          </div>
          <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px">
            <div style="font-size:11px;color:#7a7870;margin-bottom:6px">MESSAGE ORIGINAL</div>
            <div style="color:#c8c6be">${senderInfo.originalMessage||'—'}</div>
          </div>
        </div>`
    });
    console.log(`📧 Email résumé envoyé à ${dest}`);
  } catch (err) {
    console.error('❌ Erreur envoi email:', err.message);
  }
}

// ─────────────────────────────────────────────
// 🔍 CLASSIFICATION MESSAGE
// ─────────────────────────────────────────────
async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown.
Les catégories : "renseignement","compliment","liste_attente","partenariat","opportunite_commerciale","question_personnelle","plainte_grave","hors_sujet","autre"
Format : {"categorie":"...","besoin_humain":true/false}
besoin_humain=true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave, liste_attente`,
    messages: [{ role:'user', content:`Classifie : "${text}"` }]
  });
  try {
    return JSON.parse(message.content[0].text.trim());
  } catch {
    return { categorie:'autre', besoin_humain:false };
  }
}

// ─────────────────────────────────────────────
// 💬 RÉPONSE AUX COMMENTAIRES INSTAGRAM
// Courte, émotionnelle, positive, humaine
// Délai de 3 secondes pour paraître naturel
// ─────────────────────────────────────────────
async function generateCommentReply(commentText, accountName = '', accountDescription = '') {
  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  80,
    temperature: 1,
    system: `Tu gères le compte Instagram @${accountName}.

Contexte : ${accountDescription || 'Compte Instagram professionnel'}

Tu dois répondre à un commentaire Instagram avec une réponse TRÈS courte, humaine et sincère.

RÈGLES ABSOLUES :
- Maximum 1 phrase (10 mots max)
- Toujours positif, chaleureux, émotionnel et sincère
- Utilise 1 emoji maximum
- Adapte ta réponse au contenu du commentaire
- Ne commence JAMAIS par "Merci pour votre commentaire" ou toute formule générique
- Varie les formulations, ne répète jamais la même chose
- Si c'est un compliment → exprime une émotion sincère (touchée, émue, ravie...)
- Si c'est une question → renvoie en DM avec une phrase courte et chaleureuse
- Si c'est du soutien → exprime ta gratitude avec sincérité
- Si c'est de l'enthousiasme → réponds avec le même enthousiasme

Exemples de bonnes réponses :
- "Merci du fond du cœur ! 🥹"
- "C'est tellement touchant, merci !"
- "Votre soutien nous va droit au cœur !"
- "C'est adorable, je suis vraiment touchée !"
- "Quel beau message, merci infiniment !"
- "Vous êtes trop gentil(le) ! 😊"
- "On vous répond en DM avec plaisir !"
- "Tellement heureuse que ça vous plaise !"

Retourne UNIQUEMENT la réponse, rien d'autre.`,
    messages: [{ role:'user', content:`Commentaire reçu : "${commentText}"` }]
  });

  // ── Délai 3 secondes pour paraître naturel ────────────────────────────────
  await delay(3000);

  return response.content[0].text.trim();
}

// ─────────────────────────────────────────────
// 🤖 RÉPONSE DM PRINCIPALE
// ─────────────────────────────────────────────
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

  // Détecter vouvoiement/tutoiement
  const tutoiementRegex = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es|vas-y|fais)\b/i;
  if (tutoiementRegex.test(messageText)) memory.vouvoiement = false;

  // Confirmation prénom
  if (memory.firstName && !memory.firstNameConfirmed) {
    if (/\b(oui|c'est ça|exact|tout à fait|effectivement|bien sûr|yes)\b/i.test(messageText)) {
      memory.firstNameConfirmed = true;
      memory.knownFacts.push(`prenom_confirme:${memory.firstName}`);
    }
  }

  // Détecter téléphone
  const phoneMatch = messageText.match(/(?:(?:\+|00)33|0)[1-9](?:[.\-\s]?\d{2}){4}/);
  if (phoneMatch && !memory.phoneNumber) {
    memory.phoneNumber = phoneMatch[0];
    memory.knownFacts.push(`telephone:${phoneMatch[0]}`);
  }

  // Si on attend les coordonnées
  if (memory.status === 'waiting_coordinates') {
    memory.status = 'coordinates_received';
    const historyText = memory.history
      .map(m => `${m.role === 'user' ? 'Client' : 'IA'}: ${m.content}`)
      .join('\n');
    await sendEmailSummary(
      { senderId, firstName: memory.firstName, originalMessage: memory.originalMessage, accountName, conversationHistory: historyText },
      memory.reason, messageText, clientEmail
    );
    const v    = memory.vouvoiement !== false;
    const solo = isSoloEntrepreneur;
    const rep  = solo
      ? `Merci beaucoup pour ces informations ! 😊\n\nJe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`
      : `Merci beaucoup pour ces informations ! 😊\n\nNotre équipe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`;
    memory.history.push({ role: 'user', content: messageText });
    memory.history.push({ role: 'assistant', content: rep });
    await delay(2000);
    return rep;
  }

  // Si coordonnées déjà reçues → silence
  if (memory.status === 'coordinates_received') {
    console.log('🔕 Coordonnées déjà reçues — message ignoré');
    return null;
  }

  const timing   = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v        = memory.vouvoiement !== false;

  // Infos déjà connues
  const knownInfo = [];
  if (memory.firstName && memory.firstNameConfirmed) knownInfo.push(`Prénom confirmé : ${memory.firstName}`);
  if (memory.phoneNumber) knownInfo.push(`Téléphone déjà donné : ${memory.phoneNumber}`);
  const knownInfoText = knownInfo.length > 0 ? `\nINFOS DÉJÀ CONNUES :\n${knownInfo.join('\n')}\n` : '';

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.
${isSoloEntrepreneur
  ? 'Cette entreprise est gérée par une seule personne. Ne dis JAMAIS "notre équipe" — utilise toujours "je".'
  : 'Cette entreprise a une équipe. Tu peux dire "notre équipe" si nécessaire.'}

Contexte : ${accountDescription || 'Compte Instagram professionnel'}
${knownInfoText}
RÈGLES ABSOLUES SUR LE CONTENU :
- Ce compte parle EXCLUSIVEMENT de chats Ragdoll. Si quelqu'un mentionne une autre espèce, corrige gentiment : "Vous voulez dire nos Ragdolls ?"
- Ne transmets JAMAIS d'informations sur d'autres personnes ou clients

RÈGLES SUR LA MÉMOIRE :
- Ne redemande JAMAIS une info déjà donnée dans cette conversation
- Utilise le prénom naturellement s'il est connu et confirmé

RÈGLES SUR LES COORDONNÉES :
- Ne demande JAMAIS le téléphone dès le premier message
- D'abord échanger, comprendre le projet
- Quand c'est le bon moment : "Pourriez-${v ? 'vous' : 'tu'} m'envoyer ${v ? 'votre' : 'ton'} numéro de téléphone ? Ce sera plus simple de vive voix !"

RÈGLES DE COMMUNICATION :
- ${v ? 'Vouvoie cette personne' : 'Tutoie cette personne'}
- Ton chaleureux, humain, naturel — jamais robotique
- 2-3 émojis max, sauts de ligne entre les idées
- Varie TOUJOURS tes formulations

FORMAT : Ne commence JAMAIS par une salutation (déjà ajoutée automatiquement).`;

  const recentHistory = memory.history.slice(-10);
  recentHistory.push({ role: 'user', content: messageText });

  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  350,
    temperature: 1,
    system:      systemPrompt,
    messages:    recentHistory
  });

  const body = response.content[0].text;
  memory.history.push({ role: 'user', content: messageText });
  memory.history.push({ role: 'assistant', content: body });

  await delay(body.length > 200 ? 3000 : Math.random() > 0.5 ? 2000 : 1000);
  return greeting + body;
}

// ─────────────────────────────────────────────
// 🙋 RÉPONSE INTERVENTION HUMAINE
// ─────────────────────────────────────────────
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
  const tutoiementRegex = /\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i;
  if (tutoiementRegex.test(originalMessage)) memory.vouvoiement = false;

  memory.status          = 'waiting_coordinates';
  memory.reason          = reason;
  memory.originalMessage = originalMessage;

  const timing   = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v        = memory.vouvoiement !== false;

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

// ─────────────────────────────────────────────
// ⏰ RELANCES
// ─────────────────────────────────────────────
async function scheduleFollowUp(supabase, senderId, accountId, accessToken) {
  try {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await supabase.from('follow_ups').upsert({
      sender_id:    senderId,
      account_id:   accountId,
      access_token: accessToken,
      scheduled_at: scheduledAt,
      sent:         false
    }, { onConflict: 'sender_id' });
    console.log(`⏰ Relance programmée pour ${senderId}`);
  } catch (err) { console.error('❌ Erreur relance:', err.message); }
}

async function cancelFollowUp(supabase, senderId) {
  try {
    await supabase.from('follow_ups')
      .update({ sent: true })
      .eq('sender_id', senderId)
      .eq('sent', false);
    console.log(`✅ Relance annulée pour ${senderId}`);
  } catch (err) { console.error('❌ Erreur annulation relance:', err.message); }
}

async function processFollowUps(supabase) {
  try {
    const { data: followUps } = await supabase
      .from('follow_ups').select('*')
      .eq('sent', false)
      .lte('scheduled_at', new Date().toISOString());
    if (!followUps?.length) return;
    for (const f of followUps) {
      await replyToDM(
        f.sender_id,
        `Bonjour,\n\nJe ne sais pas si mon dernier message s'était bien envoyé, avez-vous bien reçu ma réponse ?\n\nMerci à vous ! 😊`,
        f.access_token
      );
      await supabase.from('follow_ups').update({ sent: true }).eq('id', f.id);
      console.log(`📬 Relance envoyée à ${f.sender_id}`);
    }
  } catch (err) { console.error('❌ Erreur relances:', err.message); }
}

// ─────────────────────────────────────────────
// 📤 ENVOI DES MESSAGES
// ─────────────────────────────────────────────
async function replyToComment(commentId, reply, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v19.0/${commentId}/replies`,
      { message: reply },
      { params: { access_token: accessToken } }
    );
    console.log(`✅ Réponse commentaire envoyée : "${reply}"`);
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
  generateCommentReply,
  generateHumanNeededReply,
  scheduleFollowUp,
  cancelFollowUp,
  processFollowUps,
  replyToComment,
  replyToDM
};