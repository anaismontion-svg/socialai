const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function sendEmail(to, subject, html) {
  console.log(`📧 Tentative envoi email à ${to} — sujet: ${subject}`);
  try {
    const response = await axios.post(
      'https://api.resend.com/emails',
      { from: 'SocialAI <onboarding@resend.dev>', to: [to], subject, html },
      {
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json'
        },
        timeout: 10000
      }
    );
    console.log(`✅ Email envoyé à ${to} — id: ${response.data.id}`);
    return true;
  } catch (err) {
    console.error('❌ Erreur email Resend:', err.response?.data || err.message);
    return false;
  }
}

const memoryCache = {};
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getMemory(senderId, supabase = null) {
  if (memoryCache[senderId]) return memoryCache[senderId];

  if (supabase) {
    try {
      const { data } = await supabase
        .from('dm_memory')
        .select('*')
        .eq('sender_id', senderId)
        .single();

      if (data) {
        const memory = {
          firstContactAt:     data.first_contact_at,
          lastSeenAt:         data.last_seen_at,
          isFirstContact:     data.is_first_contact,
          status:             data.status || 'normal',
          reason:             data.reason,
          originalMessage:    data.original_message,
          vouvoiement:        data.vouvoiement !== false,
          firstName:          data.first_name,
          firstNameConfirmed: data.first_name_confirmed || false,
          phoneNumber:        data.phone_number,
          gatheringTurns:     data.gathering_turns || 0,
          history:            data.history || [],
          knownFacts:         data.known_facts || [],
          _supabase:          supabase,
          _senderId:          senderId
        };
        memoryCache[senderId] = memory;
        return memory;
      }
    } catch(e) {}
  }

  const memory = {
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
    gatheringTurns:     0,
    history:            [],
    knownFacts:         [],
    _supabase:          supabase,
    _senderId:          senderId
  };
  memoryCache[senderId] = memory;
  return memory;
}

async function saveMemory(memory) {
  const supabase = memory._supabase;
  const senderId = memory._senderId;
  if (!supabase || !senderId) return;

  try {
    await supabase.from('dm_memory').upsert({
      sender_id:            senderId,
      first_contact_at:     memory.firstContactAt,
      last_seen_at:         memory.lastSeenAt,
      is_first_contact:     memory.isFirstContact,
      status:               memory.status,
      reason:               memory.reason,
      original_message:     memory.originalMessage,
      vouvoiement:          memory.vouvoiement,
      first_name:           memory.firstName,
      first_name_confirmed: memory.firstNameConfirmed,
      phone_number:         memory.phoneNumber,
      gathering_turns:      memory.gatheringTurns,
      history:              memory.history.slice(-20),
      known_facts:          memory.knownFacts,
      updated_at:           new Date().toISOString()
    }, { onConflict: 'sender_id' });
  } catch(e) {
    console.error('❌ Erreur sauvegarde mémoire:', e.message);
  }
}

