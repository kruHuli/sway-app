const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const { SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY } = env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Missing Supabase credentials in .env'); process.exit(1); }
if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY in .env'); process.exit(1); }

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

async function enrichStudy(study) {
  const id   = study.protocolSection.identificationModule || {};
  const desc = study.protocolSection.descriptionModule   || {};
  const elig = study.protocolSection.eligibilityModule   || {};
  const ai   = study.protocolSection.armsInterventionsModule || {};

  const prompt = `Study: ${id.briefTitle || ''}

Summary: ${(desc.briefSummary || '').slice(0, 800)}

Eligibility: ${(elig.eligibilityCriteria || '').slice(0, 600)}

Interventions: ${JSON.stringify((ai.interventions || []).slice(0, 3))}

Return JSON with exactly these keys:
- pay: compensation as a short string (e.g. "Up to $400", "~$200/visit") or null if not mentioned
- duration: total study length as a short string (e.g. "6 weeks", "3 months") or null
- category: exactly one of: BEHAVIORAL, DRUG, BIOLOGICAL, DEVICE, DIETARY_SUPPLEMENT, PROCEDURE, GENETIC, OTHER
- tags: array of 3-5 brief plain-English prerequisite strings a healthy volunteer would care about (e.g. ["Age 18–65", "Non-smoker", "BMI 18–30", "No medications"])
- aiSummary: REQUIRED, never null. 2–3 sentences at a 10th grade reading level. Say what you'll actually do (take a supplement, answer surveys, get a blood draw, etc.) and why it matters. Short sentences. No jargon. Sound like a friend explaining it, not a doctor. If the study is complex, just describe the basics simply.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a research coordinator explaining clinical studies to regular people. Write at a 10th grade reading level — short sentences, everyday words, zero jargon. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 450, temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });
    const d = await res.json();
    const r = JSON.parse(d.choices?.[0]?.message?.content || '{}');
    if (!r.aiSummary) r.aiSummary = await plainSummary(id.briefTitle, desc.briefSummary);
    return r;
  } catch (e) {
    console.warn(`  GPT failed for ${id.nctId}: ${e.message}`);
    return { aiSummary: await plainSummary(id.briefTitle, desc.briefSummary) };
  }
}

async function plainSummary(title, summary) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Write exactly 2 short sentences explaining what participants will do in this study. 10th grade reading level. No jargon. Start with "You will" or "Researchers want".' },
          { role: 'user', content: `${title}\n\n${(summary || '').slice(0, 600)}` },
        ],
        max_tokens: 120, temperature: 0.5,
      }),
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content?.trim() || `Researchers are studying ${title}. You'll come in for visits and help scientists learn more about health.`;
  } catch {
    return `Researchers are studying ${title}. You'll come in for visits and help scientists learn more about health.`;
  }
}

async function enrichAll(studies) {
  const BATCH = 5;
  for (let i = 0; i < studies.length; i += BATCH) {
    const batch = studies.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(s => enrichStudy(s)));
    results.forEach((r, j) => { studies[i + j]._enriched = r; });
    process.stdout.write('.');
  }
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
    process.stdout.write(`${name}: fetching...`);
    const studies = await fetchStudies(lat, lon);
    process.stdout.write(` ${studies.length} studies, enriching`);
    await enrichAll(studies);
    process.stdout.write(' saving...');
    await upsert(name, lat, lon, studies);
    console.log(' ✓');
  }
  console.log('\nDone — all 6 cities seeded with GPT enrichment.');
})().catch(e => { console.error(e.message); process.exit(1); });
