const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// 📧 ENVOI EMAIL VIA RESEND
// ─────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SocialAI <onboarding@resend.dev>',
        to:   [to],
        subject,
        html
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Erreur Resend');
    console.log(`📧 Email envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur email Resend:', err.message);
  }
}

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
// 👋 SALUTATION DM — UNE SEULE FOIS, SANS RÉPÉTITION
// ─────────────────────────────────────────────
function buildGreeting(timing, memory, senderUsername = '') {
  const v = memory.vouvoiement !== false;
  switch (timing) {
    case 'first': {
      // Salutation neutre SANS "Merci pour votre message"
      // car le corps du message ne doit pas le répéter
      let greeting = `Bonjour,`;
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
    case 'returning_short': return 'Re-bonjour !\n\n';
    default:                return '';
  }
}

// ─────────────────────────────────────────────
// 📧 ENVOI EMAIL RÉSUMÉ CONTACT
// ─────────────────────────────────────────────
async function sendEmailSummary(senderInfo, reason, coordinates, clientEmail) {
  const reasonLabels = {
    'partenariat':             '🤝 Demande de partenariat',
    'opportunite_commerciale': '💼 Opportunité commerciale',
    'question_personnelle':    '👤 Message personnel',
    'plainte_grave':           '⚠️ Réclamation grave',
    'liste_attente':           "🐱 Inscription liste d'attente",
    'hors_sujet':              '❓ Demande hors sujet'
  };
  const dest    = clientEmail || process.env.GMAIL_USER;
  const subject = `[SocialAI] ${reasonLabels[reason] || 'Nouvelle demande'} — @${senderInfo.accountName || 'instagram'}`;
  const html    = `
    <div style="font-family:sans-serif;max-width:500px;padding:24px;background:#0d0d14;color:#f5f4f0;border-radius:12px">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px">📩 Nouvelle demande Instagram</div>
      <p style="color:#c8c6be">Type : <strong style="color:#f5f4f0">${reasonLabels[reason]||reason}</strong></p>
      <p style="color:#c8c6be">Prénom : <strong style="color:#f5f4f0">${senderInfo.firstName||'Non renseigné'}</strong></p>
      <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin:12px 0">
        <div style="font-size:11px;color:#7a7870;margin-bottom:6px;text-transform:uppercase">Coordonnées reçues</div>
        <div style="color:#f5f4f0;font-size:15px;font-weight:600">${coordinates}</div>
      </div>
      <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin:12px 0">
        <div style="font-size:11px;color:#7a7870;margin-bottom:6px;text-transform:uppercase">Message original</div>
        <div style="color:#c8c6be">${senderInfo.originalMessage||'—'}</div>
      </div>
      <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px">
        <div style="font-size:11px;color:#7a7870;margin-bottom:6px;text-transform:uppercase">Historique</div>
        <div style="color:#c8c6be;font-size:12px;white-space:pre-line">${senderInfo.conversationHistory||'—'}</div>
      </div>
      <p style="color:#7a7870;font-size:11px;margin-top:16px">Envoyé automatiquement par SocialAI</p>
    </div>`;
  await sendEmail(dest, subject, html);
}

// ─────────────────────────────────────────────
// 🔍 CLASSIFICATION MESSAGE
// ─────────────────────────────────────────────
async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown.
Catégories : "renseignement","compliment","liste_attente","partenariat","opportunite_commerciale","question_personnelle","plainte_grave","hors_sujet","autre"
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
// 💬 RÉPONSE COMMENTAIRES
// ─────────────────────────────────────────────
async function generateCommentReply(commentText, accountName = '', accountDescription = '') {
  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  80,
    temperature: 1,
    system: `Tu gères le compte Instagram @${accountName}.
Contexte : ${accountDescription || 'Compte Instagram professionnel'}
Réponds à ce commentaire Instagram : court, humain, sincère.
RÈGLES :
- Maximum 1 phrase (10 mots max)
- Positif, chaleureux, émotionnel
- 1 emoji maximum
- Ne commence JAMAIS par "Merci pour votre commentaire"
- Varie les formulations
Retourne UNIQUEMENT la réponse.`,
    messages: [{ role:'user', content:`Commentaire : "${commentText}"` }]
  });
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

  if (/\b(tu|toi|ton|ta|tes|t'|t'as|t'es|vas-y|fais)\b/i.test(messageText))
    memory.vouvoiement = false;

  if (memory.firstName && !memory.firstNameConfirmed) {
    if (/\b(oui|c'est ça|exact|tout à fait|effectivement|bien sûr|yes)\b/i.test(messageText)) {
      memory.firstNameConfirmed = true;
      memory.knownFacts.push(`prenom_confirme:${memory.firstName}`);
    }
  }

  const phoneMatch = messageText.match(/(?:(?:\+|00)33|0)[1-9](?:[.\-\s]?\d{2}){4}/);
  if (phoneMatch && !memory.phoneNumber) {
    memory.phoneNumber = phoneMatch[0];
    memory.knownFacts.push(`telephone:${phoneMatch[0]}`);
  }

  if (memory.status === 'waiting_coordinates') {
    memory.status = 'coordinates_received';
    const historyText = memory.history
      .map(m => `${m.role === 'user' ? 'Contact' : 'Aria'}: ${m.content}`)
      .join('\n');
    await sendEmailSummary(
      { senderId, firstName: memory.firstName, originalMessage: memory.originalMessage, accountName, conversationHistory: historyText },
      memory.reason, messageText, clientEmail
    );
    const v   = memory.vouvoiement !== false;
    const rep = isSoloEntrepreneur
      ? `Merci beaucoup ! 😊\n\nJe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`
      : `Merci beaucoup ! 😊\n\nNotre équipe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`;
    memory.history.push({ role:'user', content:messageText });
    memory.history.push({ role:'assistant', content:rep });
    await delay(2000);
    return rep;
  }

  if (memory.status === 'coordinates_received') return null;

  const timing   = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v        = memory.vouvoiement !== false;

  const knownInfo = [];
  if (memory.firstName && memory.firstNameConfirmed) knownInfo.push(`Prénom confirmé : ${memory.firstName}`);
  if (memory.phoneNumber) knownInfo.push(`Téléphone déjà donné : ${memory.phoneNumber}`);
  const knownInfoText = knownInfo.length ? `\nINFOS DÉJÀ CONNUES :\n${knownInfo.join('\n')}\n` : '';

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.
${isSoloEntrepreneur
  ? 'Entreprise individuelle. Ne dis JAMAIS "notre équipe" — toujours "je".'
  : 'Cette entreprise a une équipe.'}
Contexte : ${accountDescription || 'Compte Instagram professionnel'}
${knownInfoText}
RÈGLES CONTENU :
- Ce compte parle EXCLUSIVEMENT de chats Ragdoll.
- Ne transmets JAMAIS d'infos sur d'autres clients.
RÈGLES MÉMOIRE :
- Ne redemande JAMAIS une info déjà donnée.
- Utilise le prénom naturellement s'il est confirmé.
RÈGLES COORDONNÉES :
- Ne demande PAS le téléphone dès le 1er message.
- D'abord échanger, comprendre le projet.
- Quand c'est le bon moment : "Pourriez-${v?'vous':'tu'} m'envoyer ${v?'votre':'ton'} numéro ? Ce sera plus simple de vive voix !"
COMMUNICATION :
- ${v ? 'Vouvoiement' : 'Tutoiement'}
- Ton chaleureux, humain, naturel
- 2-3 émojis max
- Varie TOUJOURS les formulations
IMPORTANT : Ne commence JAMAIS par une salutation ni par "Merci pour votre message" — déjà géré automatiquement.`;

  const recentHistory = memory.history.slice(-10);
  recentHistory.push({ role:'user', content:messageText });

  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  350,
    temperature: 1,
    system:      systemPrompt,
    messages:    recentHistory
  });

  const body = response.content[0].text;
  memory.history.push({ role:'user', content:messageText });
  memory.history.push({ role:'assistant', content:body });

  await delay(body.length > 200 ? 3000 : Math.random() > 0.5 ? 2000 : 1000);
  return greeting + body;
}