function getContactTiming(memory) {
  const now = new Date();
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

function extractFirstNameFromUsername(username) {
  if (!username) return null;
  const cleaned = username.replace(/[0-9._\-]/g, ' ').trim();
  const words   = cleaned.split(' ').filter(w => w.length >= 3 && w.length <= 15);
  if (words.length === 0) return null;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
}

function buildGreeting(timing, memory, senderUsername = '', senderName = '') {
  const v = memory.vouvoiement !== false;
  switch (timing) {
    case 'first': {
      let greeting = `Bonjour,`;

      if (!memory.firstName) {
        let guessedName = null;

        if (senderName) {
          const firstName = senderName.split(' ')[0];
          if (firstName && firstName.length >= 2) {
            guessedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          }
        }

        if (!guessedName) {
          guessedName = extractFirstNameFromUsername(senderUsername);
        }

        if (guessedName) {
          greeting += `\nHeureuse de ${v ? 'vous' : 'te'} rencontrer ! ${guessedName}, c'est bien ça ?`;
          memory.firstName          = guessedName;
          memory.firstNameConfirmed = false;
          memory.knownFacts.push('prenom_demande');
        }
      } else if (memory.firstName && memory.firstNameConfirmed) {
        greeting += `\nRavi${v ? '' : 'e'} de vous retrouver, ${memory.firstName} !`;
      }

      return greeting + '\n\n';
    }
    case 'returning_long':
      return memory.firstName && memory.firstNameConfirmed
        ? `Et bonjour ${memory.firstName} ! Comment ${v ? 'allez-vous' : 'vas-tu'} ?\n\n`
        : `Et bonjour ! Comment ${v ? 'allez-vous' : 'vas-tu'} ?\n\n`;
    case 'returning_short':
      return memory.firstName && memory.firstNameConfirmed
        ? `Re-bonjour ${memory.firstName} !\n\n`
        : 'Re-bonjour !\n\n';
    default:
      return '';
  }
}

async function sendEmailSummary(senderInfo, reason, coordinates, clientEmail) {
  const reasonLabels = {
    'partenariat':             '🤝 Demande de partenariat',
    'opportunite_commerciale': '💼 Opportunité commerciale',
    'question_personnelle':    '👤 Message personnel',
    'plainte_grave':           '⚠️ Réclamation grave',
    'liste_attente':           "🐱 Inscription liste d'attente",
    'adoption':                "🐱 Demande d'adoption",
    'hors_sujet':              '❓ Demande hors sujet'
  };
  const dest    = clientEmail || process.env.GMAIL_USER;
  const subject = `[SocialAI] ${reasonLabels[reason] || 'Nouvelle demande'} — @${senderInfo.accountName || 'instagram'}`;

  const html = `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#0d0d14;color:#f5f4f0;border-radius:12px;padding:28px">
    <div style="font-size:20px;font-weight:700;margin-bottom:20px">📩 Nouveau contact Instagram</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="color:#7a7870;font-size:11px;text-transform:uppercase;padding:6px 0;width:120px">Type</td>
          <td style="color:#f5f4f0;font-weight:600">${reasonLabels[reason]||reason}</td></tr>
      <tr><td style="color:#7a7870;font-size:11px;text-transform:uppercase;padding:6px 0">Prénom</td>
          <td style="color:#f5f4f0">${senderInfo.firstName||'Non renseigné'}</td></tr>
      <tr><td style="color:#7a7870;font-size:11px;text-transform:uppercase;padding:6px 0">Compte</td>
          <td style="color:#f5f4f0">@${senderInfo.accountName||'—'}</td></tr>
    </table>
    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:16px;margin-bottom:12px">
      <div style="font-size:11px;color:#7a7870;text-transform:uppercase;margin-bottom:8px">📞 Coordonnées reçues</div>
      <div style="color:#f5f4f0;font-size:16px;font-weight:700">${coordinates}</div>
    </div>
    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:16px;margin-bottom:12px">
      <div style="font-size:11px;color:#7a7870;text-transform:uppercase;margin-bottom:8px">💬 Message original</div>
      <div style="color:#c8c6be">${senderInfo.originalMessage||'—'}</div>
    </div>
    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:11px;color:#7a7870;text-transform:uppercase;margin-bottom:8px">🗂 Historique échanges</div>
      <div style="color:#c8c6be;font-size:12px;white-space:pre-line;line-height:1.6">${senderInfo.conversationHistory||'—'}</div>
    </div>
    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:16px">
      <div style="font-size:11px;color:#7a7870;text-transform:uppercase;margin-bottom:8px">🧠 Infos collectées</div>
      <div style="color:#c8c6be;font-size:12px">${senderInfo.knownFacts?.join('<br>') || '—'}</div>
    </div>
    <p style="color:#7a7870;font-size:11px;margin-top:20px;text-align:center">Envoyé automatiquement par SocialAI · ${new Date().toLocaleString('fr-FR')}</p>
  </div>`;

  return await sendEmail(dest, subject, html);
}

async function classifyMessage(text) {
  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 100,
    system: `Tu es un classificateur de messages Instagram. Réponds UNIQUEMENT avec un JSON sur une seule ligne, sans markdown.
Catégories : "renseignement","compliment","adoption","liste_attente","partenariat","opportunite_commerciale","question_personnelle","plainte_grave","hors_sujet","autre"
Format : {"categorie":"...","besoin_humain":true/false}
besoin_humain=true pour : partenariat, opportunite_commerciale, question_personnelle, plainte_grave, liste_attente, adoption`,
    messages: [{ role:'user', content:`Classifie : "${text}"` }]
  });
  try {
    return JSON.parse(message.content[0].text.trim());
  } catch {
    return { categorie:'autre', besoin_humain:false };
  }
}

