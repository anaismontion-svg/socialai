require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/clients', require('./routes/clients'));
app.use('/api/media', require('./routes/media'));
app.use('/api/queue', require('./routes/queue'));
app.get('/', (req, res) => {

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
 app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
  });
}
