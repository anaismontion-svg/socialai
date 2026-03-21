const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateReply(context, tone = 'professionnel') {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Tu es un community manager ${tone}. Réponds à ce message en 1-2 phrases maximum, de façon naturelle et engageante : "${context}"`
    }]
  });
  return message.content[0].text;
}

async function replyToComment(commentId, reply, accessToken) {
  await axios.post(
    `https://graph.instagram.com/v19.0/${commentId}/replies`,
    { message: reply },
    { params: { access_token: accessToken } }
  );
}

async function replyToDM(recipientId, reply, accessToken) {
  await axios.post(
    `https://graph.instagram.com/v19.0/me/messages`,
    {
      recipient: { id: recipientId },
      message: { text: reply }
    },
    { params: { access_token: accessToken } }
  );
}

module.exports = { generateReply, replyToComment, replyToDM };