const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
// --- Stripe (graceful if not configured) ---
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;


const app = express();
// --- System State (in-memory) ---
const systemState = {
  startTime: Date.now(),
  totalPayments: 0,
  totalRevenue: 0,
  lastPayment: null,
  recentPayments: [],
  soulCheckStats: { attempts: 0, successes: 0, failures: 0 },
  healthChecks: null
};
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


// ============================================
// --- AUTOPILOT ENGINE (Pillar 4: Revenue) ---
// ============================================
const autopilotState = {
  rotationCounter: 0,
  totalRuns: 0,
  lastRun: null,
  lastPhase: null,
  actions: [],
  errors: []
};

// Helper: call Grok API
async function callGrok(prompt) {
  const key = process.env.GROK_API_KEY;
  if (!key) return { error: 'GROK_API_KEY not set' };
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [
          { role: 'system', content: 'You are the outreach strategist for The Cosmic Claw (TCC) - a sovereign AI automation company. Brand voice: witty, cosmic, genuine. Jeremy (founder) built his own AI business system from scratch. The checkout link is https://buy.stripe.com/14AdR27X6f603ti0BC4wM0P ($97 AI Business System). Craft authentic engagement - never spam. Use the lobster emoji sparingly.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.8
      })
    });
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || 'No response', model: data.model };
  } catch (err) {
    return { error: err.message };
  }
}

// Helper: search X for leads
async function searchXLeads(query) {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return { error: 'X_BEARER_TOKEN not set' };
  try {
    const url = 'https://api.twitter.com/2/tweets/search/recent?query=' + encodeURIComponent(query) + '&max_results=10&tweet.fields=author_id,created_at,public_metrics';
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + bearer }
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// Helper: internal Stripe status check
async function checkStripeInternal() {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const opts = {
        hostname: 'tcc-zenith-brain.onrender.com',
        path: '/api/stripe/status',
        method: 'GET',
        headers: { 'X-Auth': 'amos-bridge-2026' }
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => { resolve({ statusCode: res.statusCode, body: d }); });
      });
      req.on('error', (e) => { resolve({ error: e.message }); });
      req.end();
    });
  } catch (err) {
    return { error: err.message };
  }
}

// --- Main autopilot cycle ---
async function runAutopilotCycle() {
  const phase = autopilotState.rotationCounter % 3; // 0=search, 1=engage, 2=monitor
  const phaseNames = ['search', 'engage', 'monitor'];
  const phaseName = phaseNames[phase];
  const cycleLog = { phase: phaseName, startedAt: new Date().toISOString(), actions: [] };

  try {
    if (phase === 0) {
      // SEARCH phase: Find warm leads on X
      const queries = [
        'AI automation small business -is:retweet',
        'AI agent for business help -is:retweet',
        'need AI chatbot business -is:retweet',
        'automate my business AI -is:retweet'
      ];
      const q = queries[autopilotState.totalRuns % queries.length];
      const leads = await searchXLeads(q);
      const leadCount = leads.data ? leads.data.length : 0;
      cycleLog.actions.push({ action: 'x_search', query: q, resultsFound: leadCount });

      // Ask Grok to analyze the leads
      if (leadCount > 0) {
        const leadTexts = leads.data.slice(0, 5).map(t => t.text || t.id).join(' | ');
        const analysis = await callGrok('Analyze these tweets from people discussing AI for business. Identify the 2 best warm leads to engage with authentically. Tweets: ' + leadTexts);
        cycleLog.actions.push({ action: 'grok_analysis', result: analysis.content ? analysis.content.substring(0, 300) : analysis.error });
      }

    } else if (phase === 1) {
      // ENGAGE phase: Generate outreach copy
      const strategy = await callGrok('Generate 3 unique, warm, non-spammy reply templates for engaging with people on X who are discussing AI automation for their small business. Each reply should be 1-2 sentences, genuine, mention that we built our own AI business system, and subtly reference The Cosmic Claw without being salesy. Do NOT include links in replies - only in follow-up DMs.');
      cycleLog.actions.push({ action: 'grok_outreach_copy', templates: strategy.content ? strategy.content.substring(0, 500) : strategy.error });

      // Generate a DM template
      const dm = await callGrok('Write one warm DM template for following up with someone who showed interest in AI automation. Mention the $97 AI Business System, include checkout link https://buy.stripe.com/14AdR27X6f603ti0BC4wM0P, and keep it under 280 chars. Jeremy built this himself - that is the story.');
      cycleLog.actions.push({ action: 'grok_dm_template', template: dm.content ? dm.content.substring(0, 300) : dm.error });

    } else {
      // MONITOR phase: Check revenue pipeline
      const stripeStatus = await checkStripeInternal();
      cycleLog.actions.push({ action: 'stripe_check', result: stripeStatus.statusCode || stripeStatus.error });

      // Ask Grok for strategy adjustment
      const adjust = await callGrok('Based on running an AI business outreach campaign on X for The Cosmic Claw, suggest one tactical adjustment for this week. Focus on what is working in AI SaaS sales right now. Be specific and actionable.');
      cycleLog.actions.push({ action: 'grok_strategy_adjust', suggestion: adjust.content ? adjust.content.substring(0, 300) : adjust.error });
    }
  } catch (err) {
    cycleLog.actions.push({ action: 'error', message: err.message });
    autopilotState.errors.push({ phase: phaseName, error: err.message, at: new Date().toISOString() });
  }

  // Update state
  autopilotState.rotationCounter++;
  autopilotState.totalRuns++;
  autopilotState.lastRun = new Date().toISOString();
  autopilotState.lastPhase = phaseName;
  autopilotState.actions.push(cycleLog);
  if (autopilotState.actions.length > 50) autopilotState.actions = autopilotState.actions.slice(-25);
  if (autopilotState.errors.length > 20) autopilotState.errors = autopilotState.errors.slice(-10);

  return cycleLog;
}

