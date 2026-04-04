const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ASSEMBLER_URL = process.env.ASSEMBLER_URL || 'http://localhost:5001';

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('story_templates').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { clientId, type, content } = req.body;
  if (!clientId || !type) return res.status(400).json({ error: 'clientId et type requis' });
  try {
    const { data, error } = await supabase.from('story_templates').upsert({ client_id: clientId, type, content, actif: true, updated_at: new Date().toISOString() }, { onConflict: 'client_id,type' }).select();
    if (error) throw error;
    res.json({ success: true, template: data[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/generate', async (req, res) => {
  const { clientId, type, content } = req.body;
  if (!clientId || !type) return res.status(400).json({ error: 'clientId et type requis' });
  try {
    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
    if (!client) throw new Error('Client introuvable');

    // Branding par défaut si non configuré
    const branding = client.branding || {
      palette: {
        primary:    '#e6bcd0',
        secondary:  '#c4aecf',
        dark:       '#7a5c67',
        light:      '#fdf6f0',
        text_dark:  '#3d2b2b',
        text_light: '#ffffff'
      },
      fonts: { titre: 'Lora-Italic', corps: 'Poppins-Light' },
      logo_style: 'thick',
      logo_position: 'top-left',
      gradient_top: true,
      frame_border: false
    };

    await supabase.from('story_templates').upsert({
      client_id: clientId, type, content, actif: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id,type' });

    const response = await axios.post(`${ASSEMBLER_URL}/story`, {
      client_id:   clientId,
      client_name: client.name,
      branding,
      story_type:  type,
      content
    }, { timeout: 60000 });

    if (!response.data.success) throw new Error(response.data.error);

    const visualUrl = response.data.url;
    await supabase.from('story_templates')
      .update({ visuel_url: visualUrl, generated_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .eq('type', type);

    res.json({ success: true, visuel_url: visualUrl });
  } catch(e) {
    console.error('❌ Génération story template:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/toggle', async (req, res) => {
  const { clientId, type, actif } = req.body;
  try {
    await supabase.from('story_templates').update({ actif }).eq('client_id', clientId).eq('type', type);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;