// ─────────────────────────────────────────────
// 🙋 RÉPONSE INTERVENTION HUMAINE
// FIX : greeting + corps sans répétition
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
  if (/\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i.test(originalMessage))
    memory.vouvoiement = false;

  memory.status          = 'waiting_coordinates';
  memory.reason          = reason;
  memory.originalMessage = originalMessage;

  const timing   = getContactTiming(senderId);
  const greeting = buildGreeting(timing, memory, senderUsername);
  const v        = memory.vouvoiement !== false;

  await delay(2000);

  // ✅ FIX : PLUS de "Merci pour votre message" dans le corps
  // buildGreeting() gère déjà la salutation
  const phoneRequest = v
    ? `Pourriez-vous m'envoyer votre numéro de téléphone ? Ce sera plus simple d'échanger de vive voix ! 😊`
    : `Pourrais-tu m'envoyer ton numéro de téléphone ? Ce sera plus simple de vive voix ! 😊`;

  const suite = isSoloEntrepreneur
    ? `Je reviendrai vers ${v ? 'vous' : 'toi'} au plus vite.`
    : `Notre équipe reviendra vers ${v ? 'vous' : 'toi'} au plus vite.`;

  // greeting = "Bonjour,\n\n" — corps commence directement par la demande de téléphone
  const reponse = `${greeting}${phoneRequest}\n\n${suite}`;

  memory.history.push({ role:'user', content:originalMessage });
  memory.history.push({ role:'assistant', content:reponse });
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
    }, { onConflict:'sender_id' });
    console.log(`⏰ Relance programmée pour ${senderId}`);
  } catch (err) { console.error('❌ Relance:', err.message); }
}

async function cancelFollowUp(supabase, senderId) {
  try {
    await supabase.from('follow_ups')
      .update({ sent:true })
      .eq('sender_id', senderId)
      .eq('sent', false);
  } catch (err) { console.error('❌ Annulation relance:', err.message); }
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
        `Bonjour,\n\nJe voulais m'assurer que mon message vous était bien parvenu.\n\nÀ très vite ! 😊`,
        f.access_token
      );
      await supabase.from('follow_ups').update({ sent:true }).eq('id', f.id);
    }
  } catch (err) { console.error('❌ Relances:', err.message); }
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
    console.log(`✅ Commentaire : "${reply}"`);
    return response.data;
  } catch (error) {
    console.error(`❌ Commentaire ${commentId}:`, error.response?.data || error.message);
    throw error;
  }
}

async function replyToDM(recipientId, reply, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v19.0/me/messages`,
      { recipient:{ id:recipientId }, message:{ text:reply } },
      { params:{ access_token:accessToken } }
    );
    console.log(`✅ DM envoyé à ${recipientId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ DM ${recipientId}:`, error.response?.data || error.message);
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