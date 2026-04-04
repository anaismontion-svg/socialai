const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/aria/chat
router.post('/chat', async (req, res) => {
  const { system, messages, max_tokens } = req.body;

  // DEBUG
  console.log('📨 Messages reçus:', JSON.stringify(messages, null, 2));
  console.log('🧹 Nombre de messages:', messages?.length);

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages requis' });
  }

  // Nettoyage : on garde uniquement role + content, et on alterne bien user/assistant
  const cleaned = [];
  for (const m of messages) {
    if (!m.role || !m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    // Évite deux messages du même rôle à la suite
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === role) continue;
    cleaned.push({ role, content: String(m.content) });
  }

  // Doit commencer par "user"
  if (!cleaned.length || cleaned[0].role !== 'user') {
    return res.status(400).json({ error: 'Le premier message doit être de type user' });
  }

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1200,
      system:     system || '',
      messages:   cleaned
    });
    res.json({ content: response.content });
  } catch (err) {
    console.error('❌ Erreur Aria chat:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;