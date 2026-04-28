require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login.html',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/client.html',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/branding-setup.html',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'branding-setup.html')));
app.get('/template-selection.html',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'template-selection.html')));
app.get('/romi.html',                (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi.html')));
app.get('/romi-login.html',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'romi-login.html')));

app.use('/api/clients',         require('./routes/clients'));
app.use('/api/media',           require('./routes/media'));
app.use('/api/queue',           require('./routes/queue'));
app.use('/api/auth',            require('./routes/auth-portal').router);
app.use('/api/portal',          require('./routes/client-portal'));
app.use('/api/reports',         require('./routes/reports'));
app.use('/api/branding',        require('./routes/branding'));
app.use('/api/pipeline',        require('./routes/pipeline'));
app.use('/api/story-templates', require('./routes/story-templates'));
app.use('/api/story-assets',    require('./routes/story-assets'));
app.use('/api/romi',            require('./routes/romi'));
app.use('/api/romi-auth',       require('./routes/romi-auth').router);
app.use('/api/templates',       require('./routes/templateRoutes'));
app.use('/api/aria',            require('./routes/aria'));
app.use('/api/google-reviews',  require('./routes/google-reviews'));
app.use('/auth',                require('./routes/meta'));
app.use('/webhook',             require('./routes/meta'));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const { processQueue, checkLowContent } = require('./routes/publisher');
const dailyPublicationCount = {};

function resetDailyCounters() {
  Object.keys(dailyPublicationCount).forEach(k => delete dailyPublicationCount[k]);
  console.log('Reset compteurs quotidiens');
}

const now = new Date();
const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
setTimeout(() => {
  resetDailyCounters();
  setInterval(resetDailyCounters, 24 * 60 * 60 * 1000);
}, msUntilMidnight);

setTimeout(() => processQueue(), 30 * 1000);
setInterval(processQueue, 5 * 60 * 1000);
setInterval(checkLowContent, 6 * 60 * 60 * 1000);

const { runAIPipeline } = require('./routes/pipeline');
setTimeout(() => runAIPipeline(), 2 * 60 * 1000);
setInterval(runAIPipeline, 6 * 60 * 60 * 1000);

const { syncPostMetrics } = require('./routes/feed');
setInterval(syncPostMetrics, 6 * 60 * 60 * 1000);

const { runScheduler } = require('./routes/scheduler');
const { scheduleFixedStories } = require('./routes/schedule-stories');

function scheduleNextRun() {
  const now = new Date();
  const next2am = new Date(now);
  next2am.setHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setDate(next2am.getDate() + 1);
  const msUntil2am = next2am.getTime() - now.getTime();
  console.log(`Prochain scheduler a 2h du matin (dans ${Math.round(msUntil2am/1000/60)} minutes)`);
  setTimeout(() => {
    runScheduler();
    setInterval(runScheduler, 24 * 60 * 60 * 1000);
    scheduleFixedStories();
    setInterval(scheduleFixedStories, 24 * 60 * 60 * 1000);
  }, msUntil2am);
}
scheduleNextRun();

const { syncAllClients, updateAllStats } = require('./routes/instagram-sync');
setTimeout(async () => {
  try {
    console.log('Demarrage sync Instagram...');
    await syncAllClients();
    console.log('Sync Instagram terminee');
  } catch (err) { console.error('Erreur sync Instagram:', err.message); }
}, 5 * 60 * 1000);

setInterval(async () => {
  try { await updateAllStats(); }
  catch (err) { console.error('Erreur stats Instagram:', err.message); }
}, 24 * 60 * 60 * 1000);

const { migrateInstagramMedia } = require('./routes/migrate-media');
setTimeout(() => migrateInstagramMedia(), 3 * 60 * 1000);
setInterval(migrateInstagramMedia, 60 * 60 * 1000);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SocialAI demarre sur http://localhost:${PORT}`);
  });
}

module.exports = app;