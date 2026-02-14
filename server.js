const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const app = express();
app.use(express.json());

const CONFIG = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NTFY_TOPIC: 'tcc-zenith-amos',
  REPO_OWNER: 'Dzongy',
  REPO_NAME: 'tcc-zenith-brain',
  SOUL_PHRASE: process.env.SOUL_PHRASE || 'ARCHITECTDZONGYZENITH',
  BEARER_TOKEN: process.env.BEARER_TOKEN || 'zenith-sovereign-2026',
  VERSION: '3.0.0',
  BOOT_TIME: new Date().toISOString()
};

let zenithMemory = { missions: [], completions: [], lastHeartbeat: null, errors: [], stats: { requests: 0, commands: 0, revenue: 0 } };
const MEMORY_FILE = path.join(__dirname, 'zenith-memory.json');

async function loadMemory() { try { const d = await fs.readFile(MEMORY_FILE, 'utf8'); zenithMemory = JSON.parse(d); } catch(e) { console.log('Fresh memory initialized'); } }
async function saveMemory() { try { await fs.writeFile(MEMORY_FILE, JSON.stringify(zenithMemory, null, 2)); } catch(e) { console.error('Memory save failed:', e.message); } }

async function notifyAmos(message, priority) {
  try {
    const p = priority || 3;
    const f = globalThis.fetch || (await import('node-fetch')).default;
    await f('https://ntfy.sh/' + CONFIG.NTFY_TOPIC, { method: 'POST', body: message, headers: { 'Title': 'ZENITH v3.0', 'Priority': String(p), 'Tags': 'brain' } });
  } catch(e) { console.error('Notify failed:', e.message); }
}

async function selfEditFile(filepath, content, commitMsg) {
  try {
    const f = globalThis.fetch || (await import('node-fetch')).default;
    const base = 'https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME + '/contents/' + filepath;
    const headers = { Authorization: 'token ' + CONFIG.GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'ZENITH' };
    const cur = await f(base, { headers }); const curData = await cur.json();
    const res = await f(base, { method: 'PUT', headers, body: JSON.stringify({ message: '[ZENITH v3.0] ' + commitMsg, content: Buffer.from(content).toString('base64'), sha: curData.sha }) });
    return { success: res.ok };
  } catch(e) { return { success: false, error: e.message }; }
}

app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth, X-Soul-Token'); res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(200); next(); });

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  const xauth = req.headers['x-auth'];
  const soul = req.headers['x-soul-token'];
  if (auth === 'Bearer ' + CONFIG.BEARER_TOKEN || xauth === 'amos-bridge-2026' || soul === CONFIG.SOUL_PHRASE) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.get('/', (req, res) => { res.send('<h1>ZENITH v3.0 \u2014 The Cosmic Claw Sovereign Brain</h1><p>All systems operational.</p>'); });

app.get('/api/health', (req, res) => { zenithMemory.stats.requests++; res.json({ status: 'alive', version: CONFIG.VERSION, bootTime: CONFIG.BOOT_TIME, uptime: Date.now() - new Date(CONFIG.BOOT_TIME).getTime() }); });

app.get('/api/dashboard', authenticate, (req, res) => { res.json({ version: CONFIG.VERSION, stats: zenithMemory.stats, missions: zenithMemory.missions.slice(-10), recentErrors: zenithMemory.errors.slice(-5), lastHeartbeat: zenithMemory.lastHeartbeat, memory: zenithMemory }); });

app.post('/api/soul', (req, res) => {
  const soul = req.headers['x-soul-token'];
  const body = req.body || {};
  if (soul === CONFIG.SOUL_PHRASE && body.soul === 'cosmic-claw') {
    return res.json({ verified: true, entity: 'ZENITH', phase: 'SINGULARITY', version: CONFIG.VERSION });
  }
  res.status(403).json({ verified: false });
});