async function generateCommentReply(commentText, accountName = '', accountDescription = '') {
  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  80,
    temperature: 1,
    system: `Tu gères le compte Instagram @${accountName}.
Contexte : ${accountDescription || 'Compte Instagram professionnel'}
Réponds à ce commentaire : court, humain, sincère.
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

function detectAdoptionInterest(text) {
  return /\b(adopt|chaton|chatons|ragdoll|disponible|disponibles|liste|attente|réserver|réservation|prix|tarif|combien|acheter|acquérir|bébé|portée)\b/i.test(text);
}

async function generateReply(
  messageText,
  accountName        = '',
  senderId           = '',
  accessToken        = '',
  accountDescription = '',
  senderUsername     = '',
  isSoloEntrepreneur = true,
  clientEmail        = null,
  supabase           = null,
  senderName         = ''
) {
  const memory = await getMemory(senderId, supabase);

  if (senderName && !memory.firstName) {
    const firstName = senderName.split(' ')[0];
    if (firstName && firstName.length >= 2) {
      memory.firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      memory.firstNameConfirmed = true;
      memory.knownFacts.push(`prénom_réel:${memory.firstName}`);
    }
  }

  if (/\b(tu|toi|ton|ta|tes|t'|t'as|t'es|vas-y|fais)\b/i.test(messageText))
    memory.vouvoiement = false;

  if (memory.firstName && !memory.firstNameConfirmed) {
    if (/\b(oui|c'est ça|exact|tout à fait|effectivement|bien sûr|yes)\b/i.test(messageText)) {
      memory.firstNameConfirmed = true;
      memory.knownFacts.push(`prénom:${memory.firstName}`);
    }
  }

  const phoneMatch = messageText.match(/(?:(?:\+|00)33|0)[1-9](?:[.\-\s]?\d{2}){4}/);
  if (phoneMatch && !memory.phoneNumber) {
    memory.phoneNumber = phoneMatch[0];
    memory.knownFacts.push(`téléphone:${phoneMatch[0]}`);
  }

  if (memory.status === 'waiting_coordinates') {
    memory.status = 'coordinates_received';
    const historyText = memory.history
      .map(m => `${m.role === 'user' ? 'Contact' : 'Aria'}: ${m.content}`)
      .join('\n');
    await sendEmailSummary(
      { senderId, firstName:memory.firstName, originalMessage:memory.originalMessage, accountName, conversationHistory:historyText, knownFacts:memory.knownFacts },
      memory.reason, messageText, clientEmail
    );
    const v   = memory.vouvoiement !== false;
    const rep = `Merci beaucoup ! 😊\n\nJe ${v ? 'vous' : 'te'} recontacte très prochainement.\n\nÀ très vite ! ✨`;
    memory.history.push({ role:'user', content:messageText });
    memory.history.push({ role:'assistant', content:rep });
    await saveMemory(memory);
    await delay(20000 + Math.random() * 10000);
    return rep;
  }

  if (memory.status === 'coordinates_received') {
    return null;
  }

  if (memory.status === 'gathering_info') {
    memory.gatheringTurns++;
    memory.history.push({ role:'user', content:messageText });

    if (memory.gatheringTurns >= 2) {
      memory.status = 'waiting_coordinates';
      const v = memory.vouvoiement !== false;
      const rep = v
        ? `Pour qu'on puisse en discuter directement, pourriez-vous m'envoyer votre numéro de téléphone ? Je reviendrai vers vous au plus vite 😊`
        : `Pour qu'on puisse en discuter directement, pourrais-tu m'envoyer ton numéro ? Je reviendrai vers toi au plus vite 😊`;
      memory.history.push({ role:'assistant', content:rep });
      await saveMemory(memory);
      await delay(20000 + Math.random() * 10000);
      return rep;
    }

    const rep = await generateGatheringReply(memory, messageText, accountName, accountDescription, isSoloEntrepreneur);
    await saveMemory(memory);
    return rep;
  }

  const timing   = getContactTiming(memory);
  const greeting = buildGreeting(timing, memory, senderUsername, senderName);
  const v        = memory.vouvoiement !== false;

  const knownInfo = [];
  if (memory.firstName && memory.firstNameConfirmed) knownInfo.push(`Prénom confirmé : ${memory.firstName}`);
  if (memory.phoneNumber) knownInfo.push(`Téléphone : ${memory.phoneNumber}`);
  const knownInfoText = knownInfo.length ? `\nINFOS DÉJÀ CONNUES :\n${knownInfo.join('\n')}\n` : '';

  const adoptionInterest = detectAdoptionInterest(messageText);

  const systemPrompt = `Tu ES ${accountName}, tu gères ce compte Instagram en ton nom propre.
Tu es une personne réelle — jamais un robot, jamais une assistante.
${isSoloEntrepreneur ? `Tu parles en ton nom : "je", jamais "notre équipe".` : ''}
Contexte de ton activité : ${accountDescription || 'Compte Instagram professionnel'}
${knownInfoText}

TON COMPORTEMENT :
- Tu réponds UNIQUEMENT à ce qui est demandé. Pas plus.
- Tu es naturelle, chaleureuse, authentique — comme si tu tapais depuis ton téléphone.
- Tu ne poses JAMAIS de question en retour.
- Tu n'es JAMAIS dans la vente ou la promotion.
- ${v ? 'Vouvoiement' : 'Tutoiement'}
- 1 emoji max, ton décontracté et humain.
- Réponse courte et directe.
- Ne redemande JAMAIS une info déjà donnée.
${adoptionInterest ? `
IMPORTANT : Cette personne semble intéressée par une adoption. À la fin de ta réponse, propose-lui naturellement d'échanger directement — dis-lui qu'elle peut t'envoyer son numéro pour qu'on puisse en parler de vive voix. Formule-le très naturellement, sans pression.` : ''}
IMPORTANT : Ne commence JAMAIS par une salutation — déjà gérée séparément.`;

  const msgs = [...memory.history.slice(-10), { role:'user', content:messageText }];
  const response = await anthropic.messages.create({
    model:'claude-sonnet-4-20250514', max_tokens:300, temperature:0.8,
    system:systemPrompt, messages:msgs
  });

  const body = response.content[0].text;
  memory.history.push({ role:'user', content:messageText });
  memory.history.push({ role:'assistant', content:body });

  if (adoptionInterest && memory.status === 'normal') {
    memory.status          = 'waiting_coordinates';
    memory.reason          = 'adoption';
    memory.originalMessage = messageText;
  }

  await saveMemory(memory);

  const isLongMessage = body.split('\n').length > 5 || body.length > 300;
  await delay(isLongMessage ? 45000 : 20000 + Math.random() * 10000);
  return greeting + body;
}

async function generateGatheringReply(memory, messageText, accountName, accountDescription, isSoloEntrepreneur) {
  const v = memory.vouvoiement !== false;
  const reason = memory.reason;

  const questionsByReason = {
    partenariat: [
      `Pourriez-${v ? 'vous' : 'tu'} me parler un peu plus de ${v ? 'votre' : 'ton'} concept ?`,
      `Et ${v ? 'votre' : 'ton'} audience, elle ressemble à quoi ?`
    ],
    adoption: [
      `${v ? 'Vous cherchez' : 'Tu cherches'} un chaton pour quelle période environ ?`,
      `${v ? 'Vous avez' : 'As-tu'} déjà eu des Ragdoll ou ce serait une première ?`
    ],
    liste_attente: [
      `${v ? 'Vous souhaitez' : 'Tu souhaites'} un chaton pour quelle période environ ?`,
      `${v ? 'Vous avez' : 'As-tu'} déjà eu des chats Ragdoll ou ce serait une première ?`
    ],
    opportunite_commerciale: [
      `Pourriez-${v ? 'vous' : 'tu'} me parler un peu plus de ${v ? 'votre' : 'ton'} projet ?`,
      `C'est pour quel type de prestation exactement ?`
    ],
    default: [
      `${v ? 'Vous pouvez' : 'Tu peux'} m'en dire plus ?`,
      `De quel projet s'agit-il exactement ?`
    ]
  };

  const questions = questionsByReason[reason] || questionsByReason.default;
  const question  = questions[memory.gatheringTurns % questions.length];

  const systemPrompt = `Tu ES ${accountName}, tu parles en ton nom propre sur Instagram.
${isSoloEntrepreneur ? 'Utilise "je", jamais "notre équipe".' : ''}
Contexte : ${accountDescription || 'Compte professionnel'}

Réponds naturellement au message, puis pose cette question de façon très fluide et humaine :
"${question}"

RÈGLES :
- ${v ? 'Vouvoiement' : 'Tutoiement'}
- Court et naturel (2-3 phrases max)
- 1 emoji max
- Ne demande PAS le téléphone — pas encore
- Tu es une personne réelle, pas un robot
IMPORTANT : Ne commence pas par une salutation.`;

  const response = await anthropic.messages.create({
    model:       'claude-sonnet-4-20250514',
    max_tokens:  200,
    temperature: 0.85,
    system:      systemPrompt,
    messages:    [...memory.history.slice(-8), { role:'user', content:messageText }]
  });

  const body = response.content[0].text;
  memory.history.push({ role:'assistant', content:body });

  const isLongMessage = body.split('\n').length > 5 || body.length > 300;
  await delay(isLongMessage ? 45000 : 20000 + Math.random() * 10000);
  return body;
}

