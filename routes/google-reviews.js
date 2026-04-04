const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────
function getWeekNumber(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7) + 1;
}

function getCurrentYear() {
  return new Date().getFullYear();
}

// ─────────────────────────────────────────────
// RÉCUPÉRER LES AVIS GOOGLE 5⭐
// ─────────────────────────────────────────────
async function fetchGoogleReviews(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json`;
    const response = await axios.get(url, {
      params: {
        place_id: placeId,
        fields:   'reviews,name',
        language: 'fr',
        key:      GOOGLE_API_KEY
      }
    });

    const result = response.data?.result;
    if (!result) return [];

    const reviews = result.reviews || [];
    // Garder uniquement les avis 5 étoiles avec du texte
    return reviews
      .filter(r => r.rating === 5 && r.text && r.text.length > 20)
      .map(r => ({
        id:          `${r.author_name}_${r.time}`,
        author:      r.author_name,
        text:        r.text,
        rating:      r.rating,
        time:        r.time,
        photo_url:   r.profile_photo_url || null
      }));
  } catch (err) {
    console.error('❌ Erreur Google Places:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// SÉLECTIONNER UN AVIS AVEC ROTATION
// Jamais le même 2 fois d'affilée
// Jamais 2 fois dans la même semaine
// ─────────────────────────────────────────────
async function selectReviewWithRotation(clientId, reviews) {
  if (!reviews.length) return null;

  const weekNum  = getWeekNumber();
  const year     = getCurrentYear();

  // Avis utilisés cette semaine
  const { data: usedThisWeek } = await supabase
    .from('google_reviews_used')
    .select('review_id')
    .eq('client_id', clientId)
    .eq('week_number', weekNum)
    .eq('year', year);

  const usedWeekIds = new Set(usedThisWeek?.map(r => r.review_id) || []);

  // Dernier avis utilisé (toutes semaines confondues)
  const { data: lastUsed } = await supabase
    .from('google_reviews_used')
    .select('review_id')
    .eq('client_id', clientId)
    .order('used_at', { ascending: false })
    .limit(1);

  const lastUsedId = lastUsed?.[0]?.review_id || null;

  // Filtrer : pas utilisé cette semaine + pas le dernier utilisé
  let candidates = reviews.filter(r =>
    !usedWeekIds.has(r.id) && r.id !== lastUsedId
  );

  // Si tous ont été utilisés cette semaine → prendre juste pas le dernier
  if (!candidates.length) {
    candidates = reviews.filter(r => r.id !== lastUsedId);
  }

  // Si un seul avis disponible → l'utiliser quand même
  if (!candidates.length) {
    candidates = reviews;
  }

  // Choisir aléatoirement parmi les candidats
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  // Enregistrer l'utilisation
  await supabase.from('google_reviews_used').insert({
    client_id:   clientId,
    review_id:   chosen.id,
    author_name: chosen.author,
    week_number: weekNum,
    year
  });

  return chosen;
}

// ─────────────────────────────────────────────
// GET /api/google-reviews/:clientId/next
// Retourne le prochain avis à utiliser
// ─────────────────────────────────────────────
router.get('/:clientId/next', async (req, res) => {
  const { clientId } = req.params;

  try {
    // Récupérer le google_place_id du client
    const { data: client } = await supabase
      .from('clients')
      .select('google_place_id, name')
      .eq('id', clientId)
      .single();

    if (!client?.google_place_id) {
      return res.status(404).json({ error: 'Aucun Google Place ID configuré pour ce client' });
    }

    // Récupérer les avis Google
    const reviews = await fetchGoogleReviews(client.google_place_id);

    if (!reviews.length) {
      return res.status(404).json({ error: 'Aucun avis 5 étoiles trouvé' });
    }

    // Sélectionner avec rotation
    const review = await selectReviewWithRotation(clientId, reviews);

    res.json({
      success: true,
      review,
      total_available: reviews.length,
      client_name: client.name
    });

  } catch (err) {
    console.error('❌ Erreur récupération avis:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/google-reviews/:clientId/all
// Liste tous les avis 5⭐ disponibles
// ─────────────────────────────────────────────
router.get('/:clientId/all', async (req, res) => {
  const { clientId } = req.params;

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('google_place_id, name')
      .eq('id', clientId)
      .single();

    if (!client?.google_place_id) {
      return res.status(404).json({ error: 'Aucun Google Place ID configuré' });
    }

    const reviews = await fetchGoogleReviews(client.google_place_id);
    res.json({ success: true, reviews, total: reviews.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// FONCTION EXPORTÉE POUR LE SCHEDULER
// ─────────────────────────────────────────────
async function getNextReviewForClient(clientId, placeId) {
  try {
    const reviews = await fetchGoogleReviews(placeId);
    if (!reviews.length) return null;
    return await selectReviewWithRotation(clientId, reviews);
  } catch (err) {
    console.error('❌ Erreur getNextReview:', err.message);
    return null;
  }
}

module.exports = router;
module.exports.getNextReviewForClient = getNextReviewForClient;