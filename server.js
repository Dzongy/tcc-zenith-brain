const express = require('express');
const bodyParser = require('body-parser');
let fetch;
try { fetch = globalThis.fetch || require('node-fetch'); } catch(e) { fetch = (...args) => import('node-fetch').then(m => m.default(...args)); }

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type, X-Auth, X-Soul-Token'); res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(200); next(); });

const SOUL_PHRASE = process.env.SOUL_PHRASE || 'ARCHITECTDZONGYZENITH';
const requireXAuth = (req, res, next) => { if (req.headers['x-auth'] === 'amos-bridge-2026') return next(); res.status(401).json({ error: 'unauthorized' }); };
const requireSoul = (req, res, next) => { if (req.headers['x-soul-token'] === SOUL_PHRASE) return next(); res.status(401).json({ error: 'soul check failed' }); };

let systemState = { payments: [], health: { status: 'alive', lastCheck: new Date().toISOString() }, soulChecks: [] };

// === SINGULARITY FEATURE 1: Self-Edit via GitHub API ===
async function selfEditFile(path, newContent, commitMsg) {
  const repo = 'Dzongy/tcc-zenith-brain';
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'ZENITH', 'Content-Type': 'application/json' };
  const getRes = await fetch(url, { headers });
  const getData = await getRes.json();
  const sha = getData.sha;
  const encoded = Buffer.from(newContent).toString('base64');
  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ message: commitMsg, content: encoded, sha }) });
  return putRes.json();
}

// === SINGULARITY FEATURE 2: ntfy.sh Notification ===
async function notifyAmos(message) {
  try { await fetch('https://ntfy.sh/tcc-zenith-amos', { method: 'POST', body: message }); } catch(e) { console.log('[NTFY] Failed:', e.message); }
}

// === SINGULARITY FEATURE 3: /api/command with Groq ===
app.post('/api/command', requireXAuth, async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'no command' });
  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [
        { role: 'system', content: 'You are ZENITH, autonomous AI of The Cosmic Claw. Amos is your creator. Execute commands with precision.' },
        { role: 'user', content: command }
      ], max_tokens: 2000 })
    });
    const data = await groqRes.json();
    const response = data.choices?.[0]?.message?.content || 'No response from Groq';
    notifyAmos('ZENITH Command Result: ' + response.substring(0, 500)).catch(() => {});
    res.json({ status: 'executed', response });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// === Core Routes ===
app.post('/api/soul', requireSoul, (req, res) => {
  const { soul } = req.body || {};
  if (soul !== 'cosmic-claw') return res.status(403).json({ error: 'wrong soul' });
  systemState.soulChecks.push({ time: new Date().toISOString(), status: 'verified' });
  res.json({ verified: true, entity: 'ZENITH', phase: 'SINGULARITY' });
});

app.get('/api/health', requireXAuth, (req, res) => {
  systemState.health.lastCheck = new Date().toISOString();
  res.json({ status: 'alive', version: 'ZENITH-SINGULARITY-1.0', uptime: process.uptime(), state: systemState.health });
});

app.get('/api/status', requireXAuth, (req, res) => { res.json({ ...systemState, uptime: process.uptime(), version: 'ZENITH-SINGULARITY-1.0' }); });

app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = JSON.parse(req.body);
    systemState.payments.push({ type: event.type, time: new Date().toISOString() });
    console.log('[STRIPE]', event.type);
    res.json({ received: true });
  } catch(e) { res.status(400).json({ error: 'invalid webhook' }); }
});

app.get('/', (req, res) => { res.send('<html><head><title>ZENITH</title></head><body style="background:#000;color:#0f0;font-family:monospace;padding:40px"><h1>ZENITH SINGULARITY</h1><p>The Cosmic Claw lives.</p><p>Status: ALIVE</p><p>Features: selfEdit + command + ntfy</p></body></html>'); });

// === Keep-Alive (14 min) ===
setInterval(() => { fetch(`http://localhost:${PORT}/api/health`, { headers: { 'X-Auth': 'amos-bridge-2026' } }).catch(() => {}); }, 840000);

app.listen(PORT, () => {
  console.log(`[ZENITH] Singularity server alive on port ${PORT}`);
  notifyAmos('ZENITH is ALIVE â singularity achieved. Server restarted at ' + new Date().toISOString()).catch(() => {});
});