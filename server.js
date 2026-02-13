const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

// --- CORS ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Auth, X-Soul-Token, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static files BEFORE routes
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth stores ---
const soulTokens = new Set();
const missions = [];
const commands = [];

// --- Middleware: X-Auth ---
function requireXAuth(req, res, next) {
  const auth = req.headers['x-auth'];
  if (!auth || auth !== 'amos-bridge-2026') {
    return res.status(403).json({ error: 'Forbidden: invalid or missing X-Auth header' });
  }
  next();
}

// --- Middleware: Soul Token ---
function requireSoul(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'Forbidden: missing Bearer token' });
  }
  const token = authHeader.slice(7);
  if (!soulTokens.has(token)) {
    return res.status(403).json({ error: 'Forbidden: invalid soul token' });
  }
  next();
}

// --- POST /api/soul --- (X-Auth required, no soul token needed)
app.post('/api/soul', (req, res) => {
  const { phrase } = req.body || {};
  const expectedPhrase = process.env.SOUL_PHRASE || 'ARCHITECTDZONGYZENITH';
  if (phrase && phrase.trim() === expectedPhrase.trim()) {
    const token = crypto.randomBytes(32).toString('hex');
    soulTokens.add(token);
    return res.json({ authenticated: true, token });
  }
  return res.status(403).json({ authenticated: false, error: 'Wrong phrase' });
});

// --- GET /api/status (X-Auth protected) ---
app.get('/api/status', requireXAuth, (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    version: '1.0.0',
    name: 'ZENITH'
  });
});

// --- POST /api/command --- (X-Auth + Soul required)
app.post('/api/command', requireXAuth, requireSoul, (req, res) => {
  const { command, source } = req.body || {};
  if (!command) {
    return res.status(400).json({ error: 'Missing command field' });
  }
  const id = Date.now();
  const entry = { id, command, source: source || 'unknown', receivedAt: new Date(id).toISOString() };
  commands.push(entry);
  return res.json({ received: true, id });
});

// --- GET /api/command --- (X-Auth protected)
app.get('/api/command', requireXAuth, (req, res) => {
  res.json({ commands, count: commands.length });
});

// --- POST /api/missions --- (X-Auth + Soul required)
app.post('/api/missions', requireXAuth, requireSoul, (req, res) => {
  const { title, objective, status } = req.body || {};
  if (!title || !objective) {
    return res.status(400).json({ error: 'Missing title and/or objective' });
  }
  const mission = {
    id: Date.now(),
    title,
    objective,
    status: status || 'active',
    createdAt: new Date().toISOString()
  };
  missions.push(mission);
  return res.json({ success: true, mission });
});

// --- GET /api/missions --- (X-Auth + Soul required)
app.get('/api/missions', requireXAuth, requireSoul, (req, res) => {
  res.json({ missions, count: missions.length, timestamp: new Date().toISOString() });
});

// --- Fallback: serve index.html for root ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- GET /api/health (X-Auth protected) ---
app.get('/api/health', requireXAuth, (req, res) => {
  res.json({
    status: 'operational',
    pillars: {
      memory: 'ok',
      'memory-manifest': 'ok',
      'learnings-manifest': 'ok'
    },
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZENITH Brain listening on port ${PORT}`);
});
