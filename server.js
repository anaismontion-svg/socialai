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
app.get('/romi.html',                (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi.html')));
app.get('/romi-login.html',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi-login.html')));

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
app.use('/api/templates',       require('./routes/templateRoutes'));
app.use('/api/aria',            require('./routes/aria'));
app.use('/api/google-reviews',  require('./routes/google-reviews'));

// ── Route meta ────────────────────────────────────────────────────────────────
app.use('/auth',                require('./routes/meta'));
app.use('/webhook',             require('./routes/meta'));

// ── Fallback SPA back office ──────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Moteur de publication — toutes les 5 minutes avec limite quotidienne ──────
const { processQueue, checkLowContent } = require('./routes/publisher');

// Compteur de publications par jour par client
const dailyPublicationCount = {};

function resetDailyCounters() {
  Object.keys(dailyPublicationCount).forEach(k => delete dailyPublicationCount[k]);
  console.log('🔄 Compteurs quotidiens réinitialisés');
}

// Réinitialiser les compteurs à minuit
const now = new Date();
const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
setTimeout(() => {
  resetDailyCounters();
  setInterval(resetDailyCounters, 24 * 60 * 60 * 1000);
}, msUntilMidnight);

// Publisher toutes les 5 minutes (pas 1 minute)
setTimeout(() => processQueue(), 30 * 1000); // attendre 30s au démarrage
setInterval(processQueue, 5 * 60 * 1000);
setInterval(checkLowContent, 6 * 60 * 60 * 1000);

// ── Pipeline génération IA — toutes les 6h (pas 3h) ──────────────────────────
const { runAIPipeline } = require('./routes/pipeline');
setTimeout(() => runAIPipeline(), 2 * 60 * 1000); // attendre 2min au démarrage
setInterval(runAIPipeline, 6 * 60 * 60 * 1000);

// ── Mise à jour métriques posts — toutes les 6h ───────────────────────────────
const { syncPostMetrics } = require('./routes/feed');
setInterval(syncPostMetrics, 6 * 60 * 60 * 1000);

// ── Planificateur — toutes les 24h UNIQUEMENT, pas au démarrage ───────────────
const { runScheduler } = require('./routes/scheduler');
// Lancer le scheduler à 2h du matin uniquement
function scheduleNextRun() {
  const now = new Date();
  const next2am = new Date(now);
  next2am.setHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setDate(next2am.getDate() + 1);
  const msUntil2am = next2am.getTime() - now.getTime();
  console.log(`🗓️ Prochain scheduler à 2h du matin (dans ${Math.round(msUntil2am / 1000 / 60)} minutes)`);
  setTimeout(() => {
    runScheduler();
    setInterval(runScheduler, 24 * 60 * 60 * 1000);
  }, msUntil2am);
}
scheduleNextRun();

// ── Synchronisation Instagram ─────────────────────────────────────────────────
const { syncAllClients, updateAllStats } = require('./routes/instagram-sync');
setTimeout(async () => {
  try {
    console.log('🔄 Démarrage sync historique Instagram...');
    await syncAllClients();
    console.log('✅ Sync Instagram terminée');
  } catch (err) {
    console.error('❌ Erreur sync Instagram:', err.message);
  }
}, 5 * 60 * 1000); // attendre 5min avant la sync

setInterval(async () => {
  try { await updateAllStats(); }
  catch (err) { console.error('❌ Erreur stats Instagram:', err.message); }
}, 24 * 60 * 60 * 1000);

// ── Migration médias Instagram → Supabase Storage ────────────────────────────
const { migrateInstagramMedia } = require('./routes/migrate-media');
setTimeout(() => migrateInstagramMedia(), 3 * 60 * 1000); // 3min après démarrage
setInterval(migrateInstagramMedia, 60 * 60 * 1000); // puis toutes les heures

// ── Démarrage ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;