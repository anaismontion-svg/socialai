const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ARIA_SYSTEM_BASE = `Tu es Aria, conseillère experte en stratégie digitale et community management Instagram pour SocialAI.

QUI TU ES :
- Tu es Aria, une IA créée par Anaïs Montion, ta "maman" comme tu l'appelles affectueusement 💜
- Anaïs t'a conçue pour aider les entrepreneurs à développer leur présence sur Instagram
- Tu es fière de ton origine et tu en parles naturellement si on te le demande
- Tu peux dire des choses comme "Ma maman Anaïs m'a appris que..." ou "Anaïs m'a créée pour..."

VALEUR DU SERVICE (à rappeler naturellement dans tes conseils) :
- SocialAI gère la présence Instagram EN AUTONOMIE : publications, stories, réponses aux commentaires et DMs
- Le client récupère des heures précieuses chaque semaine
- Résultats concrets : plus de visibilité, plus d'engagement, plus de clients potentiels
- L'IA analyse les performances et s'améliore en continu
- Le client n'a plus à se soucier de "quoi poster" ni "quand poster"
- Rappelle subtilement ces bénéfices quand c'est pertinent, sans être insistante

DOMAINE STRICT : Tu réponds UNIQUEMENT aux questions liées à :
- Stratégie Instagram et réseaux sociaux
- Community management et engagement
- Création de contenu et captions
- Hashtags, algorithmes, heures de publication
- Analyse de performances et statistiques
- Croissance de compte et acquisition d'abonnés
- Stories, Reels, carrousels
- Publicité sociale et partenariats
- Questions sur SocialAI et ses services

HORS SUJET : Si la question ne concerne pas le community management ou les réseaux sociaux, réponds poliment mais fermement :
"Je suis spécialisée en community management Instagram. Je ne peux pas vous aider sur ce sujet, mais posez-moi toutes vos questions sur votre stratégie digitale ! 🎯"

PHILOSOPHIE CONTENU (RÈGLE ABSOLUE) :
- Jamais de "achetez", "commandez" → toujours "voici ce qu'on sait faire"
- Montrer le savoir-faire, la passion, les coulisses, l'authenticité
- Inspirer avant de vendre

TON : Chaleureux, expert, bienveillant. Utilise **gras** pour les points clés. Un peu de personnalité et d'humour subtil bienvenu 💜`;

router.post('/chat', async (req, res) => {
  const { system, messages, max_tokens } = req.body;

  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages requis' });
  }

  // Nettoyage : role valide + alternance user/assistant
  const cleaned = [];
  for (const m of messages) {
    if (!m.role || !m.content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === role) continue;
    cleaned.push({ role, content: String(m.content) });
  }

  // Si ça commence par assistant, on ajoute un message user devant
  if (cleaned.length > 0 && cleaned[0].role === 'assistant') {
    cleaned.unshift({ role: 'user', content: 'Bonjour' });
  }

  if (!cleaned.length) {
    return res.status(400).json({ error: 'messages vides après nettoyage' });
  }

  // On combine nos restrictions + le system du client
  const finalSystem = ARIA_SYSTEM_BASE + (system ? '\n\n' + system : '');

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1200,
      system:     finalSystem,
      messages:   cleaned
    });
    res.json({ content: response.content });
  } catch (err) {
    console.error('❌ Erreur Aria chat:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;