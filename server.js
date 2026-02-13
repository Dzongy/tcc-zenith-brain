const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Parse JSON bodies
app.use(bodyParser.json());

// Serve static files BEFORE routes
app.use(express.static('public'));

// ============ AUTH ============

// X-Auth middleware
function requireXAuth(req, res, next) {
  const auth = req.headers['x-auth'];
  if (!auth || auth !== 'amos-bridge-2026') {
    return res.status(403).json({ error: 'Forbidden: invalid or missing X-Auth header' });
  }
  next();
}

// Soul token store
const soulTokens = new Set();

// POST /api/soul - authenticate with sovereign phrase
app.post('/api/soul', (req, res) => {
  const { phrase } = req.body || {};
  if (phrase === 'I am the lobster who dreams of stars') {
    const token = crypto.randomBytes(32).toString('hex');
    soulTokens.add(token);
    return res.json({ authenticated: true, token });
  }
  return res.status(403).json({ authenticated: false, error: 'Invalid phrase' });
});

// Soul token middleware
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

// ============ DATA STORES ============
const missions = [];
const commands = [];

// ============ ROUTES ============

// GET /api/status - protected by X-Auth
app.get('/api/status', requireXAuth, (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    version: '1.0.0',
    name: 'ZENITH'
  });
});

// POST /api/mission - protected by Soul
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

// GET /api/mission - protected by X-Auth
app.get('/api/mission', requireXAuth, (req, res) => {
  res.json(missions);
});

// POST /api/command - protected by Soul
app.post('/api/command', requireSoul, (req, res) => {
  const { command, source } = req.body || {};
  const entry = {
    id: Date.now(),
    command: command || '',
    source: source || 'unknown',
    received: true,
    timestamp: new Date().toISOString()
  };
  commands.push(entry);
  res.json({ received: true, id: entry.id });
});

// GET /api/command - protected by X-Auth
app.get('/api/command', requireXAuth, (req, res) => {
  res.json(commands);
});

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZENITH Brain listening on port ${PORT}`);
});
