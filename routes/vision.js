// vision.js — Sélection intelligente des médias depuis Supabase
// Branché sur les scores qualite + potentiel_viral déjà calculés dans media.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────────────────────
// Sélectionne les meilleurs médias disponibles pour un client
// Paramètres :
//   clientId   — UUID du client
//   count      — nombre de médias à retourner (défaut : 1)
//   format     — 'carousel' (3-10), 'reel' (video), 'single' (1 image)
//   storyType  — filtre optionnel sur story_type (ex: 'avant_apres', 'produit'…)
// ─────────────────────────────────────────────────────────────────────────────
async function selectBestMedia(clientId, { count = 1, format = 'single', storyType = null } = {}) {
  let query = supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .eq('used', false)
    .not('qualite', 'is', null)
    .not('potentiel_viral', 'is', null);

  // Pour les Reels : on veut des vidéos
  if (format === 'reel') {
    query = query.eq('type', 'video');
  } else {
    query = query.eq('type', 'photo');
  }

  // Filtre optionnel sur le type de contenu
  if (storyType) {
    query = query.eq('story_type', storyType);
  }

  // Récupérer un pool large, on trie et on sélectionne côté Node
  const { data, error } = await query
    .order('potentiel_viral', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erreur sélection médias : ${error.message}`);
  if (!data || data.length === 0) throw new Error(`Aucun média disponible pour client ${clientId}`);

  // ── Score composite : 60% potentiel viral + 40% qualité ──────────────────
  const scored = data.map(m => ({
    ...m,
    score_composite: (m.potentiel_viral * 0.6) + (m.qualite * 0.4)
  }));

  // Trier par score composite décroissant
  scored.sort((a, b) => b.score_composite - a.score_composite);

  // Pour carousel : on veut de la diversité de type_contenu
  if (format === 'carousel' && count > 1) {
    return diversify(scored, count);
  }

  return scored.slice(0, count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diversifie la sélection carousel en évitant les doublons de type_contenu
// ─────────────────────────────────────────────────────────────────────────────
function diversify(sortedMedia, count) {
  const selected = [];
  const usedTypes = new Set();

  // Premier passage : on prend le meilleur de chaque type
  for (const media of sortedMedia) {
    if (selected.length >= count) break;
    const type = media.analyse_data?.type_contenu || 'autre';
    if (!usedTypes.has(type)) {
      selected.push(media);
      usedTypes.add(type);
    }
  }

  // Deuxième passage : on complète avec les meilleurs restants
  for (const media of sortedMedia) {
    if (selected.length >= count) break;
    if (!selected.find(m => m.id === media.id)) {
      selected.push(media);
    }
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Détermine automatiquement le meilleur format selon le stock disponible
// Règles :
//   - 1 vidéo dispo avec bon score → reel
//   - 3+ photos dispos              → carousel
//   - sinon                         → single
// ─────────────────────────────────────────────────────────────────────────────
async function decideFormat(clientId) {
  const { data: videos } = await supabase
    .from('media')
    .select('id, potentiel_viral')
    .eq('client_id', clientId)
    .eq('used', false)
    .eq('type', 'video')
    .gte('potentiel_viral', 65)
    .limit(1);

  if (videos && videos.length > 0) return { format: 'reel', count: 1 };

  const { data: photos } = await supabase
    .from('media')
    .select('id')
    .eq('client_id', clientId)
    .eq('used', false)
    .eq('type', 'photo')
    .gte('qualite', 60)
    .limit(5);

  const n = photos?.length || 0;

  if (n >= 3) return { format: 'carousel', count: Math.min(n, 5) };
  if (n >= 1) return { format: 'single', count: 1 };

  throw new Error(`Stock insuffisant pour client ${clientId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Marque les médias comme utilisés après publication
// ─────────────────────────────────────────────────────────────────────────────
async function markAsUsed(mediaIds) {
  const { error } = await supabase
    .from('media')
    .update({ used: true })
    .in('id', mediaIds);

  if (error) throw new Error(`Erreur markAsUsed : ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compte le stock restant — utilisé par checkLowContent dans publisher.js
// ─────────────────────────────────────────────────────────────────────────────
async function countAvailableMedia(clientId) {
  const { count } = await supabase
    .from('media')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('used', false);

  return count || 0;
}

module.exports = {
  selectBestMedia,
  decideFormat,
  markAsUsed,
  countAvailableMedia
};