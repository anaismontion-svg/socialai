
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/clients', require('./routes/clients'));
app.use('/api/media', require('./routes/media'));
app.use('/api/queue', require('./routes/queue'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SocialAI démarré sur http://localhost:${PORT}`);
});
