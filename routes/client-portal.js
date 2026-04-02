// routes/client-portal.js
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('./auth-portal');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Envoi email via Resend ────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  try {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from:'SocialAI <onboarding@resend.dev>', to:[to], subject, html })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message||'Erreur Resend');
    console.log(`📧 Email envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur email:', err.message);
  }
}

// ─────────────────────────────────────────────
// DÉFINITION DES LIMITES PAR FORFAIT
// ─────────────────────────────────────────────
const PLANS = {
  starter: {
    postsVisibles:       1,
    postsSpeciauxMax:    1,
    recyclage:           false,
    reponseDM:           false,
    reponseCommentaires: false,
  },
  pro: {
    postsVisibles:       999,
    postsSpeciauxMax:    999,
    recyclage:           true,
    reponseDM:           true,
    reponseCommentaires: true,
  }
};

function getPlan(client) {
  return PLANS[(client.plan||'starter').toLowerCase()] || PLANS.starter;
}

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/info
// ─────────────────────────────────────────────
router.get('/:clientId/info', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, sector, instagram, description, tone, solo_entrepreneur, plan, status')
    .eq('id', req.params.clientId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/posts
// Retourne les posts ET les stories planifiés
// ─────────────────────────────────────────────
router.get('/:clientId/posts', requireAuth, async (req, res) => {
  const { clientId } = req.params;

  const { data: client } = await supabase
    .from('clients')
    .select('plan, status')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client introuvable' });

  if (client.status === 'paused') {
    return res.status(403).json({ error:'service_paused', message:'Service suspendu.' });
  }

  const plan = getPlan(client);

  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .eq('client_id', clientId)
    .in('statut', ['planifie', 'en_attente_validation'])
    .order('scheduled_at', { ascending: true })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  const all = data || [];

  // Séparer posts et stories
  let posts   = all.filter(p => p.type !== 'story');
  const stories = all.filter(p => p.type === 'story').slice(0, 20);

  // Limiter les posts selon le forfait
  if (plan.postsVisibles === 1) {
    const next = posts.find(p => true);
    posts = next ? [next] : [];
  } else {
    posts = posts.slice(0, plan.postsVisibles === 999 ? 100 : plan.postsVisibles);
  }

  res.json({
    posts,
    stories,
    plan:       (client.plan||'starter').toLowerCase(),
    planLimits: plan
  });
});

// ─────────────────────────────────────────────
// GET /api/portal/:clientId/special-count
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

  const plan = getPlan(client||{});
  const used = data?.length || 0;

  res.json({
    used,
    max:       plan.postsSpeciauxMax,
    remaining: Math.max(0, plan.postsSpeciauxMax - used),
    unlimited: plan.postsSpeciauxMax >= 999
  });
});

// ─────────────────────────────────────────────
// PATCH /api/portal/posts/:postId/caption
// ─────────────────────────────────────────────
router.patch('/posts/:postId/caption', requireAuth, async (req, res) => {
  const { postId } = req.params;
  const { caption } = req.body;

  if (!caption?.trim()) return res.status(400).json({ error:'Caption vide' });

  const { data: post } = await supabase
    .from('queue').select('client_id').eq('id', postId).single();

  if (!post || post.client_id !== req.session.clientId) {
    return res.status(403).json({ error:'Accès refusé' });
  }

  const { data, error } = await supabase
    .from('queue')
    .update({ caption:caption.trim(), modified_by_client:true })
    .eq('id', postId)
    .select().single();

  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, post:data });
});

// ─────────────────────────────────────────────
// DELETE /api/portal/posts/:postId
// ─────────────────────────────────────────────
router.delete('/posts/:postId', requireAuth, async (req, res) => {
  const { postId } = req.params;

  const { data: post } = await supabase
    .from('queue').select('client_id').eq('id', postId).single();

  if (!post || post.client_id !== req.session.clientId) {
    return res.status(403).json({ error:'Accès refusé' });
  }

  const { error } = await supabase.from('queue').delete().eq('id', postId);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});

// ─────────────────────────────────────────────
// POST /api/portal/:clientId/special-post
// ─────────────────────────────────────────────
router.post('/:clientId/special-post', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const { message, scheduled_at, media_url, let_ai_decide, manual_caption } = req.body;

  if (!message?.trim()) return res.status(400).json({ error:'Message requis' });

  try {
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', clientId).single();

    if (!client) return res.status(404).json({ error:'Client introuvable' });
    if (client.status === 'paused') return res.status(403).json({ error:'service_paused' });

    const plan = getPlan(client);

    if (plan.postsSpeciauxMax < 999) {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const { data: recent } = await supabase
        .from('queue').select('id')
        .eq('client_id', clientId).eq('special_request', true)
        .gte('created_at', oneWeekAgo.toISOString());
      if (recent && recent.length >= plan.postsSpeciauxMax) {
        return res.status(403).json({
          error:   'limite_atteinte',
          message: `Quota hebdomadaire atteint (${plan.postsSpeciauxMax} post spécial/semaine).`
        });
      }
    }

    let caption = manual_caption || message;
    if (let_ai_decide && message) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Tu es un expert community manager Instagram.
Client : ${client.name}
Secteur : ${client.sector||'non précisé'}
Ton : ${client.tone||'professionnel et chaleureux'}

Le client veut un post spécial : "${message}"

Génère une caption Instagram engageante :
- Accroche forte en première ligne
- Ton adapté au client
- Call-to-action
- Hashtags (10-15 max)
- Max 150 mots

Retourne uniquement la caption.`
        }]
      });
      caption = response.content[0].text;
    }

    const scheduledDate = scheduled_at
      ? new Date(scheduled_at)
      : new Date(Date.now() + 2 * 60 * 60 * 1000);

    const { data: post, error } = await supabase
      .from('queue')
      .insert({
        client_id:       clientId,
        caption,
        media_url:       media_url||null,
        scheduled_at:    scheduledDate.toISOString(),
        type:            'post',
        statut:          'planifie',
        special_request: true,
        special_message: message
      })
      .select().single();

    if (error) return res.status(500).json({ error:error.message });

    await sendEmail(
      process.env.GMAIL_USER,
      `[SocialAI] Post spécial — ${client.name}`,
      `<div style="font-family:sans-serif;max-width:500px;padding:24px;background:#0d0d14;color:#f5f4f0;border-radius:12px">
        <div style="font-size:18px;font-weight:700;margin-bottom:16px">⭐ Nouveau post spécial</div>
        <p style="color:#c8c6be"><strong style="color:#f5f4f0">${client.name}</strong> a demandé un post spécial.</p>
        <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin:12px 0">
          <div style="font-size:11px;color:#7a7870;margin-bottom:6px">MESSAGE DU CLIENT</div>
          <div style="color:#f5f4f0">${message}</div>
        </div>
        <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin:12px 0">
          <div style="font-size:11px;color:#7a7870;margin-bottom:6px">CAPTION GÉNÉRÉE</div>
          <div style="color:#c8c6be;white-space:pre-wrap">${caption}</div>
        </div>
        <div style="font-size:12px;color:#7a7870">📅 Planifié le ${scheduledDate.toLocaleString('fr-FR')}</div>
      </div>`
    );

    res.json({ success:true, post, caption });

  } catch (err) {
    console.error('❌ Post spécial:', err.message);
    res.status(500).json({ error:err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/portal/:clientId/help-request
// ─────────────────────────────────────────────
router.post('/:clientId/help-request', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  const { subject, message, urgency, clientName } = req.body;

  if (!subject || !message?.trim()) {
    return res.status(400).json({ error:'Sujet et message requis' });
  }

  const urgencyLabels = {
    normal:   '🟢 Normal — sous 24h',
    urgent:   '🟡 Urgent — sous 4h',
    critique: '🔴 Critique — ASAP'
  };

  const subjectLabels = {
    modification_post:  '✏️ Modifier un post planifié',
    contenu_urgent:     '⚡ Contenu urgent',
    probleme_technique: '🔧 Problème technique',
    strategie:          '🎯 Question stratégie',
    autre:              '💬 Autre demande'
  };

  try {
    await sendEmail(
      process.env.GMAIL_USER,
      `[SocialAI] ${subjectLabels[subject]||subject} — ${clientName||clientId}`,
      `<div style="font-family:sans-serif;max-width:500px;padding:24px;background:#0d0d14;color:#f5f4f0;border-radius:12px">
        <div style="font-size:18px;font-weight:700;margin-bottom:16px">💬 Demande d'aide client</div>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <span style="font-size:12px;padding:3px 10px;border-radius:10px;background:#1a1a26;border:1px solid #3a3a50;color:#c8c6be">${subjectLabels[subject]||subject}</span>
          <span style="font-size:12px;padding:3px 10px;border-radius:10px;background:#1a1a26;border:1px solid #3a3a50;color:#ffb340">${urgencyLabels[urgency]||urgency}</span>
        </div>
        <p style="color:#c8c6be;margin-bottom:12px">De : <strong style="color:#f5f4f0">${clientName||'Client'}</strong></p>
        <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:8px;padding:14px;margin-bottom:16px">
          <div style="font-size:11px;color:#7a7870;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Message</div>
          <div style="font-size:14px;color:#f5f4f0;line-height:1.6;white-space:pre-wrap">${message}</div>
        </div>
        <div style="font-size:12px;color:#7a7870">📅 ${new Date().toLocaleString('fr-FR')} · Client ID : ${clientId}</div>
      </div>`
    );

    res.json({ success:true });
  } catch (err) {
    console.error('❌ Help request:', err.message);
    res.status(500).json({ error:err.message });
  }
});

module.exports = router;