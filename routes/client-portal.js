// routes/client-portal.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const { requireAuth } = require('./auth-portal');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// DÉFINITION DES LIMITES PAR FORFAIT
// ─────────────────────────────────────────────
const PLANS = {
  starter: {
    postsVisibles:    1,      // nb de posts visibles dans l'espace client
    postsSpeciauxMax: 1,      // par semaine
    recyclage:        false,
    reponseDM:        false,
    reponseCommentaires: false,
  },
  pro: {
    postsVisibles:    999,    // tous les posts
    postsSpeciauxMax: 999,    // illimité
    recyclage:        true,
    reponseDM:        true,
    reponseCommentaires: true,
  }
};

function getPlan(client) {
  return PLANS[(client.plan || 'starter').toLowerCase()] || PLANS.starter;
}

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/info
// Infos du client (sans données sensibles)
// ─────────────────────────────────────────────
router.get('/:clientId/info', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, sector, instagram, description, tone, solo_entrepreneur, plan, status')
    .eq('id', clientId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/posts
// Posts planifiés — limités selon le forfait
// ─────────────────────────────────────────────
router.get('/:clientId/posts', requireAuth, async (req, res) => {
  const { clientId } = req.params;

  // Récupérer le plan du client
  const { data: client } = await supabase
    .from('clients')
    .select('plan, status')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client introuvable' });

  // Si service en pause
  if (client.status === 'paused') {
    return res.status(403).json({
      error: 'service_paused',
      message: 'Votre service est actuellement suspendu. Contactez votre community manager.'
    });
  }

  const plan = getPlan(client);

  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .eq('client_id', clientId)
    .in('statut', ['planifie', 'en_attente_validation'])
    .order('scheduled_at', { ascending: true })
    .limit(plan.postsVisibles === 999 ? 100 : plan.postsVisibles + 10); // +10 pour inclure les stories

  if (error) return res.status(500).json({ error: error.message });

  // Pour STARTER : ne retourner que le prochain post (hors stories)
  let posts = data || [];
  if (plan.postsVisibles === 1) {
    const nextPost = posts.find(p => p.type !== 'story');
    posts = nextPost ? [nextPost] : [];
  } else {
    posts = posts.filter(p => p.type !== 'story');
  }

  // Ajouter les infos du forfait dans la réponse
  res.json({
    posts,
    plan: (client.plan || 'starter').toLowerCase(),
    planLimits: plan
  });
});

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/special-count
// Nombre de posts spéciaux utilisés cette semaine
// ─────────────────────────────────────────────
router.get('/:clientId/special-count', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data } = await supabase
    .from('queue')
    .select('id')
    .eq('client_id', clientId)
    .eq('special_request', true)
    .gte('created_at', oneWeekAgo.toISOString());

  const { data: client } = await supabase
    .from('clients')
    .select('plan')
    .eq('id', clientId)
    .single();

  const plan = getPlan(client || {});
  const used = data?.length || 0;

  res.json({
    used,
    max: plan.postsSpeciauxMax,
    remaining: Math.max(0, plan.postsSpeciauxMax - used),
    unlimited: plan.postsSpeciauxMax >= 999
  });
});

// ─────────────────────────────────────────────
// PATCH /api/portal/posts/:postId/caption
// Modifier la caption d'un post
// ─────────────────────────────────────────────
router.patch('/posts/:postId/caption', requireAuth, async (req, res) => {
  const { postId } = req.params;
  const { caption } = req.body;

  if (!caption || !caption.trim()) {
    return res.status(400).json({ error: 'La caption ne peut pas être vide' });
  }

  // Vérifier que ce post appartient bien au client authentifié
  const { data: post } = await supabase
    .from('queue')
    .select('client_id')
    .eq('id', postId)
    .single();

  if (!post || post.client_id !== req.session.clientId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const { data, error } = await supabase
    .from('queue')
    .update({ caption: caption.trim(), modified_by_client: true })
    .eq('id', postId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, post: data });
});

