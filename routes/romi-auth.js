// routes/romi-auth.js
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const sessions = {};

function hashPassword(pw) {
  const secret = process.env.SESSION_SECRET || 'socialai_secret_2026';
  return crypto.createHmac('sha256', secret).update(pw).digest('hex');
}

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ── Middleware auth ───────────────────────────────────────────────────────────
function requireRomiAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Non authentifié' });
  req.romiSession = session;
  next();
}

// Nettoyage sessions toutes les heures
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(t => { if (sessions[t].expiresAt < now) delete sessions[t]; });
}, 60 * 60 * 1000);

// ── POST /api/romi-auth/login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const { data: user } = await supabase
    .from('romi_users').select('*').eq('email', email.toLowerCase().trim()).single();

  if (!user || hashPassword(password) !== user.password_hash) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const token = generateToken();
  sessions[token] = {
    userId: user.id, userName: user.name, userRole: user.role,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
  };

  res.json({ success: true, token, userName: user.name, userRole: user.role });
});

// ── GET /api/romi-auth/me ─────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Session expirée' });
  res.json({ userId: session.userId, userName: session.userName, userRole: session.userRole });
});

// ── POST /api/romi-auth/logout ────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions[token]) delete sessions[token];
  res.json({ success: true });
});

// ── POST /api/romi-auth/create-user (admin only) ─────────────────────────────
router.post('/create-user', async (req, res) => {
  const { name, email, password, role, adminKey } = req.body;
  if (adminKey !== (process.env.ADMIN_KEY || 'socialai_admin_2026')) {
    return res.status(403).json({ error: 'Clé admin invalide' });
  }
  const { data, error } = await supabase.from('romi_users').insert([{
    name, email: email.toLowerCase().trim(),
    password_hash: hashPassword(password),
    role: role || 'commercial'
  }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, user: { id: data.id, name: data.name, role: data.role } });
});

module.exports = { router, requireRomiAuth };