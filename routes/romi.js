// routes/romi.js v3
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const axios = require('axios');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function sendEmail(to, subject, html) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    await transporter.sendMail({ from: `Aria — SocialAI <${process.env.GMAIL_USER}>`, to, subject, html });
    console.log(`📧 Email envoyé à ${to}`);
  } catch(err) { console.error('❌ Email:', err.message); }
}

async function sendBrevoSMS(to, message) {
  try {
    await axios.post('https://api.brevo.com/v3/transactionalSMS/sms', {
      sender: 'SocialAI', recipient: to.replace(/\s/g,''), content: message
    }, { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } });
  } catch(err) { console.error('❌ SMS:', err.message); }
}

function emailPresentation(prospect) {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:4px">✦ Aria — Community Manager IA</div>
    <p style="color:#c8c6be;line-height:1.7;margin-bottom:20px">Bonjour ${prospect.manager_name || ''},<br><br>
    Je me permets de vous contacter au sujet de <strong>${prospect.company_name}</strong>. Aria pourrait vous faire gagner un temps précieux sur votre présence Instagram.</p>
    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:13px;color:#c8c6be;line-height:2">✅ Publications automatiques · ✅ Réponses DM · ✅ Stratégie commerciale · ✅ Zéro effort de votre part</div>
    </div>
    <a href="mailto:${process.env.GMAIL_USER}" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">Répondre →</a>
  </div>`;
}

function emailRelance(prospect) {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:28px">✦ Une petite relance 👋</div>
    <p style="color:#c8c6be;line-height:1.7;margin-bottom:20px">Bonjour ${prospect.manager_name || ''},<br><br>
    Je reviens vers vous concernant <strong>${prospect.company_name}</strong>. Un appel de 10 minutes suffit pour voir si Aria peut vous aider.</p>
    <a href="mailto:${process.env.GMAIL_USER}" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">Répondre →</a>
  </div>`;
}

