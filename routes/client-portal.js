// routes/client-portal.js
// Espace client — endpoints pour consulter/modifier ses posts

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GET /api/portal/:clientId/posts ──────────────────────────────────────────
// Récupère tous les posts planifiés du client
router.get('/:clientId/posts', async (req, res) => {
  const { clientId } = req.params;
  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .eq('client_id', clientId)
    .in('statut', ['planifie', 'en_attente_validation'])
    .order('scheduled_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/portal/:clientId/info ───────────────────────────────────────────
// Infos du client
router.get('/:clientId/info', async (req, res) => {
  const { clientId } = req.params;
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PATCH /api/portal/posts/:postId/caption ──────────────────────────────────
// Le client modifie la caption d'un post
router.patch('/posts/:postId/caption', async (req, res) => {
  const { postId } = req.params;
  const { caption } = req.body;
  const { data, error } = await supabase
    .from('queue')
    .update({ caption, modified_by_client: true })
    .eq('id', postId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, post: data });
});

// ── POST /api/portal/:clientId/special-post ──────────────────────────────────
// Le client demande un post spécial (événement, annonce...)
router.post('/:clientId/special-post', async (req, res) => {
  const { clientId } = req.params;
  const { message, scheduled_at, media_url, let_ai_decide } = req.body;

  try {
    // Récupérer les infos du client
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) return res.status(404).json({ error: 'Client introuvable' });

    let caption = message;

    // Si le client laisse l'IA décider, générer une caption
    if (let_ai_decide && message) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Tu es un expert community manager Instagram.

Client : ${client.name}
Secteur : ${client.sector || 'non précisé'}
Description : ${client.description || ''}
Ton : ${client.tone || 'professionnel et chaleureux'}

Le client souhaite publier un post spécial avec ce message/contexte :
"${message}"

Génère une caption Instagram engageante et virale pour ce post.
- Accroche forte en première ligne
- Ton adapté au client
- Call-to-action pertinent
- Hashtags optimisés (10-15 max)
- Maximum 150 mots

Retourne uniquement la caption, rien d'autre.`
        }]
      });
      caption = response.content[0].text;
    }

    // Planifier le post dans la queue
    const scheduledDate = scheduled_at
      ? new Date(scheduled_at)
      : new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h par défaut

    const { data: post, error } = await supabase
      .from('queue')
      .insert({
        client_id: clientId,
        caption,
        media_url: media_url || null,
        scheduled_at: scheduledDate.toISOString(),
        type: 'post',
        platform: 'instagram',
        statut: 'planifie',
        special_request: true,
        special_message: message
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notifier par email
    await notifySpecialPost(client, message, scheduledDate, caption);

    res.json({ success: true, post });
  } catch (err) {
    console.error('❌ Erreur post spécial:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function notifySpecialPost(client, message, scheduledAt, caption) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: client.email || process.env.GMAIL_USER,
      subject: `[SocialAI] Post spécial demandé — ${client.name}`,
      text: `
Le client ${client.name} a demandé un post spécial.

Message original : ${message}
Planifié le : ${scheduledAt.toLocaleString('fr-FR')}

Caption générée :
${caption}

Connectez-vous au back office pour modifier si nécessaire.
      `.trim()
    });
  } catch (err) {
    console.error('❌ Email notification:', err.message);
  }
}

module.exports = router;