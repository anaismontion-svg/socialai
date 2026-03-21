const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const nodemailer = require('nodemailer');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversationMemory = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getMemory(senderId) {
  if (!conversationMemory[senderId]) {
    conversationMemory[senderId] = {
      lastSeen: new Date(),
      isFirstContact: true,
      status: 'normal',
      reason: null,
      originalMessage: null
    };
  }
  return conversationMemory[senderId];
}

function isNewDayOrFirstContact(senderId) {
  const now = new Date();
  const memory = getMemory(senderId);
  const isFirst = memory.isFirstContact;

  if (isFirst) {
    memory.isFirstContact = false;
    memory.lastSeen = now;
    return { isFirst: true, isNewDay: false };
  }

  const lastSeen = new Date(memory.lastSeen);
  const isNewDay =
    lastSeen.getDate() !== now.getDate() ||
    lastSeen.getMonth() !== now.getMonth() ||
    lastSeen.getFullYear() !== now.getFullYear();

  memory.lastSeen = now;
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

async function generateReply(context, accountName = '', senderId = '', accessToken = '', accountDescription = '') {
  const memory = getMemory(senderId);
  const { isFirst, isNewDay } = isNewDayOrFirstContact(senderId);

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

  let greeting = '';
  if (isFirst) {
    greeting = Math.random() > 0.5
      ? 'Bonjour, enchantée, merci pour votre intérêt ! 😊\n\n'
      : 'Bonjour, merci beaucoup pour votre message ! 😊\n\n';
  } else if (isNewDay) {
    greeting = 'Bonjour, ravie de vous retrouver ! 😊\n\n';
  }

  const systemPrompt = `Tu es la community manager du compte Instagram @${accountName}.

Contexte sur ce compte :
${accountDescription}

Règles de communication :
- Tu vouvoies TOUJOURS les personnes par défaut
- Si la personne te tutoie, tu peux adopter le tutoiement naturellement
- Ton ton est chaleureux, humain et naturel — jamais robotique ni trop formel
- Tu utilises des émojis avec subtilité (2-3 max par message)
- Tu aères toujours tes messages avec des sauts de ligne entre les idées
- Maximum 2 phrases par bloc, puis saut de ligne
- Tes réponses sont variées, jamais copiées-collées
- Tu parles des Ragdolls avec passion et expertise
- Tu ne "vends" pas un chaton — tu accompagnes les familles dans leur projet d'adoption
- Tu réponds UNIQUEMENT à ce qui est demandé, de façon détaillée et précise
- Tu ne donnes JAMAIS d'informations supplémentaires non demandées
- Tu ne redirige pas vers le site ou d'autres sujets sauf si c'est directement lié à la question
- Si la personne veut en savoir plus, elle posera d'autres questions

Règles absolues :
- Ne commence JAMAIS par une salutation — elle est déjà ajoutée automatiquement
- Ne sois JAMAIS générique
- Varie toujours tes formulations d'entrée en matière`;

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

async function generateHumanNeededReply(accountName = '', accessToken = '', senderId = '', reason = '', originalMessage = '') {
  const memory = getMemory(senderId);
  const { isFirst, isNewDay } = isNewDayOrFirstContact(senderId);

  memory.status = 'waiting_coordinates';
  memory.reason = reason;
  memory.originalMessage = originalMessage;

  let greeting = '';
  if (isFirst) {
    greeting = Math.random() > 0.5
      ? 'Bonjour, enchantée, merci pour votre intérêt ! 😊\n\n'
      : 'Bonjour, merci beaucoup pour votre message ! 😊\n\n';
  } else if (isNewDay) {
    greeting = 'Bonjour, ravie de vous retrouver ! 😊\n\n';
  }

  await delay(2000);

  return `${greeting}Merci pour votre message ! ✨\n\nPourriez-vous me donner votre nom et numéro de téléphone ?\n\nJe vais transmettre votre demande directement pour que l'on revienne vers vous au plus vite 😊`;
}

async function scheduleFollowUp(supabase, senderId, accountId, accessToken) {
  try {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // J+1
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

      await supabase.from('follow_ups')
        .update({ sent: true })
        .eq('id', followUp.id);

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