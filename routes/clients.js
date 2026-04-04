// routes/clients.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function hashPassword(password) {
  const secret = process.env.SESSION_SECRET || 'socialai_secret_2026';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function generateTempPassword() {
  const words1 = ['Rose','Lune','Ciel','Mer','Fleur','Soleil','Étoile','Nuage'];
  const words2 = ['Douce','Bleue','Belle','Libre','Vive','Claire','Pure'];
  const num = Math.floor(Math.random() * 90) + 10;
  const w1 = words1[Math.floor(Math.random() * words1.length)];
  const w2 = words2[Math.floor(Math.random() * words2.length)];
  return `${w1}-${num}-${w2}`;
}

async function sendWelcomeEmail(client, tempPassword) {
  if (!client.email) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const appUrl = process.env.APP_URL || 'https://socialai-production-5ffb.up.railway.app';

    await transporter.sendMail({
      from: `SocialAI <${process.env.GMAIL_USER}>`,
      to: client.email,
      subject: `Bienvenue sur SocialAI — Votre espace est prêt ! 🚀`,
      html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
        <div style="font-size:26px;font-weight:700;margin-bottom:4px">✦ Bienvenue sur SocialAI</div>
        <div style="font-size:14px;color:#7a7870;margin-bottom:24px;text-transform:uppercase;letter-spacing:1px">Votre espace community manager</div>

        <p style="color:#c8c6be;margin-bottom:20px">Bonjour <strong style="color:#f5f4f0">${client.name}</strong> 👋<br><br>
        Votre espace SocialAI est maintenant prêt ! Vous pouvez consulter vos posts planifiés, modifier les captions et demander des publications spéciales.</p>

        <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:12px;padding:20px;margin-bottom:24px">
          <div style="font-size:12px;color:#7a7870;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Vos identifiants de connexion</div>
          <div style="margin-bottom:8px">
            <span style="font-size:12px;color:#7a7870">Email :</span>
            <span style="font-size:14px;color:#f5f4f0;margin-left:8px;font-family:monospace">${client.email}</span>
          </div>
          <div>
            <span style="font-size:12px;color:#7a7870">Mot de passe provisoire :</span>
            <div style="font-size:20px;font-weight:700;font-family:monospace;color:#ff4d6d;letter-spacing:2px;margin-top:6px">${tempPassword}</div>
          </div>
        </div>

        <p style="color:#c8c6be;font-size:13px;margin-bottom:20px">⚠️ Ce mot de passe est provisoire. Lors de votre première connexion, vous serez invité(e) à en choisir un personnel.</p>

        <a href="${appUrl}/login.html" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;letter-spacing:0.3px">
          Accéder à mon espace →
        </a>

        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #3a3a50;font-size:11px;color:#7a7870">
          Cet email a été envoyé automatiquement par SocialAI.<br>
          En cas de problème, contactez votre community manager.
        </div>
      </div>
      `
    });
    console.log(`📧 Email de bienvenue envoyé à ${client.email}`);
  } catch (err) {
    console.error('❌ Erreur email bienvenue:', err.message);
  }
}

// ── GET /api/clients ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/clients ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, sector, instagram, facebook, tone, plan, email, description, solo_entrepreneur, google_place_id } = req.body;

  const tempPassword = generateTempPassword();
  const tempHash = hashPassword(tempPassword);

  const insertData = {
    name,
    sector,
    instagram,
    facebook,
    tone,
    plan,
    description:        description || '',
    solo_entrepreneur:  solo_entrepreneur !== false,
    google_place_id:    google_place_id || null,
    status:             'active',
    // Auth
    email:              email ? email.toLowerCase().trim() : null,
    temp_password_hash: tempHash,
    password_hash:      null,
    portal_access:      email ? true : false,
    first_login:        true
  };

  const { data, error } = await supabase
    .from('clients')
    .insert([insertData])
    .select();

  if (error) return res.status(500).json({ error: error.message });

  const client = data[0];

  if (email) {
    await sendWelcomeEmail({ ...client, email }, tempPassword);
  }

  res.json({
    ...client,
    tempPassword: email ? undefined : tempPassword
  });
});

// ── PUT /api/clients/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  if (updates.email) {
    updates.email = updates.email.toLowerCase().trim();
    updates.portal_access = true;
  }

  delete updates.password_hash;
  delete updates.temp_password_hash;

  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// ── DELETE /api/clients/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/clients/:id/resend-welcome ──────────────────────────────────────
router.post('/:id/resend-welcome', async (req, res) => {
  const { id } = req.params;
  const { adminKey } = req.body;

  if ((adminKey || '') !== (process.env.ADMIN_KEY || 'socialai_admin_2026')) {
    return res.status(403).json({ error: 'Clé admin invalide' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single();

  if (!client?.email) return res.status(400).json({ error: 'Pas d\'email pour ce client' });

  const tempPassword = generateTempPassword();
  const tempHash = hashPassword(tempPassword);

  await supabase.from('clients').update({
    temp_password_hash: tempHash,
    first_login: true
  }).eq('id', id);

  await sendWelcomeEmail(client, tempPassword);

  res.json({ success: true });
});

module.exports = router;