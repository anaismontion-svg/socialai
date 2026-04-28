// routes/schedule-stories.js
// Planifie chaque jour les 3 stories fixes à 6h/6h05/6h10
// Aria choisit le visuel en rotation — elle ne crée RIEN

const { createClient } = require('@supabase/supabase-js');
const { getStoryAssetDuJour } = require('./story-assets');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Planning des stories fixes par ordre de publication
const STORIES_PLANNING = [
  { type: 'entreprise',  heure: 6,  minute: 0  },
  { type: 'temoignage',  heure: 6,  minute: 5  },
  { type: 'avant_apres', heure: 6,  minute: 10 },
];

// ─────────────────────────────────────────────
// Vérifie si une story de ce type est déjà
// planifiée ou publiée pour aujourd'hui
// ─────────────────────────────────────────────
async function storyDejaPlannifieAujourdhui(clientId, storyType) {
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  const fin = new Date();
  fin.setHours(23, 59, 59, 999);

  const { count } = await supabase
    .from('queue')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('type', 'story')
    .eq('story_asset_type', storyType)
    .in('statut', ['planifie', 'publie'])
    .gte('scheduled_at', debut.toISOString())
    .lte('scheduled_at', fin.toISOString());

  return (count || 0) > 0;
}

// ─────────────────────────────────────────────
// PLANIFICATION QUOTIDIENNE DES STORIES
// Appelée chaque jour à 2h du matin via server.js
// ─────────────────────────────────────────────
async function scheduleFixedStories() {
  console.log('📖 Planification stories fixes du jour...');

  try {
    // Récupérer tous les clients actifs avec un compte Instagram
    const { data: accounts } = await supabase
      .from('social_accounts')
      .select('client_id, clients(*)')
      .eq('platform', 'instagram');

    if (!accounts || accounts.length === 0) {
      console.log('📖 Aucun compte Instagram trouvé');
      return;
    }

    const today = new Date();
    let totalPlanifiees = 0;
    let totalIgnorees = 0;

    for (const account of accounts) {
      const client = account.clients;
      if (!client || client.status !== 'active') continue;

      for (const planning of STORIES_PLANNING) {
        try {
          // Vérifier si déjà planifiée aujourd'hui
          const dejaPlannifie = await storyDejaPlannifieAujourdhui(client.id, planning.type);
          if (dejaPlannifie) {
            totalIgnorees++;
            continue;
          }

          // Choisir le visuel du jour en rotation
          const asset = await getStoryAssetDuJour(client.id, planning.type, today);

          if (!asset) {
            console.warn(`⚠️ ${client.name} — Aucun visuel "${planning.type}" disponible, story ignorée`);
            totalIgnorees++;
            continue;
          }

          // Calculer l'heure de publication (aujourd'hui à 6h/6h05/6h10)
          const scheduledAt = new Date(today);
          scheduledAt.setHours(planning.heure, planning.minute, 0, 0);

          // Si l'heure est déjà passée aujourd'hui, planifier pour demain
          if (scheduledAt < new Date()) {
            scheduledAt.setDate(scheduledAt.getDate() + 1);
          }

          // Ajouter à la file de publication
          const { error } = await supabase.from('queue').insert([{
            client_id:        client.id,
            type:             'story',
            story_asset_type: planning.type,   // 'entreprise' | 'temoignage' | 'avant_apres'
            story_asset_id:   asset.id,
            media_url:        asset.url,
            caption:          '',              // les stories n'ont pas de caption
            statut:           'planifie',
            scheduled_at:     scheduledAt.toISOString(),
            source:           'story_fixe_rotation',
            platform:         'instagram'
          }]);

          if (error) {
            console.error(`❌ Erreur planification story ${planning.type} pour ${client.name}:`, error.message);
            continue;
          }

          totalPlanifiees++;
          console.log(`📖 ${client.name} — Story "${planning.type}" planifiée à ${planning.heure}h${planning.minute.toString().padStart(2,'0')} (visuel #${asset.position})`);

        } catch(e) {
          console.error(`❌ Erreur story ${planning.type} pour ${client.name}:`, e.message);
        }
      }
    }

    console.log(`✅ Stories fixes planifiées : ${totalPlanifiees} nouvelles, ${totalIgnorees} déjà existantes`);

  } catch(err) {
    console.error('❌ Erreur planification stories fixes:', err.message);
  }
}

module.exports = { scheduleFixedStories };