const fetch = require('node-fetch');
const { CATEGORIES } = require('./categories');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

function buildPrompt(narrative) {
  return `You are a ticket triage classifier for a financial services complaints desk.
Classify the customer complaint narrative below into EXACTLY ONE of these seven categories:
${CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Respond with ONLY the category name, exactly as written above. No explanation, no punctuation, nothing else.

Narrative:
"""
${narrative}
"""

Category:`;
}

// The model is asked for exactly one category name, but nothing stops it
// from wrapping that in extra words, punctuation, or getting it wrong.
// This is a straightforward, unoptimised match: exact match first, then
// substring search, then a fixed fallback. Every fallback is logged so it
// shows up in the service logs and can be reconciled/audited later.
function parseCategory(rawText) {
  const cleaned = (rawText || '').trim();
  const cleanedLower = cleaned.toLowerCase();

  const exact = CATEGORIES.find((c) => c.toLowerCase() === cleanedLower);
  if (exact) return { category: exact, fallback_used: false };

  const substringMatch = CATEGORIES.find((c) => cleanedLower.includes(c.toLowerCase()));
  if (substringMatch) return { category: substringMatch, fallback_used: false };

  // Model output didn't match any known category. Fall back to a fixed
  // default rather than crash the request. This is a real limitation worth
  // reporting on, not something to hide - see the "fallback_used" flag
  // that gets logged alongside every classification.
  return { category: CATEGORIES[0], fallback_used: true, raw_output: cleaned };
}

async function classifyTicket(narrative) {
  const start = Date.now();

  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: buildPrompt(narrative),
      stream: false,
      options: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText} ${body}`);
  }

  const data = await response.json();
  const elapsedMs = Date.now() - start;
  const { category, fallback_used, raw_output } = parseCategory(data.response);

  return {
    category,
    fallback_used,
    raw_output,
    model: OLLAMA_MODEL,
    classification_ms: elapsedMs,
  };
}

module.exports = { classifyTicket, buildPrompt, parseCategory, OLLAMA_MODEL, OLLAMA_HOST };
