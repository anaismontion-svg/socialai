// routes/reports.js
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GET /api/reports/:clientId/stats ─────────────────────────────────────────
router.get('/:clientId/stats', async (req, res) => {
  const { clientId } = req.params;
  try {
    const { data: mediaPosts } = await supabase
      .from('media').select('*').eq('client_id', clientId)
      .not('instagram_post_id', 'is', null)
      .order('original_post_date', { ascending: true });

    const { data: queuePosts } = await supabase
      .from('queue').select('*').eq('client_id', clientId)
      .order('scheduled_at', { ascending: false });

    const posts = mediaPosts || [];
    const queue = queuePosts || [];

    const totalLikes    = posts.reduce((s,p) => s+(p.likes||0), 0);
    const totalComments = posts.reduce((s,p) => s+(p.comments||0), 0);
    const totalReach    = posts.reduce((s,p) => s+(p.reach||0), 0);
    const avgEngagement = posts.length > 0
      ? ((totalLikes + totalComments) / posts.length).toFixed(1) : 0;

    const topPosts = [...posts]
      .sort((a,b) => (b.performance_score||0)-(a.performance_score||0))
      .slice(0,6);

    const byMonth = {};
    posts.forEach(p => {
      if (!p.original_post_date) return;
      const m = p.original_post_date.substring(0,7);
      if (!byMonth[m]) byMonth[m] = { likes:0, comments:0, reach:0, count:0 };
      byMonth[m].likes    += p.likes    || 0;
      byMonth[m].comments += p.comments || 0;
      byMonth[m].reach    += p.reach    || 0;
      byMonth[m].count++;
    });
    const evolution = Object.entries(byMonth)
      .sort(([a],[b]) => a.localeCompare(b)).slice(-12)
      .map(([month, d]) => ({ month, ...d }));

    const beforeIA = posts.filter(p => p.source === 'instagram_history');
    const afterIA  = posts.filter(p => p.source !== 'instagram_history');
    const avgBefore = beforeIA.length > 0
      ? (beforeIA.reduce((s,p)=>s+(p.likes||0)+(p.comments||0),0)/beforeIA.length).toFixed(1) : 0;
    const avgAfter  = afterIA.length > 0
      ? (afterIA.reduce((s,p)=>s+(p.likes||0)+(p.comments||0),0)/afterIA.length).toFixed(1) : 0;

    res.json({
      stats: {
        totalPosts: posts.length, totalLikes, totalComments, totalReach, avgEngagement,
        topPosts, evolution,
        beforeIA: { count: beforeIA.length, avgEngagement: avgBefore },
        afterIA:  { count: afterIA.length,  avgEngagement: avgAfter },
        plannedPosts:   queue.filter(p=>p.statut==='planifie').length,
        publishedPosts: queue.filter(p=>p.statut==='publie').length,
      },
      posts,
      queue
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/reports/post/:postId ─────────────────────────────────────────────
router.get('/post/:postId', async (req, res) => {
  const { postId } = req.params;
  const { type }   = req.query;
  try {
    const table = type === 'queue' ? 'queue' : 'media';
    const { data, error } = await supabase.from(table).select('*').eq('id', postId).single();
    if (error || !data) return res.status(404).json({ error: 'Post introuvable' });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/reports/post/:postId/caption ───────────────────────────────────
router.patch('/post/:postId/caption', async (req, res) => {
  const { postId }  = req.params;
  const { caption } = req.body;
  if (!caption?.trim()) return res.status(400).json({ error: 'Caption vide' });
  const { data, error } = await supabase
    .from('queue').update({ caption: caption.trim(), modified_by_client: true })
    .eq('id', postId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, post: data });
});

// ── DELETE /api/reports/post/:postId ─────────────────────────────────────────
router.delete('/post/:postId', async (req, res) => {
  const { postId } = req.params;
  const { error }  = await supabase.from('queue').delete().eq('id', postId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/reports/post/:postId/ai-suggest ────────────────────────────────
router.post('/post/:postId/ai-suggest', async (req, res) => {
  const { directive, currentCaption, clientName, sector, tone, performanceScore } = req.body;
  if (!currentCaption) return res.status(400).json({ error: 'Caption manquante' });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Tu es un expert en community management Instagram et copywriting viral.

Client : ${clientName||'Non précisé'}
Secteur : ${sector||'Non précisé'}
Ton : ${tone||'Professionnel et chaleureux'}
${performanceScore ? `Score de performance actuel : ${performanceScore}/100` : ''}

Caption actuelle :
"${currentCaption}"

${directive ? `Directive du client : "${directive}"` : 'Améliore cette caption pour la rendre plus engageante et virale.'}

Réponds avec ce format JSON exact, sans markdown :
{
  "suggestion": "la nouvelle caption complète",
  "explications": [
    "Explication du changement 1",
    "Explication du changement 2",
    "Explication du changement 3"
  ],
  "points_forts": ["point fort 1", "point fort 2"],
  "ameliorations": ["amélioration 1", "amélioration 2"]
}`
      }]
    });

    let result;
    try {
      const clean = response.content[0].text.replace(/```json|```/g,'').trim();
      result = JSON.parse(clean);
    } catch {
      result = { suggestion: response.content[0].text, explications: [], points_forts: [], ameliorations: [] };
    }
    res.json(result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;