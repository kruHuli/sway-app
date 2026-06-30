const fs = require('fs');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const missing = ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_ANON_KEY'].filter(k => !env[k] || env[k].startsWith('your_'));
if (missing.length) { console.error('Missing in .env:', missing.join(', ')); process.exit(1); }

const html = fs.readFileSync('index.html', 'utf8')
  .replace("'YOUR_OPENAI_API_KEY'",   `'${env.OPENAI_API_KEY}'`)
  .replace("'YOUR_SUPABASE_URL'",     `'${env.SUPABASE_URL}'`)
  .replace("'YOUR_SUPABASE_ANON_KEY'",`'${env.SUPABASE_ANON_KEY}'`);

fs.writeFileSync('built.html', html);
console.log('✓ built.html ready — open built.html in your browser');