// ── PROSPECTS CRUD ────────────────────────────────────────────────────────────
router.get('/prospects', async (req, res) => {
  const { status, sector, search, limit = 100, offset = 0 } = req.query;
  let query = supabase.from('prospects').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (sector) query = query.eq('sector', sector);
  if (search) query = query.or(`company_name.ilike.%${search}%,manager_name.ilike.%${search}%,phone.ilike.%${search}%`);
  query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/prospects/:id', async (req, res) => {
  const { data, error } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/prospects', async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.history || !Array.isArray(body.history)) body.history = [];
    Object.keys(body).forEach(k => { if (body[k] === undefined) delete body[k]; });
    const { data, error } = await supabase.from('prospects').insert([body]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(err) {
    console.error('❌ POST prospect:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/prospects/:id', async (req, res) => {
  try {
    const updates = { ...req.body, last_contact_at: new Date().toISOString() };
    Object.keys(updates).forEach(k => { if (updates[k] === undefined) delete updates[k]; });
    const { data, error } = await supabase.from('prospects').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/prospects/:id', async (req, res) => {
  const { error } = await supabase.from('prospects').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { data: all } = await supabase.from('prospects').select('status, interest_level, created_at, email_sent_at');
    const { data: rdvs } = await supabase.from('rdv').select('*').gte('scheduled_at', new Date().toISOString()).eq('status', 'planifie');
    const total = all?.length || 0;
    res.json({
      total,
      chauds:         all?.filter(p => p.interest_level === 'chaud').length || 0,
      rdvPlanifies:   all?.filter(p => p.status === 'rdv').length || 0,
      clients:        all?.filter(p => p.status === 'client').length || 0,
      emailsEnvoyes:  all?.filter(p => p.email_sent_at).length || 0,
      tauxConversion: total > 0 ? ((all.filter(p => p.status === 'client').length / total) * 100).toFixed(1) : 0,
      prochainsRdv:   rdvs || []
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── RDV ───────────────────────────────────────────────────────────────────────
router.get('/rdv', async (req, res) => {
  const { data, error } = await supabase
    .from('rdv').select('*, prospects(company_name, manager_name, phone, sector)')
    .order('scheduled_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/rdv', async (req, res) => {
  const { data, error } = await supabase.from('rdv').insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('prospects').update({ status: 'rdv' }).eq('id', req.body.prospect_id);
  res.json(data);
});

router.put('/rdv/:id', async (req, res) => {
  const { data, error } = await supabase.from('rdv').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/rdv/:id', async (req, res) => {
  const { error } = await supabase.from('rdv').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── EMAIL ─────────────────────────────────────────────────────────────────────
router.post('/prospects/:id/send-email', async (req, res) => {
  const { type = 'presentation' } = req.body;
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  if (!prospect.email) return res.status(400).json({ error: 'Pas d\'email pour ce prospect' });
  const subject = type === 'relance'
    ? `Relance — Aria, votre Community Manager IA 🤖`
    : `${prospect.company_name} — Et si l'IA gérait votre Instagram ? 🚀`;
  await sendEmail(prospect.email, subject, type === 'relance' ? emailRelance(prospect) : emailPresentation(prospect));
  await supabase.from('prospects').update(
    type === 'relance'
      ? { relance_sent_at: new Date().toISOString(), status: 'contacté' }
      : { email_sent_at: new Date().toISOString(), status: 'contacté' }
  ).eq('id', req.params.id);
  res.json({ success: true });
});

// ── RECHERCHE GOOGLE PLACES avec téléphones ───────────────────────────────────
router.post('/search/google', async (req, res) => {
  const { query, city } = req.body;
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return res.status(400).json({ error: 'Clé Google Places non configurée' });
  }
  try {
    const searchResponse = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: { query: `${query} ${city || ''}`, key: process.env.GOOGLE_PLACES_API_KEY, language: 'fr' }
    });

    const places = (searchResponse.data.results || []).slice(0, 10);

    // Récupérer les détails (téléphone) pour chaque lieu
    const results = await Promise.all(places.map(async (p) => {
      let phone = '';
      try {
        const detailResponse = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
          params: {
            place_id: p.place_id,
            fields: 'formatted_phone_number,international_phone_number',
            key: process.env.GOOGLE_PLACES_API_KEY,
            language: 'fr'
          }
        });
        phone = detailResponse.data.result?.formatted_phone_number ||
                detailResponse.data.result?.international_phone_number || '';
      } catch(e) {
        console.error('❌ Place details:', e.message);
      }

      return {
        company_name: p.name,
        city: p.formatted_address?.split(',').slice(-2, -1)[0]?.trim() || city || '',
        sector: query,
        phone,
        source: 'Google Maps',
        status: 'new'
      };
    }));

    res.json(results);
  } catch(err) {
    console.error('❌ Google Places:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── IMPORT CSV ────────────────────────────────────────────────────────────────
router.post('/import/csv', async (req, res) => {
  const { prospects } = req.body;
  if (!prospects?.length) return res.status(400).json({ error: 'Aucun prospect à importer' });
  const toInsert = prospects.map(p => ({
    company_name: p.company_name || p['Entreprise'] || p['Nom'] || '',
    manager_name: p.manager_name || p['Gérant'] || p['Contact'] || '',
    phone:        p.phone || p['Téléphone'] || p['Tel'] || '',
    email:        p.email || p['Email'] || '',
    sector:       p.sector || p['Secteur'] || '',
    city:         p.city || p['Ville'] || '',
    source: 'csv', status: 'new', history: []
  })).filter(p => p.company_name);
  const { data, error } = await supabase.from('prospects').insert(toInsert).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, imported: data.length });
});

// ── SCRIPT IA ─────────────────────────────────────────────────────────────────
router.get('/prospects/:id/script', async (req, res) => {
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 600,
      messages: [{ role: 'user', content: `Tu es Romi, assistant de prospection d'Aria (community management IA, Pertuis).
Script d'appel pour : ${prospect.company_name} · ${prospect.sector||''} · ${prospect.city||''} · Instagram: ${prospect.instagram||'non'} · Intérêt: ${prospect.interest_level||'nouveau'} · Notes: ${prospect.notes||'aucune'}
Inclus: accroche 10s, présentation Aria 30s, qualification, objections, demande RDV. Argument local Pertuis. Tarif 149€/3 mois puis 199€. 300 mots max.` }]
    });
    res.json({ script: response.content[0].text });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── RAPPELS AUTO ──────────────────────────────────────────────────────────────
async function checkReminders() {
  try {
    const in30 = new Date(Date.now() + 30 * 60 * 1000);
    const now  = new Date();
    const { data: upcoming } = await supabase.from('rdv').select('*, prospects(*)')
      .eq('reminder_sent', false).eq('status', 'planifie')
      .gte('scheduled_at', now.toISOString()).lte('scheduled_at', in30.toISOString());
    for (const rdv of upcoming || []) {
      if (rdv.prospects?.phone) {
        const dateStr = new Date(rdv.scheduled_at).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        await sendBrevoSMS(rdv.prospects.phone, `Rappel RDV Aria dans 30 minutes (${dateStr}). À tout de suite !`);
        await supabase.from('rdv').update({ reminder_sent: true }).eq('id', rdv.id);
      }
    }
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: toRelance } = await supabase.from('prospects').select('*')
      .eq('status', 'contacté').is('relance_sent_at', null).lte('email_sent_at', sevenDaysAgo);
    for (const p of toRelance || []) {
      if (p.email) await sendEmail(p.email, `Relance — Aria, votre Community Manager IA 🤖`, emailRelance(p));
      await supabase.from('prospects').update({ relance_sent_at: new Date().toISOString() }).eq('id', p.id);
    }
  } catch(err) { console.error('❌ Rappels:', err.message); }
}

setInterval(checkReminders, 30 * 60 * 1000);

module.exports = router;