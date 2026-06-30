// Round-trip check for the flat-table mappers (twins live in seed.js + index.html).
const assert = require('assert');

const studyToRow = (s, cityKey) => {
  const id = s.protocolSection.identificationModule || {};
  const { _enriched, ...raw } = s;
  const { aiSummary, ...details } = _enriched || {};
  return { nct_id: id.nctId, city_key: cityKey, title: id.briefTitle || null,
           ai_summary: aiSummary || null, details, raw, fetched_at: 't' };
};
const rowsToStudies = rows =>
  rows.map(r => ({ ...r.raw, _enriched: { aiSummary: r.ai_summary, ...(r.details || {}) } }));

const study = {
  protocolSection: { identificationModule: { nctId: 'NCT1', briefTitle: 'Sleep study' } },
  _enriched: { aiSummary: 'You sleep, we watch.', pay: '$400', category: 'BEHAVIORAL', tags: ['Age 18-65'] },
};

const row = studyToRow(study, '40.71,-74.01');
assert.equal(row.nct_id, 'NCT1');
assert.equal(row.ai_summary, 'You sleep, we watch.');     // summary hoisted to its own column
assert.deepEqual(row.details, { pay: '$400', category: 'BEHAVIORAL', tags: ['Age 18-65'] });
assert.ok(!('_enriched' in row.raw));                      // raw stripped of enrichment

const [back] = rowsToStudies([row]);
assert.equal(back.protocolSection.identificationModule.nctId, 'NCT1');  // card code still sees this
assert.equal(back._enriched.aiSummary, 'You sleep, we watch.');
assert.equal(back._enriched.pay, '$400');

console.log('ok — flat-table round trip preserves summary + details');
