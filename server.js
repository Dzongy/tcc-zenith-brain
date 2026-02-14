const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Stripe webhook needs raw body - MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = JSON.parse(req.body);
    console.log('Stripe webhook:', event.type);
    res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// JSON parser for all other routes
app.use(express.json());

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'alive', version: '4.0.0-nuclear', timestamp: new Date().toISOString() });
});

// Groq status
app.get('/api/groq/status', (req, res) => {
  res.json({ configured: !!process.env.GROQ_API_KEY, model: 'llama-3.3-70b-versatile' });
});

// Groq chat proxy - THE credit independence route
app.post('/api/groq', async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set' });
    
    // Auth check
    const authHeader = req.headers.authorization || req.headers['x-api-key'];
    const expectedKey = process.env.API_SECRET || process.env.ZENITH_API_KEY;
    if (expectedKey && authHeader !== expectedKey && authHeader !== 'Bearer ' + expectedKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { prompt, messages, model, max_tokens } = req.body;
    const chatMessages = messages || [{ role: 'user', content: prompt || 'Hello' }];
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', messages: chatMessages, max_tokens: max_tokens || 1024 })
    });
    
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (e) {
    console.error('Groq error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Chat endpoint (alias)
app.post('/api/chat', async (req, res) => {
  req.url = '/api/groq';
  app.handle(req, res);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log('TCC ZENITH v4.0.0-nuclear on port ' + PORT));
