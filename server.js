const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
// --- Stripe (graceful if not configured) ---
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;


const app = express();
// --- Stripe Webhook (raw body, before JSON parser) ---
app.post('/api/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(500).json({ error: 'Webhook secret not configured' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerEmail = session.customer_details?.email || session.customer_email || 'unknown';
      const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00';
      const currency = (session.currency || 'usd').toUpperCase();
      const paymentRecord = {
        sessionId: session.id,
        email: customerEmail,
        amount: parseFloat(amount),
        currency,
        timestamp: new Date().toISOString(),
        productName: session.metadata?.product_name || 'TCC Product'
      };
      systemState.lastPayment = paymentRecord;
      systemState.totalPayments++;
      systemState.totalRevenue += paymentRecord.amount;
      systemState.recentPayments.unshift(paymentRecord);
      if (systemState.recentPayments.length > 50) systemState.recentPayments.pop();
      console.log('[ZENITH SALE]', JSON.stringify({
        event: 'checkout.session.completed',
        email: customerEmail,
        amount: amount + ' ' + currency,
        sessionId: session.id,
        timestamp: paymentRecord.timestamp
      }));
      break;
    }
    case 'customer.subscription.updated':
      console.log('Subscription updated:', event.data.object.id);
      break;
    default:
      console.log('Unhandled Stripe event:', event.type);
  }
  res.json({ received: true });
});

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

// --- POST /api/soul --- (3-stage Soul Check)
app.post('/api/soul', (req, res) => {
  systemState.soulCheckStats.attempts++;
  // Stage 1: X-Soul-Token header must equal secret
  const token = req.headers['x-soul-token'];
  if (token !== 'ARCHITECTDZONGYZENITH') {
    return res.status(403).json({ verified: false, error: 'Invalid soul token' });
  }
  // Stage 2: Body must include soul: "cosmic-claw"
  const { soul } = req.body || {};
  if (soul !== 'cosmic-claw') {
    return res.status(401).json({ verified: false, error: 'Soul field mismatch' });
  }
  // Stage 3: Return verification payload
  return res.json({
    verified: true,
    entity: 'ZENITH',
    phase: 'P2',
    timestamp: new Date().toISOString()
  });
});

// --- GET /api/status (X-Auth protected) ---
app.get('/api/status', requireXAuth, (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    version: '2.0.0',
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
    version: '2.0.0'
  });
});


// === STRIPE PAYMENT ROUTES (X-Auth gated) ===

