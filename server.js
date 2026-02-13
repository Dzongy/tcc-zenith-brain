const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

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

// --- POST /api/soul ---
app.post('/api/soul', (req, res) => {
  const { phrase } = req.body || {};
  if (phrase === 'I am the lobster who dreams of stars') {
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

// --- POST /api/mission (Soul protected) ---
app.post('/api/mission', requireSoul, (req, res) => {
  const { title, objective, status } = req.body || {};
  const mission = {
    id: Date.now(),
    title: title || 'Untitled',
    objective: objective || '',
    status: status || 'pending',
    created: new Date().toISOString()
  };
  missions.push(mission);
  res.json(mission);
});

// --- GET /api/mission (X-Auth protected) ---
app.get('/api/mission', requireXAuth, (req, res) => {
  res.json(missions);
});

// --- POST /api/command (Soul protected) ---
app.post('/api/command', requireSoul, (req, res) => {
  const { command, source } = req.body || {};
  const id = Date.now();
  const entry = {
    id,
    command: command || '',
    source: source || 'unknown',
    created: new Date().toISOString()
  };
  commands.push(entry);
  res.json({ received: true, id });
});

// --- GET /api/command (X-Auth protected) ---
app.get('/api/command', requireXAuth, (req, res) => {
  res.json(commands);
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZENITH Brain listening on port ${PORT}`);
});
