const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .order('scheduled_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', async (req, res) => {
  const { client_id, media_id, caption, scheduled_at, type } = req.body;
  const { data, error } = await supabase
    .from('queue')
    .insert([{ client_id, media_id, caption, scheduled_at, type, statut: 'planifie' }])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

router.put('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('queue')
    .update(req.body)
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('queue')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Changer la photo d'un post planifié (depuis le photo picker client) ──────
router.patch('/:id/media', async (req, res) => {
  const { media_url, media_id } = req.body;
  try {
    const { error } = await supabase
      .from('queue')
      .update({ media_url, modified_by_client: true })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Meilleure heure pour publier (conseil Aria) ───────────────────────────────
router.get('/:id/best-hour', async (req, res) => {
  const hour = new Date().getHours();
  const isOptimal = [9, 12, 18, 20].includes(hour);
  res.json({
    isOptimal,
    ariaMessage: isOptimal
      ? `C'est le moment idéal pour publier ! Votre audience est active maintenant. 🎯`
      : `Le meilleur moment pour publier est à **9h, 12h, 18h ou 20h**. Publier maintenant peut réduire votre portée de 30%. Voulez-vous attendre l'heure optimale ?`
  });
});

// ── Publier immédiatement un post planifié ────────────────────────────────────
router.post('/:id/publish-now', async (req, res) => {
  try {
    const { data: post, error } = await supabase
      .from('queue')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !post) return res.status(404).json({ error: 'Post introuvable' });

    // Marquer comme "publier maintenant" en passant scheduled_at à maintenant
    const { error: updateError } = await supabase
      .from('queue')
      .update({ scheduled_at: new Date().toISOString(), source: 'publish_now' })
      .eq('id', req.params.id);
    if (updateError) throw updateError;

    res.json({ success: true, message: 'Publication lancée' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;