// ─────────────────────────────────────────────
// POST /api/portal/:clientId/special-post
// Demander un post spécial
// Limite : 1/semaine en STARTER, illimité en PRO
// ─────────────────────────────────────────────
router.post('/:clientId/special-post', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const { message, scheduled_at, media_url, let_ai_decide, manual_caption } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Veuillez décrire votre besoin' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) return res.status(404).json({ error: 'Client introuvable' });

    if (client.status === 'paused') {
      return res.status(403).json({
        error: 'service_paused',
        message: 'Votre service est actuellement suspendu. Contactez votre community manager.'
      });
    }

    const plan = getPlan(client);

    // ── Vérification limite STARTER : 1 post spécial/semaine ─────────────────
    if (plan.postsSpeciauxMax < 999) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const { data: recentSpecial } = await supabase
        .from('queue')
        .select('id')
        .eq('client_id', clientId)
        .eq('special_request', true)
        .gte('created_at', oneWeekAgo.toISOString());

      if (recentSpecial && recentSpecial.length >= plan.postsSpeciauxMax) {
        return res.status(403).json({
          error: 'limite_atteinte',
          message: `Votre forfait Starter inclut ${plan.postsSpeciauxMax} post spécial par semaine. Vous avez déjà utilisé votre quota cette semaine. Passez au forfait Pro pour des posts spéciaux illimités !`
        });
      }
    }
    // PRO → pas de limite

    // ── Génération de la caption ──────────────────────────────────────────────
    let caption = manual_caption || message;

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

Le client souhaite publier un post spécial avec ce contexte :
"${message}"

Génère une caption Instagram engageante et virale.
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

    // ── Planification ─────────────────────────────────────────────────────────
    const scheduledDate = scheduled_at
      ? new Date(scheduled_at)
      : new Date(Date.now() + 2 * 60 * 60 * 1000); // +2h par défaut

    const { data: post, error } = await supabase
      .from('queue')
      .insert({
        client_id:       clientId,
        caption,
        media_url:       media_url || null,
        scheduled_at:    scheduledDate.toISOString(),
        type:            'post',
        platform:        'instagram',
        statut:          'planifie',
        special_request: true,
        special_message: message
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ── Notification email ────────────────────────────────────────────────────
    await notifySpecialPost(client, message, scheduledDate, caption);

    res.json({ success: true, post, caption });

  } catch (err) {
    console.error('❌ Erreur post spécial:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// NOTIFICATION EMAIL
// ─────────────────────────────────────────────
async function notifySpecialPost(client, message, scheduledAt, caption) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `SocialAI <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `[SocialAI] Post spécial demandé — ${client.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;padding:24px;background:#0d0d14;color:#f5f4f0;border-radius:12px">
          <div style="font-size:18px;font-weight:700;margin-bottom:16px">⭐ Nouveau post spécial</div>
          <p style="color:#c8c6be;margin-bottom:12px">
            <strong style="color:#f5f4f0">${client.name}</strong> a demandé un post spécial.
          </p>
          <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin-bottom:12px">
            <div style="font-size:11px;color:#7a7870;margin-bottom:6px">MESSAGE DU CLIENT</div>
            <div style="font-size:13px;color:#f5f4f0">${message}</div>
          </div>
          <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin-bottom:16px">
            <div style="font-size:11px;color:#7a7870;margin-bottom:6px">CAPTION GÉNÉRÉE</div>
            <div style="font-size:13px;color:#c8c6be;white-space:pre-wrap">${caption}</div>
          </div>
          <div style="font-size:12px;color:#7a7870">
            📅 Planifié le ${scheduledAt.toLocaleString('fr-FR')}
          </div>
        </div>
      `
    });

    console.log(`📧 Notification post spécial envoyée pour ${client.name}`);
  } catch (err) {
    console.error('❌ Email notification:', err.message);
  }
}

module.exports = router;