// routes/romi.js
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const axios = require('axios');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────
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
      sender: 'SocialAI',
      recipient: to.replace(/\s/g,''),
      content: message
    }, {
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }
    });
    console.log(`📱 SMS envoyé à ${to}`);
  } catch(err) { console.error('❌ SMS:', err.message); }
}

// ─────────────────────────────────────────────
// TEMPLATES EMAIL
// ─────────────────────────────────────────────
function emailPresentation(prospect) {
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:4px">✦ Aria — Community Manager IA</div>
    <div style="font-size:12px;color:#7a7870;margin-bottom:28px;text-transform:uppercase;letter-spacing:1px">Votre présence Instagram, automatisée</div>

    <p style="color:#c8c6be;line-height:1.7;margin-bottom:20px">
      Bonjour ${prospect.manager_name ? prospect.manager_name : ''},<br><br>
      Je me permets de vous contacter au sujet de <strong style="color:#f5f4f0">${prospect.company_name}</strong>.
      J'ai remarqué votre activité dans le secteur <strong style="color:#f5f4f0">${prospect.sector || 'de votre domaine'}</strong>
      et je pense qu'Aria pourrait vous faire gagner un temps précieux.
    </p>

    <div style="background:#1a1a26;border:1px solid #3a3a50;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:600;color:#ff4d6d;margin-bottom:12px">🤖 Aria s'occupe de tout :</div>
      <div style="font-size:13px;color:#c8c6be;line-height:2">
        ✅ Publications Instagram automatiques (photos, vidéos, carousels)<br>
        ✅ Réponses aux commentaires et messages privés<br>
        ✅ Analyse de vos meilleures performances<br>
        ✅ Tendances du secteur en temps réel<br>
        ✅ Zéro intervention de votre part
      </div>
    </div>

    <p style="color:#c8c6be;font-size:13px;margin-bottom:24px">
      Seriez-vous disponible pour un appel de 15 minutes cette semaine ?<br>
      Je vous explique comment ça fonctionne concrètement.
    </p>

    <a href="mailto:${process.env.GMAIL_USER}" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px">
      Répondre →
    </a>

    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #3a3a50;font-size:11px;color:#7a7870">
      Cet email vous a été envoyé par Aria — Community Manager IA<br>
      Pour ne plus recevoir nos emails : <a href="mailto:${process.env.GMAIL_USER}?subject=Désinscription" style="color:#7a7870">se désinscrire</a>
    </div>
  </div>`;
}

function emailRelance(prospect) {
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:28px">✦ Une petite relance 👋</div>
    <p style="color:#c8c6be;line-height:1.7;margin-bottom:20px">
      Bonjour ${prospect.manager_name || ''},<br><br>
      Je reviens vers vous suite à mon précédent message concernant <strong style="color:#f5f4f0">${prospect.company_name}</strong>.
      Je n'ai pas eu de retour de votre part et je voulais m'assurer que vous l'aviez bien reçu.
    </p>
    <p style="color:#c8c6be;font-size:13px;margin-bottom:24px">
      Si le timing n'est pas idéal, pas de souci — je reste disponible quand vous le souhaitez.<br>
      Un simple appel de 10 minutes suffit pour voir si Aria peut vous aider.
    </p>
    <a href="mailto:${process.env.GMAIL_USER}" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px">
      Répondre →
    </a>
  </div>`;
}

