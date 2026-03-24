// routes/auth-portal.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Sessions en mémoire (token -> session)
const sessions = {};

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────
function hashPassword(password) {
  const secret = process.env.SESSION_SECRET || 'socialai_secret_2026';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateTempPassword() {
  const words1 = ['Rose','Lune','Ciel','Mer','Fleur','Soleil','Étoile','Nuage'];
  const words2 = ['Douce','Bleue','Belle','Libre','Vive','Claire','Pure'];
  const num = Math.floor(Math.random() * 90) + 10;
  const w1 = words1[Math.floor(Math.random() * words1.length)];
  const w2 = words2[Math.floor(Math.random() * words2.length)];
  return `${w1}-${num}-${w2}`;
}

async function sendEmail(to, subject, html) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    await transporter.sendMail({
      from: `SocialAI <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log(`📧 Email envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur envoi email:', err.message);
  }
}

// ─────────────────────────────────────────────
// MIDDLEWARE AUTH
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const requestedClientId = req.params.clientId;
  if (requestedClientId && requestedClientId !== session.clientId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  req.session = session;
  next();
}

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, email, password_hash, temp_password_hash, portal_access, first_login, branding_status')
    .eq('email', email.toLowerCase().trim())
    .eq('portal_access', true)
    .single();

  if (error || !client) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const hash = hashPassword(password);
  const isMainPassword = hash === client.password_hash;
  const isTempPassword = hash === client.temp_password_hash;

  if (!isMainPassword && !isTempPassword) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // ── Détecter si le branding est à configurer ──────────────────────────────
  const needsBranding = !client.branding_status || client.branding_status === 'pending';

  // Créer la session
  const token = generateToken();
  sessions[token] = {
    clientId:          client.id,
    clientName:        client.name,
    createdAt:         Date.now(),
    expiresAt:         Date.now() + 7 * 24 * 60 * 60 * 1000,
    mustChangePassword: isTempPassword || client.first_login,
    needsBranding
  };

  res.json({
    success:            true,
    token,
    clientId:           client.id,
    clientName:         client.name,
    mustChangePassword: isTempPassword || client.first_login,
    // ← Le front-end utilise ce flag pour rediriger vers branding-setup.html
    needsBranding
  });
});

// ─────────────────────────────────────────────
// POST /api/auth/set-password
// ─────────────────────────────────────────────
router.post('/set-password', requireAuth, async (req, res) => {
  const { password } = req.body;
  const clientId = req.session.clientId;

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
  }

  const hash = hashPassword(password);

  const { error } = await supabase
    .from('clients')
    .update({
      password_hash:      hash,
      temp_password_hash: null,
      first_login:        false
    })
    .eq('id', clientId);

  if (error) return res.status(500).json({ error: error.message });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (sessions[token]) sessions[token].mustChangePassword = false;

  res.json({ success: true });
});

// ─────────────────────────────────────────────
// POST /api/auth/reset-password (admin)
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { clientId, adminKey } = req.body;

  if ((adminKey || '') !== (process.env.ADMIN_KEY || 'socialai_admin_2026')) {
    return res.status(403).json({ error: 'Clé admin invalide' });
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, email')
    .eq('id', clientId)
    .single();

  if (error || !client) return res.status(404).json({ error: 'Client introuvable' });
  if (!client.email)    return res.status(400).json({ error: 'Ce client n\'a pas d\'email configuré' });

  const tempPassword = generateTempPassword();
  const tempHash     = hashPassword(tempPassword);

  await supabase.from('clients').update({
    temp_password_hash: tempHash,
    first_login:        true
  }).eq('id', clientId);

  const appUrl = process.env.APP_URL || 'https://socialai-production-5ffb.up.railway.app';
  await sendEmail(
    client.email,
    'Votre nouveau mot de passe provisoire — SocialAI',
    `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
      <div style="font-size:24px;font-weight:700;margin-bottom:8px">🔑 Nouveau mot de passe</div>
      <p style="color:#c8c6be;margin-bottom:24px">Bonjour ${client.name},<br>Voici votre mot de passe provisoire pour accéder à votre espace SocialAI.</p>
      <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:13px;color:#7a7870;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Mot de passe provisoire</div>
        <div style="font-size:22px;font-weight:700;font-family:monospace;color:#ff4d6d;letter-spacing:2px">${tempPassword}</div>
      </div>
      <p style="color:#c8c6be;font-size:13px;margin-bottom:20px">⚠️ Ce mot de passe est provisoire. Vous devrez en choisir un nouveau lors de votre connexion.</p>
      <a href="${appUrl}/login.html" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px">
        Accéder à mon espace →
      </a>
      <p style="color:#7a7870;font-size:11px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    </div>
    `
  );

  res.json({ success: true, message: `Mot de passe provisoire envoyé à ${client.email}` });
});

// ─────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = sessions[token];
  if (!session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: 'Session expirée' });
  }
  res.json({
    clientId:           session.clientId,
    clientName:         session.clientName,
    mustChangePassword: session.mustChangePassword || false,
    needsBranding:      session.needsBranding      || false
  });
});

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions[token]) delete sessions[token];
  res.json({ success: true });
});

module.exports = { router, requireAuth };