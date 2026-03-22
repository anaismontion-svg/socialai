require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/clients', require('./routes/clients'));
app.use('/api/media',   require('./routes/media'));
app.use('/api/queue',   require('./routes/queue'));
app.use('/api/portal',  require('./routes/client-portal'));
app.use('/',            require('./routes/meta'));

// ── Fallback SPA ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Moteur de publication ─────────────────────────────────────────────────────
const { processQueue, checkLowContent } = require('./routes/publisher');
processQueue();
checkLowContent();
setInterval(processQueue,    1  * 60 * 1000);
setInterval(checkLowContent, 6  * 60 * 60 * 1000);

// ── Planificateur automatique ─────────────────────────────────────────────────
const { runScheduler } = require('./routes/scheduler');
runScheduler();
setInterval(runScheduler, 24 * 60 * 60 * 1000);

// ── Synchronisation Instagram ─────────────────────────────────────────────────
const { syncAllClients, updateAllStats } = require('./routes/instagram-sync');

(async () => {
  try {
    console.log('🔄 Démarrage sync historique Instagram...');
    await syncAllClients();
    console.log('✅ Sync Instagram terminée');
  } catch (err) {
    console.error('❌ Erreur sync Instagram au démarrage:', err.message);
  }
})();

setInterval(async () => {
  try {
    await updateAllStats();
  } catch (err) {
    console.error('❌ Erreur mise à jour stats Instagram:', err.message);
  }
}, 24 * 60 * 60 * 1000);

// ── Démarrage du serveur ──────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;