// ─────────────────────────────────────────────
// PROSPECTS — CRUD
// ─────────────────────────────────────────────
router.get('/prospects', async (req, res) => {
  const { status, sector, search, limit = 50, offset = 0 } = req.query;
  let query = supabase.from('prospects').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (sector) query = query.eq('sector', sector);
  if (search) query = query.or(`company_name.ilike.%${search}%,manager_name.ilike.%${search}%,phone.ilike.%${search}%`);
  query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/prospects/:id', async (req, res) => {
  const { data, error } = await supabase.from('prospects').select('*, rdv(*)').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/prospects', async (req, res) => {
  const { data, error } = await supabase.from('prospects').insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/prospects/:id', async (req, res) => {
  const updates = { ...req.body, last_contact_at: new Date().toISOString() };
  const { data, error } = await supabase.from('prospects').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/prospects/:id', async (req, res) => {
  const { error } = await supabase.from('prospects').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// STATS DASHBOARD
// ─────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { data: all } = await supabase.from('prospects').select('status, interest_level, created_at, email_sent_at');
    const { data: rdvs } = await supabase.from('rdv').select('*').gte('scheduled_at', new Date().toISOString()).eq('status', 'planifie');
    const total         = all?.length || 0;
    const chauds        = all?.filter(p => p.interest_level === 'chaud').length || 0;
    const rdvPlanifies  = all?.filter(p => p.status === 'rdv').length || 0;
    const clients       = all?.filter(p => p.status === 'client').length || 0;
    const emailsEnvoyes = all?.filter(p => p.email_sent_at).length || 0;
    const tauxConversion = total > 0 ? ((clients / total) * 100).toFixed(1) : 0;
    res.json({ total, chauds, rdvPlanifies, clients, emailsEnvoyes, tauxConversion, prochainsRdv: rdvs || [] });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────
// RDV
// ─────────────────────────────────────────────
router.get('/rdv', async (req, res) => {
  const { data, error } = await supabase
    .from('rdv').select('*, prospects(company_name, manager_name, phone, sector, interest_level, notes)')
    .order('scheduled_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/rdv', async (req, res) => {
  const { data, error } = await supabase.from('rdv').insert([req.body]).select('*, prospects(*)').single();
  if (error) return res.status(500).json({ error: error.message });
  // Mettre à jour le statut du prospect
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

// ─────────────────────────────────────────────
// ENVOI EMAIL PRÉSENTATION
// ─────────────────────────────────────────────
router.post('/prospects/:id/send-email', async (req, res) => {
  const { type = 'presentation' } = req.body;
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  if (!prospect.email) return res.status(400).json({ error: 'Pas d\'email pour ce prospect' });

  const subject = type === 'relance'
    ? `Relance — Aria, votre Community Manager IA 🤖`
    : `${prospect.company_name} — Et si l'IA gérait votre Instagram ? 🚀`;
  const html = type === 'relance' ? emailRelance(prospect) : emailPresentation(prospect);

  await sendEmail(prospect.email, subject, html);
  const update = type === 'relance'
    ? { relance_sent_at: new Date().toISOString(), status: 'contacté' }
    : { email_sent_at: new Date().toISOString(), status: 'contacté' };
  await supabase.from('prospects').update(update).eq('id', req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SMS RAPPEL RDV
// ─────────────────────────────────────────────
router.post('/rdv/:id/send-sms', async (req, res) => {
  const { data: rdv } = await supabase.from('rdv').select('*, prospects(*)').eq('id', req.params.id).single();
  if (!rdv) return res.status(404).json({ error: 'RDV introuvable' });
  const prospect = rdv.prospects;
  if (!prospect?.phone) return res.status(400).json({ error: 'Pas de téléphone' });
  const date = new Date(rdv.scheduled_at);
  const dateStr = date.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
  const sms = `Bonjour ${prospect.manager_name||''}, rappel de votre RDV avec Aria (Community Manager IA) le ${dateStr}. À très vite !`;
  await sendBrevoSMS(prospect.phone, sms);
  await supabase.from('rdv').update({ reminder_sent: true }).eq('id', req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// SCRIPT D'APPEL GÉNÉRÉ PAR L'IA
// ─────────────────────────────────────────────
router.get('/prospects/:id/script', async (req, res) => {
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Tu es Romi, l'assistant de prospection d'Aria (agence de community management IA).
Tu dois générer un script d'appel téléphonique personnalisé pour prospecter cette entreprise.

Informations sur le prospect :
- Entreprise : ${prospect.company_name}
- Gérant : ${prospect.manager_name || 'Inconnu'}
- Secteur : ${prospect.sector || 'Non précisé'}
- Déjà sur Instagram : ${prospect.has_instagram ? 'Oui' : 'Non'}
- A déjà un CM : ${prospect.has_cm ? 'Oui' : 'Non'}
- Niveau d'intérêt : ${prospect.interest_level || 'Nouveau contact'}
- Objection principale : ${prospect.main_objection || 'Aucune connue'}
- Notes : ${prospect.notes || 'Aucune'}

Génère un script naturel, conversationnel, avec :
1. L'accroche (10 secondes max)
2. La présentation d'Aria (30 secondes)
3. La question de qualification
4. Les réponses aux objections courantes
5. La demande de RDV

Format : utilise des emojis pour les sections, sois direct et humain. Maximum 300 mots.`
      }]
    });
    res.json({ script: response.content[0].text });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────
// RECHERCHE GOOGLE PLACES
// ─────────────────────────────────────────────
router.post('/search/google', async (req, res) => {
  const { query, city } = req.body;
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return res.status(400).json({ error: 'Clé Google Places non configurée' });
  }
  try {
    const searchQuery = `${query} ${city || ''}`;
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: { query: searchQuery, key: process.env.GOOGLE_PLACES_API_KEY, language: 'fr' }
    });
    const results = (response.data.results || []).slice(0, 20).map(p => ({
      company_name: p.name,
      city: p.formatted_address?.split(',').slice(-2, -1)[0]?.trim() || '',
      sector: query,
      phone: p.formatted_phone_number || '',
      source: 'google',
      status: 'nouveau'
    }));
    res.json(results);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────
// IMPORT CSV
// ─────────────────────────────────────────────
router.post('/import/csv', async (req, res) => {
  const { prospects } = req.body; // Array de prospects parsés côté client
  if (!prospects?.length) return res.status(400).json({ error: 'Aucun prospect à importer' });
  const toInsert = prospects.map(p => ({
    company_name: p.company_name || p['Entreprise'] || p['Nom'] || '',
    manager_name: p.manager_name || p['Gérant'] || p['Contact'] || '',
    phone:        p.phone || p['Téléphone'] || p['Tel'] || '',
    email:        p.email || p['Email'] || '',
    sector:       p.sector || p['Secteur'] || '',
    city:         p.city || p['Ville'] || '',
    source:       'csv',
    status:       'nouveau'
  })).filter(p => p.company_name);
  const { data, error } = await supabase.from('prospects').insert(toInsert).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, imported: data.length });
});

// ─────────────────────────────────────────────
// RAPPELS AUTOMATIQUES — vérifié toutes les 30 min
// ─────────────────────────────────────────────
async function checkReminders() {
  try {
    // RDV dans 30 minutes → SMS
    const in30 = new Date(Date.now() + 30 * 60 * 1000);
    const now  = new Date();
    const { data: upcoming } = await supabase
      .from('rdv').select('*, prospects(*)')
      .eq('reminder_sent', false).eq('status', 'planifie')
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', in30.toISOString());

    for (const rdv of upcoming || []) {
      if (rdv.prospects?.phone) {
        const date = new Date(rdv.scheduled_at);
        const dateStr = date.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        await sendBrevoSMS(rdv.prospects.phone, `Rappel : votre RDV avec Aria est dans 30 minutes (${dateStr}). À tout de suite !`);
        await supabase.from('rdv').update({ reminder_sent: true }).eq('id', rdv.id);
      }
    }

    // Prospects à relancer (contactés il y a 7 jours sans réponse)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: toRelance } = await supabase
      .from('prospects').select('*')
      .eq('status', 'contacté')
      .is('relance_sent_at', null)
      .lte('email_sent_at', sevenDaysAgo);

    for (const p of toRelance || []) {
      if (p.email) await sendEmail(p.email, `Relance — Aria, votre Community Manager IA 🤖`, emailRelance(p));
      await supabase.from('prospects').update({ relance_sent_at: new Date().toISOString() }).eq('id', p.id);
    }
  } catch(err) { console.error('❌ Rappels:', err.message); }
}

setInterval(checkReminders, 30 * 60 * 1000);
checkReminders();

module.exports = router;
// rebuild
