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

module.exports = router;