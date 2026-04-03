const express  = require('express');
const router   = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/aria/chat
router.post('/chat', async (req, res) => {
  const { system, messages, max_tokens } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages requis' });
  }
  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1200,
      system:     system || '',
      messages
    });
    res.json({ content: response.content });
  } catch(err) {
    console.error('❌ Erreur Aria chat:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;