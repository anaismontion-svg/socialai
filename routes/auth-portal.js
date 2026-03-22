// routes/auth-portal.js
// Authentification email + mot de passe pour l'espace client

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Sessions en mémoire (token -> clientId)
// En production, utiliser Redis ou une table Supabase
const sessions = {};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.SESSION_SECRET || 'socialai_secret').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, email, password_hash, portal_access')
    .eq('email', email.toLowerCase().trim())
    .eq('portal_access', true)
    .single();

  if (error || !client) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const hash = hashPassword(password);
  if (hash !== client.password_hash) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // Créer une session
  const token = generateToken();
  sessions[token] = {
    clientId: client.id,
    clientName: client.name,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 jours
  };

  res.json({ success: true, token, clientId: client.id, clientName: client.name });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions[token]) delete sessions[token];
  res.json({ success: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Session expirée' });
  }
  res.json({ clientId: session.clientId, clientName: session.clientName });
});

// ── Middleware d'authentification ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  // Vérifier que le client accède uniquement à ses propres données
  const requestedClientId = req.params.clientId;
  if (requestedClientId && requestedClientId !== session.clientId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  req.session = session;
  next();
}

// ── POST /api/auth/set-password (admin seulement) ─────────────────────────────
// Permet à l'admin de définir le mot de passe d'un client
router.post('/set-password', async (req, res) => {
  const { clientId, password, adminKey } = req.body;

  // Vérification clé admin simple
  if (adminKey !== (process.env.ADMIN_KEY || 'socialai_admin')) {
    return res.status(403).json({ error: 'Clé admin invalide' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
  }

  const hash = hashPassword(password);
  const { error } = await supabase
    .from('clients')
    .update({ password_hash: hash, portal_access: true })
    .eq('id', clientId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Mot de passe défini avec succès' });
});

module.exports = { router, requireAuth };