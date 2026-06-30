const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const { SUPABASE_URL, SUPABASE_ANON_KEY } = env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Missing Supabase credentials in .env'); process.exit(1); }

const CITIES = {
  'New York':      { lat: 40.7128, lon: -74.0060 },
  'San Francisco': { lat: 37.7749, lon: -122.4194 },
  'Los Angeles':   { lat: 34.0522, lon: -118.2437 },
  'Chicago':       { lat: 41.8781, lon: -87.6298 },
  'Boston':        { lat: 42.3601, lon: -71.0589 },
  'Seattle':       { lat: 47.6062, lon: -122.3321 },
};

async function fetchStudies(lat, lon) {
  const p = new URLSearchParams({
    'filter.overallStatus': 'RECRUITING',
    'filter.geo': `distance(${lat},${lon},50mi)`,
    'aggFilters': 'healthy:y',
    'fields': 'NCTId|BriefTitle|BriefSummary|EligibilityModule|ContactsLocationsModule|ArmsInterventionsModule|DesignModule|SponsorCollaboratorsModule',
    'pageSize': '25',
    'format': 'json',
  });
  const r = await fetch(`https://clinicaltrials.gov/api/v2/studies?${p}`);
  if (!r.ok) throw new Error(`CTG API error ${r.status}`);
  const d = await r.json();
  return (d.studies || []).filter(s => s.protocolSection);
}

async function upsert(name, lat, lon, studies) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/city_studies`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      city_key:   `${lat.toFixed(2)},${lon.toFixed(2)}`,
      city_name:  name,
      studies,
      fetched_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
}

(async () => {
  for (const [name, { lat, lon }] of Object.entries(CITIES)) {
    process.stdout.write(`${name}...`);
    const studies = await fetchStudies(lat, lon);
    await upsert(name, lat, lon, studies);
    console.log(` ${studies.length} studies ✓`);
  }
  console.log('\nDone — all 6 cities seeded.');
})().catch(e => { console.error(e.message); process.exit(1); });