// POST /api/stripe/create-checkout-session
app.post('/api/stripe/create-checkout-session', requireXAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const { priceId, successUrl, cancelUrl } = req.body;
    if (!priceId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields: priceId, successUrl, cancelUrl' });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stripe/prices
app.get('/api/stripe/prices', requireXAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const prices = await stripe.prices.list({ active: true, expand: ['data.product'] });
    res.json({ prices: prices.data });
  } catch (err) {
    console.error('Stripe prices error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stripe/customer/:customerId
app.get('/api/stripe/customer/:customerId', requireXAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const customer = await stripe.customers.retrieve(req.params.customerId);
    const subscriptions = await stripe.subscriptions.list({ customer: req.params.customerId });
    res.json({ customer, subscriptions: subscriptions.data });
  } catch (err) {
    console.error('Stripe customer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/checkout (creates Stripe checkout session)
app.post('/api/stripe/checkout', requireXAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { priceId, successUrl, cancelUrl } = req.body || {};
  if (!priceId) return res.status(400).json({ error: 'priceId required' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || 'https://dzongy.github.io/tcc-sovereignty-lite/?success=true',
      cancel_url: cancelUrl || 'https://dzongy.github.io/tcc-sovereignty-lite/?canceled=true',
    });
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stripe/status
app.get('/api/stripe/status', requireXAuth, (req, res) => {
  res.json({
    configured: !!stripe,
    hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
});


// --- ZENITH Unified Status Dashboard ---
app.get('/api/zenith/status', (req, res) => {
  try {
    const now = Date.now();
    const startTime = (systemState && systemState.startTime) ? systemState.startTime : now;
    const uptimeMs = now - startTime;
    const uptimeHours = (uptimeMs / 3600000).toFixed(2);
    const uptimeDays = (uptimeMs / 86400000).toFixed(3);

    // Defensive reads with fallbacks
    const totalPayments = (systemState && typeof systemState.totalPayments === 'number') ? systemState.totalPayments : 0;
    const totalRevenue = (systemState && typeof systemState.totalRevenue === 'number') ? systemState.totalRevenue : 0;
    const lastPayment = (systemState && systemState.lastPayment) ? systemState.lastPayment : null;
    const recentPayments = (systemState && Array.isArray(systemState.recentPayments)) ? systemState.recentPayments : [];
    const soulCheckStats = (systemState && systemState.soulCheckStats) ? systemState.soulCheckStats : { attempts: 0, successes: 0, failures: 0 };
    const pendingTasks = (typeof taskQueue !== 'undefined' && Array.isArray(taskQueue)) ? taskQueue.length : 0;
    const completedCount = (typeof completedTasks !== 'undefined' && Array.isArray(completedTasks)) ? completedTasks.length : 0;
    const learningsCount = (typeof memory !== 'undefined' && memory && Array.isArray(memory.learnings)) ? memory.learnings.length : 0;
    const tokenCount = (typeof soulTokens !== 'undefined' && soulTokens && typeof soulTokens.size === 'number') ? soulTokens.size : 0;

    // Health check
    const healthResult = {
      stripe: !!stripe && !!process.env.STRIPE_SECRET_KEY,
      webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_WEBHOOK_SECRET !== 'placeholder',
      soulPhrase: !!process.env.SOUL_PHRASE,
      openai: !!process.env.OPENAI_API_KEY,
      github: !!process.env.GITHUB_TOKEN
    };
    if (systemState) {
      systemState.healthChecks = { lastCheck: new Date().toISOString(), status: Object.values(healthResult).every(function(v) { return v; }) ? 'all_green' : 'degraded', details: healthResult };
    }

    res.json({
      system: 'ZENITH Brain',
      version: 'v2.2-bulletproof',
      mode: 'sovereign',
      uptime: { ms: uptimeMs, hours: parseFloat(uptimeHours), days: parseFloat(uptimeDays) },
      payments: {
        totalPayments: totalPayments,
        totalRevenue: totalRevenue,
        lastPayment: lastPayment,
        recentCount: recentPayments.length
      },
      health: (systemState && systemState.healthChecks) ? systemState.healthChecks : healthResult,
      soulCheck: {
        active: !!process.env.SOUL_PHRASE,
        stats: soulCheckStats,
        activeTokens: tokenCount
      },
      autonomy: {
        tasksCompleted: completedCount,
        tasksPending: pendingTasks,
        learnings: learningsCount
      },
      endpoints: 15,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('ZENITH status error:', err.message);
    res.status(500).json({
      system: 'ZENITH Brain',
      version: 'v2.2-bulletproof',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZENITH Brain listening on port ${PORT}`);
});


// --- KEEP-ALIVE SELF-PING (every 13 minutes) ---
setInterval(() => {
  const https = require('https');
  const options = {
    hostname: 'tcc-zenith-brain.onrender.com',
    path: '/api/health',
    method: 'GET',
    headers: { 'X-Auth': 'amos-bridge-2026' }
  };
  const req = https.request(options, (res) => {
    console.log('[KEEP-ALIVE] Pinged /api/health, status:', res.statusCode);
  });
  req.on('error', (err) => {
    console.log('[KEEP-ALIVE] Ping failed:', err.message);
  });
  req.end();
}, 780000);

// --- AUTONOMY SEED: 6-hour health cron ---
setInterval(() => {
  const https = require('https');
  const options = {
    hostname: 'tcc-zenith-brain.onrender.com',
    path: '/api/stripe/status',
    method: 'GET',
    headers: { 'X-Auth': 'amos-bridge-2026' }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('[HEALTH-CRON] 6h check /api/stripe/status:', res.statusCode, data);
    });
  });
  req.on('error', (err) => {
    console.log('[HEALTH-CRON] 6h check failed:', err.message);
  });
  req.end();
}, 21600000);

