// routes/assembler.js — Appelle le microservice Python pour générer les visuels

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASSEMBLER = process.env.ASSEMBLER_URL || 'http://localhost:5001';

// ─────────────────────────────────────────────────────────────────────────────
// Génère les visuels pour un item de la queue
// Appelé par ai.js avant d'insérer dans la queue
// ─────────────────────────────────────────────────────────────────────────────
async function assembleVisuals({ client, mediaList, format, titre, caption, titres, captions }) {
  // Récupérer le branding du client
  const { data: clientData } = await supabase
    .from('clients')
    .select('branding, logo_url')
    .eq('id', client.id)
    .single();

  if (!clientData?.branding) {
    throw new Error(`Branding non configuré pour ${client.name}`);
  }

  const branding  = clientData.branding;
  const logo_url  = clientData.logo_url || clientData.branding?.logo_url;
  const photoUrls = mediaList.map(m => m.url);

  const payload = {
    client_id:  client.id,
    format,
    photo_urls: photoUrls,
    logo_url,
    branding,
    titre,
    caption,
    tagline:    branding.tagline || '',
    titres:     titres   || [titre],
    captions:   captions || [caption],
  };

  const res = await axios.post(`${ASSEMBLER}/assemble`, payload, {
    timeout: 120000  // 2min max pour la génération
  });

  if (!res.data.success) {
    throw new Error(`Erreur assembleur : ${res.data.error}`);
  }

  return res.data.urls;  // tableau d'URLs publiques Supabase
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check — vérifie que le microservice Python est disponible
// ─────────────────────────────────────────────────────────────────────────────
async function checkAssemblerHealth() {
  try {
    const res = await axios.get(`${ASSEMBLER}/health`, { timeout: 5000 });
    return res.data.status === 'ok';
  } catch {
    return false;
  }
}

module.exports = { assembleVisuals, checkAssemblerHealth };