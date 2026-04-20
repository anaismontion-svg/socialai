const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function migrateInstagramMedia() {
  console.log('🔄 Migration médias Instagram → Supabase...');

  const { data: medias, error } = await supabase
    .from('media')
    .select('id, url, client_id, type')
    .like('url', '%instagram%')
    .limit(50); // 50 par batch pour ne pas surcharger

  if (error || !medias?.length) {
    console.log('✅ Aucun média Instagram à migrer');
    return;
  }

  console.log(`📦 ${medias.length} médias à migrer...`);
  let success = 0, failed = 0;

  for (const media of medias) {
    try {
      // 1. Télécharger depuis Instagram
      const response = await fetch(media.url, { timeout: 10000 });
      if (!response.ok) {
        failed++;
        continue; // URL expirée, on skip
      }

      const buffer = await response.buffer();
      const ext = media.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${media.client_id}/${media.id}.${ext}`;
      const contentType = media.type === 'video' ? 'video/mp4' : 'image/jpeg';

      // 2. Upload dans Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(filename, buffer, { contentType, upsert: true });

      if (uploadError) {
        failed++;
        continue;
      }

      // 3. Récupérer l'URL publique
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filename);

      // 4. Mettre à jour la BDD
      await supabase
        .from('media')
        .update({ url: publicUrl })
        .eq('id', media.id);

      success++;
    } catch (e) {
      console.log(`❌ Échec média ${media.id}: ${e.message}`);
      failed++;
    }
  }

  console.log(`✅ Migration batch terminée: ${success} OK, ${failed} échecs`);
}

module.exports = { migrateInstagramMedia };