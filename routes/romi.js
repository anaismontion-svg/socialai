// routes/romi.js v4 — Zone chalandise + Pages Jaunes + Enrichissement + Analyse IA
const express  = require('express');
const router   = express.Router();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const axios = require('axios');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── EMAILS ────────────────────────────────────────────────────────────────────
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

function buildEmailHtml(prospect, customBody) {
  const body = customBody || `Bonjour ${prospect.manager_name || ''},\n\nJe me permets de vous contacter au sujet de ${prospect.company_name}.\n\nAria, notre IA spécialisée, peut gérer votre présence Instagram 7j/7 :\n✅ Publications automatiques (photos, vidéos, carousels)\n✅ Réponses aux messages et commentaires\n✅ Stratégie commerciale adaptée à votre secteur\n✅ Zéro effort de votre part\n\nTarif : 149€/mois les 3 premiers mois, puis 199€. Sans engagement.\n\nSeriez-vous disponible pour une démo de 20 minutes cette semaine ?\n\nCordialement,\nL'équipe SocialAI — Pertuis`;
  const htmlBody = body.replace(/\n/g, '<br>');
  return `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:36px;background:#0d0d14;color:#f5f4f0;border-radius:16px">
    <div style="font-size:22px;font-weight:700;margin-bottom:24px">✦ Aria — Community Manager IA</div>
    <div style="font-size:14px;color:#c8c6be;line-height:1.8;margin-bottom:28px">${htmlBody}</div>
    <a href="mailto:${process.env.GMAIL_USER}" style="display:inline-block;background:linear-gradient(135deg,#ff4d6d,#cc2244);color:white;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;font-size:14px">Répondre →</a>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #2a2a3e;font-size:11px;color:#555570">
      SocialAI · Pertuis · <a href="mailto:${process.env.GMAIL_USER}?subject=Désinscription" style="color:#555570">Se désinscrire</a>
    </div>
  </div>`;
}

function emailRelance(prospect) {
  return buildEmailHtml(prospect, `Bonjour ${prospect.manager_name || ''},\n\nJe reviens vers vous suite à notre précédent échange concernant ${prospect.company_name}.\n\nAria pourrait vraiment faire la différence pour votre activité. Un simple appel de 10 minutes suffit pour le vérifier.\n\nDisponible cette semaine ?`);
}

// ── PROSPECTS CRUD ────────────────────────────────────────────────────────────
router.get('/prospects', async (req, res) => {
  const { status, sector, search, limit = 200, offset = 0 } = req.query;
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
    // Vérifier doublon par nom
    const { data: existing } = await supabase.from('prospects')
      .select('id').ilike('company_name', body.company_name).limit(1);
    if (existing?.length) return res.json({ ...existing[0], _duplicate: true });
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

// ── EMAIL PRÉSENTATION (modifiable + envoi) ───────────────────────────────────
router.get('/prospects/:id/email-draft', async (req, res) => {
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  const defaultBody = `Bonjour ${prospect.manager_name || prospect.company_name || ''},\n\nJe me permets de vous contacter au sujet de ${prospect.company_name}.\n\nAria, notre IA spécialisée dans le community management, peut gérer votre présence Instagram 7j/7 automatiquement :\n\n✅ Publications photos et vidéos de vos chantiers\n✅ Réponses aux messages clients (même à 22h)\n✅ Stratégie adaptée aux ${prospect.sector || 'artisans'} de la région\n✅ Zéro effort de votre part — juste envoyer vos photos sur WhatsApp\n\nTarif : 149€/mois les 3 premiers mois, puis 199€. Sans engagement.\n\nSeriez-vous disponible pour une démo de 20 minutes cette semaine ? Je me déplace volontiers sur ${prospect.city || 'votre secteur'}.\n\nCordialement,\nL'équipe SocialAI — Pertuis`;
  res.json({
    subject: `${prospect.company_name} — Aria gère votre Instagram à votre place 🚀`,
    body: defaultBody,
    prospect
  });
});

router.post('/prospects/:id/send-email', async (req, res) => {
  const { type = 'presentation', subject, body } = req.body;
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  if (!prospect.email) return res.status(400).json({ error: 'Pas d\'email pour ce prospect' });
  const finalSubject = subject || (type === 'relance' ? `Relance — Aria, votre Community Manager IA 🤖` : `${prospect.company_name} — Aria gère votre Instagram 🚀`);
  const html = body ? buildEmailHtml(prospect, body) : (type === 'relance' ? emailRelance(prospect) : buildEmailHtml(prospect, null));
  await sendEmail(prospect.email, finalSubject, html);
  await supabase.from('prospects').update(
    type === 'relance'
      ? { relance_sent_at: new Date().toISOString(), status: 'contacté' }
      : { email_sent_at: new Date().toISOString(), status: 'contacté' }
  ).eq('id', req.params.id);
  res.json({ success: true });
});

// ── ANALYSE IA DES NOTES ──────────────────────────────────────────────────────
router.post('/prospects/:id/analyze', async (req, res) => {
  const { notes } = req.body;
  if (!notes || notes.trim().length < 10) return res.json({ interested: false, suggestion: null });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 200,
      messages: [{ role: 'user', content: `Analyse ces notes de prospection commerciale et réponds en JSON uniquement:
Notes: "${notes}"
Réponds avec: {"interested": true/false, "level": "chaud/tiede/froid", "suggestion": "court message d'action recommandée ou null", "send_email": true/false}
interested=true si la personne montre un intérêt (veut démo, veut infos, intéressé, rappeler, curieux).
send_email=true seulement si clairement intéressé et a un email.
Réponds UNIQUEMENT avec le JSON, rien d'autre.` }]
    });
    const text = response.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    // Mettre à jour le niveau d'intérêt
    if (result.level) {
      await supabase.from('prospects').update({ interest_level: result.level }).eq('id', req.params.id);
    }
    res.json(result);
  } catch(err) {
    console.error('❌ Analyse IA:', err.message);
    res.json({ interested: false, suggestion: null });
  }
});

