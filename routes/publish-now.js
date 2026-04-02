// routes/publish-now.js
// À monter dans server.js : app.use('/api/queue', require('./routes/publish-now'));
// Route : POST /api/queue/:id/publish-now

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { processQueue } = require('./publisher');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BEST_HOURS = [9, 12, 18, 20]; // heures optimales (heure locale Paris)

// ── GET /api/queue/:id/best-hour — conseil d'heure optimale ──────────────────
router.get('/:id/best-hour', async (req, res) => {
  try {
    const { data: item } = await supabase
      .from('queue')
      .select('scheduled_at, type, client_id')
      .eq('id', req.params.id)
      .single();

    if (!item) return res.status(404).json({ error: 'Post introuvable' });

    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const currentHour = nowParis.getHours();

    // Trouver la prochaine heure optimale
    const nextBest = BEST_HOURS.find(h => h > currentHour) || BEST_HOURS[0];
    const isOptimal = BEST_HOURS.some(h => h === currentHour);

    // Message Aria selon le contexte
    let ariaMessage = '';
    if (isOptimal) {
      ariaMessage = `✅ Vous publiez à ${currentHour}h, c'est une heure optimale pour maximiser votre engagement ! Vous pouvez publier maintenant en toute confiance.`;
    } else if (currentHour < 8) {
      ariaMessage = `🌙 Il est ${currentHour}h, votre audience dort encore. Je vous conseille de publier à **9h** pour le pic matinal — vous obtiendrez jusqu'à 2× plus de vues qu'en pleine nuit. Voulez-vous publier quand même ?`;
    } else if (currentHour >= 22) {
      ariaMessage = `🌙 Il est ${currentHour}h, l'activité Instagram est très faible à cette heure. Je vous conseille de publier demain à **9h** pour le meilleur reach. Voulez-vous publier quand même maintenant ?`;
    } else {
      ariaMessage = `⏰ Il est ${currentHour}h. Pour maximiser vos vues, je vous conseille de publier à **${nextBest}h** — c'est là que votre audience est la plus active. Voulez-vous publier quand même maintenant ?`;
    }

    res.json({
      currentHour,
      nextBestHour: nextBest,
      isOptimal,
      ariaMessage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/queue/:id/publish-now — publication immédiate ──────────────────
router.post('/:id/publish-now', async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que le post existe et est planifié
    const { data: item } = await supabase
      .from('queue')
      .select('*, clients(*)')
      .eq('id', id)
      .single();

    if (!item) return res.status(404).json({ error: 'Post introuvable' });
    if (item.statut !== 'planifie') return res.status(400).json({ error: 'Ce post ne peut pas être publié (statut: ' + item.statut + ')' });

    // Mettre scheduled_at à maintenant pour que processQueue le prenne
    const now = new Date().toISOString();
    await supabase
      .from('queue')
      .update({ scheduled_at: now })
      .eq('id', id);

    // Déclencher le publisher immédiatement
    // On appelle processQueue en arrière-plan
    processQueue().catch(err => console.error('publish-now processQueue error:', err.message));

    res.json({ success: true, message: 'Publication en cours…' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/queue/:id/media — changer la photo d'un post ─────────────────
router.patch('/:id/media', async (req, res) => {
  try {
    const { media_url, media_id } = req.body;
    if (!media_url) return res.status(400).json({ error: 'media_url requis' });

    const updates = { media_url };
    if (media_id) updates.media_id = media_id;

    const { error } = await supabase
      .from('queue')
      .update(updates)
      .eq('id', req.params.id);

    if (error) throw error;

    // Si on change le média, marquer l'ancien comme non utilisé et le nouveau comme utilisé
    if (media_id) {
      // Trouver l'ancien media_id
      const { data: oldItem } = await supabase
        .from('queue')
        .select('media_id')
        .eq('id', req.params.id)
        .single();

      if (oldItem?.media_id && oldItem.media_id !== media_id) {
        await supabase.from('media').update({ used: false }).eq('id', oldItem.media_id);
      }
      await supabase.from('media').update({ used: true }).eq('id', media_id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;