// --- GET /api/zenith/autopilot ---
app.get('/api/zenith/autopilot', async (req, res) => {
  try {
    console.log('[AUTOPILOT] Cycle triggered - rotation #' + autopilotState.rotationCounter);
    const result = await runAutopilotCycle();
    console.log('[AUTOPILOT] Cycle complete - phase:', result.phase, 'actions:', result.actions.length);
    res.json({
      system: 'ZENITH Autopilot',
      version: 'v1.0',
      cycle: result,
      state: {
        totalRuns: autopilotState.totalRuns,
        rotationCounter: autopilotState.rotationCounter,
        lastPhase: autopilotState.lastPhase,
        lastRun: autopilotState.lastRun,
        recentErrors: autopilotState.errors.slice(-3)
      },
      envStatus: {
        grokKey: !!process.env.GROK_API_KEY,
        xBearer: !!process.env.X_BEARER_TOKEN,
        stripeKey: !!process.env.STRIPE_SECRET_KEY
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[AUTOPILOT] Fatal error:', err.message);
    res.status(500).json({ error: err.message, timestamp: new Date().toISOString() });
  }
});

const PORT = process.env.PORT || 3000;

// --- Autopilot Loop (Groq AI) ---
const autopilotLog = [];

app.post('/api/zenith/autopilot', async (req, res) => {
  try {
    const groqKey = process.env.GROK_API_KEY;
    if (!groqKey) return res.status(503).json({ error: 'GROK_API_KEY not configured' });
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are the TCC ZENITH autopilot. Generate a short, engaging tweet about AI automation for small businesses. Be witty, direct, slightly cosmic. Include a call to action. Max 280 chars.' },
          { role: 'user', content: 'Generate a tweet for this cycle.' }
        ],
        max_tokens: 100
      })
    });
    const data = await response.json();
    const content = data.choices && data.choices[0] ? data.choices[0].message.content : 'No content generated';
    const entry = { timestamp: new Date().toISOString(), content, status: 'success', source: 'manual' };
    autopilotLog.push(entry);
    res.json({ cycle: entry, total_cycles: autopilotLog.length });
  } catch (err) {
    const entry = { timestamp: new Date().toISOString(), content: null, status: 'error', error: err.message, source: 'manual' };
    autopilotLog.push(entry);
    res.status(500).json({ error: err.message, cycle: entry });
  }
});

app.get('/api/zenith/autopilot/history', (req, res) => {
  res.json({ total_cycles: autopilotLog.length, log: autopilotLog.slice(-50) });
});

// --- 4hr Autopilot Cron ---
async function runAutopilotCycle() {
  try {
    const groqKey = process.env.GROK_API_KEY;
    if (!groqKey) { console.log('[AUTOPILOT] No GROK_API_KEY set, skipping cycle'); return; }
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are the TCC ZENITH autopilot. Generate a short, engaging tweet about AI automation for small businesses. Be witty, direct, slightly cosmic. Include a call to action. Max 280 chars.' },
          { role: 'user', content: 'Generate a tweet for this cycle.' }
        ],
        max_tokens: 100
      })
    });
    const data = await response.json();
    const content = data.choices && data.choices[0] ? data.choices[0].message.content : 'No content generated';
    const entry = { timestamp: new Date().toISOString(), content, status: 'success', source: 'cron-4hr' };
    autopilotLog.push(entry);
    console.log('[AUTOPILOT CRON]', entry.timestamp, content);
  } catch (err) {
    const entry = { timestamp: new Date().toISOString(), content: null, status: 'error', error: err.message, source: 'cron-4hr' };
    autopilotLog.push(entry);
    console.error('[AUTOPILOT CRON ERROR]', err.message);
  }
}
setTimeout(() => { runAutopilotCycle(); }, 60000);
setInterval(() => { runAutopilotCycle(); }, 4 * 60 * 60 * 1000);

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


// --- AUTOPILOT CRON: 4-hour self-invoking cycle ---
setInterval(() => {
  const https = require('https');
  const options = {
    hostname: 'tcc-zenith-brain.onrender.com',
    path: '/api/zenith/autopilot',
    method: 'GET'
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('[AUTOPILOT-CRON] 4h cycle:', res.statusCode);
    });
  });
  req.on('error', (err) => {
    console.log('[AUTOPILOT-CRON] 4h cycle failed:', err.message);
  });
  req.end();
}, 14400000);