// ── RECHERCHE GOOGLE PLACES par zone de chalandise ────────────────────────────
router.post('/search/google', async (req, res) => {
  const { query, city, lat, lng, radius = 30000 } = req.body;
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return res.status(400).json({ error: 'Clé Google Places non configurée' });
  }
  try {
    let params;
    if (lat && lng) {
      // Recherche par coordonnées GPS + rayon
      params = { query, location: `${lat},${lng}`, radius: parseInt(radius), key: process.env.GOOGLE_PLACES_API_KEY, language: 'fr' };
    } else {
      params = { query: `${query} ${city || ''}`, key: process.env.GOOGLE_PLACES_API_KEY, language: 'fr' };
    }
    const searchResponse = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', { params });
    const places = (searchResponse.data.results || []).slice(0, 10);
    const results = await Promise.all(places.map(async (p) => {
      let phone = '', website = '';
      try {
        const detailResponse = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
          params: {
            place_id: p.place_id,
            fields: 'formatted_phone_number,international_phone_number,website',
            key: process.env.GOOGLE_PLACES_API_KEY,
            language: 'fr'
          }
        });
        phone = detailResponse.data.result?.formatted_phone_number || detailResponse.data.result?.international_phone_number || '';
        website = detailResponse.data.result?.website || '';
      } catch(e) { console.error('❌ Place details:', e.message); }
      return {
        company_name: p.name,
        city: p.formatted_address?.split(',').slice(-2,-1)[0]?.trim() || city || '',
        address: p.formatted_address || '',
        sector: query,
        phone, website,
        source: 'Google Maps',
        status: 'new',
        lat: p.geometry?.location?.lat,
        lng: p.geometry?.location?.lng
      };
    }));
    res.json(results);
  } catch(err) {
    console.error('❌ Google Places:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GÉOCODAGE ville → coordonnées GPS ────────────────────────────────────────
router.get('/geocode', async (req, res) => {
  const { city } = req.query;
  if (!city) return res.status(400).json({ error: 'Ville requise' });
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: `${city}, France`, key: process.env.GOOGLE_PLACES_API_KEY, language: 'fr' }
    });
    const result = response.data.results?.[0];
    if (!result) return res.status(404).json({ error: 'Ville non trouvée' });
    res.json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted: result.formatted_address
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── SCRAPING PAGES JAUNES ─────────────────────────────────────────────────────
router.post('/search/pagesjaunesearch', async (req, res) => {
  const { query, city } = req.body;
  try {
    const searchUrl = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(query)}&ou=${encodeURIComponent(city + ', France')}&univers=pagesjaunes&idOu=`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://www.pagesjaunes.fr/'
      },
      timeout: 10000
    });
    const html = response.data;
    const results = [];
    // Extraction noms
    const nameRegex = /class="denomination-links[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;
    const phoneRegex = /href="tel:([^"]+)"/g;
    const addressRegex = /class="adresse[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/g;
    let nameMatch, phoneMatch, addrMatch;
    const names = [], phones = [], addresses = [];
    while ((nameMatch = nameRegex.exec(html)) !== null) names.push(nameMatch[1].trim());
    while ((phoneMatch = phoneRegex.exec(html)) !== null) phones.push(phoneMatch[1].replace(/\s/g,'').replace(/^0033/,'+33').replace(/^\+33/,'0').replace(/(\d{2})(?=\d)/g,'$1 ').trim());
    while ((addrMatch = addressRegex.exec(html)) !== null) {
      const addr = addrMatch[1].replace(/<[^>]+>/g,'').trim();
      if (addr.length > 5) addresses.push(addr);
    }
    const count = Math.min(names.length, 10);
    for (let i = 0; i < count; i++) {
      if (names[i]) results.push({
        company_name: names[i],
        phone: phones[i] || '',
        city: city,
        sector: query,
        source: 'Pages Jaunes',
        status: 'new'
      });
    }
    res.json(results);
  } catch(err) {
    console.error('❌ Pages Jaunes:', err.message);
    res.json([]); // Ne pas bloquer si PJ échoue
  }
});

// ── SCRIPT IA PERSONNALISÉ ────────────────────────────────────────────────────
router.get('/prospects/:id/script', async (req, res) => {
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', req.params.id).single();
  if (!prospect) return res.status(404).json({ error: 'Prospect introuvable' });
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 800,
      messages: [{ role: 'user', content: `Tu es Romi, assistant de prospection d'Aria (community management IA, SocialAI Pertuis).
Génère un script d'appel téléphonique ultra-personnalisé.

Prospect :
- Entreprise : ${prospect.company_name}
- Gérant : ${prospect.manager_name || 'Inconnu'}
- Secteur : ${prospect.sector || 'artisan'}
- Ville : ${prospect.city || 'région Pertuis'}
- Site web : ${prospect.website || 'non'}
- Sur Instagram : ${prospect.instagram || 'non'}
- Niveau d'intérêt : ${prospect.interest_level || 'nouveau'}
- Objection connue : ${prospect.main_objection || 'aucune'}
- Notes précédents appels : ${prospect.notes || 'aucune'}

Script en 5 parties avec emojis :
1. Accroche personnalisée (10 secondes)
2. Présentation Aria adaptée au secteur
3. Question de qualification
4. Réponses aux objections probables
5. Demande de RDV

Tarif : 149€/mois × 3 mois puis 199€. Argument local Pertuis obligatoire. Ton naturel et humain. 350 mots max.` }]
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