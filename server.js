require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Pages espace client ───────────────────────────────────────────────────────
app.get('/login.html',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/client.html',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/branding-setup.html',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'branding-setup.html')));
app.get('/template-selection.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'template-selection.html')));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/clients',         require('./routes/clients'));
app.use('/api/media',           require('./routes/media'));
app.use('/api/queue',           require('./routes/queue'));
app.use('/api/auth',            require('./routes/auth-portal').router);
app.use('/api/portal',          require('./routes/client-portal'));
app.use('/api/reports',         require('./routes/reports'));
app.use('/api/branding',        require('./routes/branding'));
app.use('/api/pipeline',        require('./routes/pipeline'));
app.use('/api/story-templates', require('./routes/story-templates'));
app.use('/api/romi',            require('./routes/romi'));
app.use('/api/romi-auth',       require('./routes/romi-auth').router);
app.use('/api/templates',       require('./routes/templateRoutes'));   // ← NOUVEAU

app.get('/romi.html',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi.html')));
app.get('/romi-login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi-login.html')));
app.use('/',                require('./routes/meta'));

// ── Fallback SPA back office ──────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Moteur de publication ─────────────────────────────────────────────────────
const { processQueue, checkLowContent } = require('./routes/publisher');
processQueue();
checkLowContent();
setInterval(processQueue,    60 * 1000);
setInterval(checkLowContent, 6 * 60 * 60 * 1000);

// ── Pipeline génération IA — toutes les 3h ────────────────────────────────────
const { runAIPipeline } = require('./routes/pipeline');
runAIPipeline();
setInterval(runAIPipeline, 3 * 60 * 60 * 1000);

// ── Mise à jour métriques posts — toutes les 6h ───────────────────────────────
const { syncPostMetrics } = require('./routes/feed');
setInterval(syncPostMetrics, 6 * 60 * 60 * 1000);

// ── Planificateur automatique — toutes les 24h ────────────────────────────────
const { runScheduler } = require('./routes/scheduler');
runScheduler();
setInterval(runScheduler, 24 * 60 * 60 * 1000);

// ── Stories quotidiennes Aria — chaque jour à 8h ─────────────────────────────
const { runDailyStoriesCron } = require('./aria_stories_integration');   // ← NOUVEAU
const CronJob = (() => {
  try { return require('node-cron'); } catch { return null; }
})();
if (CronJob) {
  CronJob.schedule('0 8 * * *', () => {
    console.log('📸 Aria — Génération stories quotidiennes...');
    runDailyStoriesCron().catch(err =>
      console.error('❌ Erreur stories cron:', err.message)
    );
  });
}

// ── Synchronisation Instagram ─────────────────────────────────────────────────
const { syncAllClients, updateAllStats } = require('./routes/instagram-sync');
(async () => {
  try {
    console.log('🔄 Démarrage sync historique Instagram...');
    await syncAllClients();
    console.log('✅ Sync Instagram terminée');
  } catch (err) {
    console.error('❌ Erreur sync Instagram:', err.message);
  }
})();
setInterval(async () => {
  try { await updateAllStats(); }
  catch (err) { console.error('❌ Erreur stats Instagram:', err.message); }
}, 24 * 60 * 60 * 1000);

// ── Démarrage ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;