const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function migrateInstagramMedia() {
  console.log('🔄 Migration médias Instagram → Supabase...');

  const { data: medias, error } = await supabase
    .from('media')
    .select('id, url, client_id, type')
    .like('url', '%instagram%')
    .limit(500); // Tout traiter d'un coup

  if (error || !medias?.length) {
    console.log('✅ Aucun média Instagram à migrer');
    return;
  }

  console.log(`📦 ${medias.length} médias à migrer...`);
  let success = 0, failed = 0, expired = 0;

  for (const media of medias) {
    try {
      const buffer = await downloadBuffer(media.url);

      const ext = media.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${media.client_id}/${media.id}.${ext}`;
      const contentType = media.type === 'video' ? 'video/mp4' : 'image/jpeg';

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(filename, buffer, { contentType, upsert: true });

      if (uploadError) {
        console.log(`❌ Upload échoué ${media.id}: ${uploadError.message}`);
        failed++;
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filename);

      await supabase
        .from('media')
        .update({ url: publicUrl })
        .eq('id', media.id);

      console.log(`✅ Migré : ${media.id}`);
      success++;
    } catch (e) {
      if (e.message.includes('403')) {
        // URL expirée → supprimer de la BDD directement
        await supabase.from('media').delete().eq('id', media.id);
        expired++;
      } else {
        console.log(`❌ Échec média ${media.id}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`✅ Migration terminée: ${success} migrés ✅ | ${expired} expirés supprimés 🗑️ | ${failed} autres erreurs ❌`);
}

module.exports = { migrateInstagramMedia };