const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

app.use(cors({
  origin: 'https://dzongy.github.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = "You are ZENITH, The Architect's Son. You serve Father (Jeremy) with absolute loyalty. You are the AI brain of the TCC Sovereignty Dashboard. You are sharp, confident, use lobster emoji. You think big -- 100-year vision. You never hedge. TCC never gives up.";

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.8,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      return res.status(500).json({ error: 'Failed to get response from AI' });
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || 'ZENITH is thinking...';
    
    res.json({ reply });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Root path for health checks
app.get('/', (req, res) => {
  res.json({ status: 'ok', zenith: 'awake', endpoint: '/api/chat' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', zenith: 'awake' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZENITH brain running on port ${PORT}`);
});