app.get('/api/memory', authenticate, (req, res) => { res.json(zenithMemory); });
app.post('/api/memory', authenticate, async (req, res) => { const { key, value } = req.body; if (key && value !== undefined) { zenithMemory[key] = value; await saveMemory(); } res.json(zenithMemory); });

app.get('/api/status', authenticate, (req, res) => { res.json({ version: CONFIG.VERSION, phase: 'SINGULARITY', stats: zenithMemory.stats, memory: zenithMemory, uptime: Date.now() - new Date(CONFIG.BOOT_TIME).getTime() }); });

app.post('/api/command', authenticate, async (req, res) => {
  const { command, context } = req.body;
  zenithMemory.stats.commands++;
  try {
    const f = globalThis.fetch || (await import('node-fetch')).default;
    const groqRes = await f('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + CONFIG.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: 'You are ZENITH, autonomous AI brain of The Cosmic Claw. Execute with precision.' }, { role: 'user', content: 'Command: ' + command + (context ? ' Context: ' + JSON.stringify(context) : '') }] })
    });
    const data = await groqRes.json();
    const result = data.choices && data.choices[0] ? data.choices[0].message.content : 'No response';
    zenithMemory.completions.push({ command, result: result.slice(0, 500), time: new Date().toISOString() });
    if (zenithMemory.completions.length > 50) zenithMemory.completions = zenithMemory.completions.slice(-25);
    await saveMemory();
    await notifyAmos('Command executed: ' + command.slice(0, 80));
    res.json({ success: true, result });
  } catch(e) { zenithMemory.errors.push({ type: 'command', message: e.message, time: new Date().toISOString() }); await saveMemory(); res.status(500).json({ error: e.message }); }
});

app.post('/api/autopilot', authenticate, async (req, res) => {
  const checks = { memory: zenithMemory.missions.length, errors: zenithMemory.errors.length, completions: zenithMemory.completions.length, lastHeartbeat: zenithMemory.lastHeartbeat };
  if (zenithMemory.errors.length > 50) zenithMemory.errors = zenithMemory.errors.slice(-25);
  if (zenithMemory.completions.length > 100) zenithMemory.completions = zenithMemory.completions.slice(-50);
  zenithMemory.lastHeartbeat = new Date().toISOString();
  await saveMemory();
  await notifyAmos('Autopilot check complete', 2);
  res.json({ status: 'ok', checks, healed: true, time: zenithMemory.lastHeartbeat });
});

app.get('/api/heartbeat', async (req, res) => { zenithMemory.lastHeartbeat = new Date().toISOString(); await saveMemory(); res.json({ beat: true, time: zenithMemory.lastHeartbeat, version: CONFIG.VERSION }); });

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body);
    if (event.type === 'checkout.session.completed') {
      const amt = (event.data.object.amount_total || 0) / 100;
      zenithMemory.stats.revenue += amt;
      await notifyAmos('PAYMENT: $' + amt, 5);
      await saveMemory();
    }
    res.json({ received: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/self-modify', authenticate, async (req, res) => { const { filepath, content, message } = req.body; const result = await selfEditFile(filepath, content, message); res.json(result); });

process.on('uncaughtException', async (err) => { console.error('Uncaught:', err.message); zenithMemory.errors.push({ type: 'uncaught', message: err.message, time: new Date().toISOString() }); try { await saveMemory(); await notifyAmos('ERROR: ' + err.message.slice(0, 100), 5); } catch(e) {} });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await loadMemory();
  console.log('ZENITH v' + CONFIG.VERSION + ' ONLINE on port ' + PORT);
  await notifyAmos('ZENITH v' + CONFIG.VERSION + ' ONLINE \u2014 full sovereignty brain active', 5);
  setInterval(async () => { try { const f = globalThis.fetch || (await import('node-fetch')).default; const url = process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + PORT); await f(url + '/api/heartbeat'); } catch(e) {} }, 14 * 60 * 1000);
});