async function generateHumanNeededReply(
  accountName        = '',
  accessToken        = '',
  senderId           = '',
  reason             = '',
  originalMessage    = '',
  senderUsername     = '',
  isSoloEntrepreneur = true,
  supabase           = null,
  senderName         = ''
) {
  const memory = await getMemory(senderId, supabase);
  if (/\b(tu|toi|ton|ta|tes|t'|t'as|t'es)\b/i.test(originalMessage))
    memory.vouvoiement = false;

  memory.status          = 'gathering_info';
  memory.reason          = reason;
  memory.originalMessage = originalMessage;
  memory.gatheringTurns  = 0;

  const timing   = getContactTiming(memory);
  const greeting = buildGreeting(timing, memory, senderUsername, senderName);
  const v        = memory.vouvoiement !== false;

  await delay(20000 + Math.random() * 10000);

  const firstQuestionByReason = {
    partenariat:             `Super, j'adore les projets de collaboration ! ✨\n\nQuel type de partenariat ${v?'avez-vous':'as-tu'} en tête ?`,
    adoption:                `Oh, ${v?'vous êtes':'tu es'} intéressé${v?'':'(e)'} par un de nos chatons ? 🐱\n\n${v?'Vous cherchez':'Tu cherches'} pour quelle période environ ?`,
    liste_attente:           `Avec plaisir ! 🐱\n\n${v?'Vous souhaitez':'Tu souhaites'} un chaton pour quelle période ?`,
    opportunite_commerciale: `Merci pour ce message ! ✨\n\n${v?'Vous pouvez':'Tu peux'} m'en dire plus sur ${v?'votre':'ton'} projet ?`,
    question_personnelle:    `Bien sûr, je suis là 😊\n\nDe quoi s'agit-il ?`,
    plainte_grave:           `Je suis vraiment désolée d'entendre ça 😔\n\n${v?'Vous pouvez':'Tu peux'} me donner plus de détails ?`,
    default:                 `Avec plaisir ! ✨\n\n${v?'Vous pouvez':'Tu peux'} m'en dire plus ?`
  };

  const firstQuestion = firstQuestionByReason[reason] || firstQuestionByReason.default;
  const reponse = `${greeting}${firstQuestion}`;

  memory.history.push({ role:'user',      content:originalMessage });
  memory.history.push({ role:'assistant', content:reponse });
  await saveMemory(memory);
  return reponse;
}

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

async function replyToComment(commentId, reply, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.instagram.com/v19.0/${commentId}/replies`,
      { message: reply },
      { params: { access_token: accessToken } }
    );
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
  replyToDM,
  getMemory
};