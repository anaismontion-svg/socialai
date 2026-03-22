require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/clients', require('./routes/clients'));
app.use('/api/media', require('./routes/media'));
app.use('/api/queue', require('./routes/queue'));
app.use('/', require('./routes/meta'));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Moteur de publication ─────────────────────────────────────────────────────
const { processQueue, checkLowContent } = require('./routes/publisher');
setInterval(processQueue, 60 * 1000);
setInterval(checkLowContent, 6 * 60 * 60 * 1000);
processQueue();
checkLowContent();

// ── Planificateur automatique ─────────────────────────────────────────────────
const { runScheduler } = require('./routes/scheduler');
setInterval(runScheduler, 24 * 60 * 60 * 1000);
runScheduler();

// ── Synchronisation Instagram + stats ────────────────────────────────────────
(async () => {
  try {
    const { syncInstagramHistory, updatePostStats } = require('./routes/instagram-sync');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    async function syncAllClients() {
      try {
        const { data: accounts } = await supabase
          .from('social_accounts')
          .select('client_id')
          .eq('platform', 'instagram');
        if(!accounts || accounts.length === 0) return;
        console.log(`🔄 Sync historique pour ${accounts.length} compte(s)...`);
        for(const acc of accounts) {
          await syncInstagramHistory(acc.client_id);
        }
      } catch(err) {
        console.error('❌ Erreur sync:', err.message);
      }
    }

    async function updateAllStats() {
      try {
        const { data: accounts } = await supabase
          .from('social_accounts')
          .select('client_id')
          .eq('platform', 'instagram');
        if(!accounts || accounts.length === 0) return;
        for(const acc of accounts) {
          await updatePostStats(acc.client_id);
        }
      } catch(err) {
        console.error('❌ Erreur stats:', err.message);
      }
    }

    await syncAllClients();
    setInterval(updateAllStats, 24 * 60 * 60 * 1000);

  } catch(err) {
    console.error('❌ Erreur chargement instagram-sync:', err.message);
  }
})();

module.exports = app;

if(require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
  });
}