const express = require('express');
const { insertTicket, searchTickets, getStats } = require('./db');
const { triage, config: cascadeConfig } = require('./cascade');
const { log, requestLogger } = require('./logger');
const { CATEGORIES } = require('./categories');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// Simple liveness check - not part of the assignment spec, but useful for
// docker-compose healthchecks and for confirming the container is up
// before pointing JMeter at it.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// POST /tickets
// Fully synchronous: the response is not sent until classification is done.
// No caching, no queue. Assignment 1: one model (OLLAMA_MODEL). Assignment 2:
// optional category-based cascade (src/cascade.js, docs/escalation_rule.md),
// in which the small model classifies every ticket and the large model
// re-classifies tickets whose small-model category is in CASCADE_ESCALATE.
// The response is {id, category} either way, so the caller cannot tell which
// model answered; the log records it.
app.post('/tickets', async (req, res, next) => {
  try {
    const { narrative } = req.body || {};

    if (typeof narrative !== 'string' || narrative.trim().length === 0) {
      return res.status(400).json({ error: 'narrative (non-empty string) is required' });
    }

    const result = await triage(narrative);

    const id = insertTicket({
      narrative,
      category: result.category,
      model_used: result.model,
      classification_ms: result.classification_ms,
    });

    // `category` and `model` are the FINAL answer and the model that gave it
    // (same meaning as in A1). Cascade fields: see docs/escalation_rule.md §6.
    log({
      type: 'classification',
      ticket_id: id,
      category: result.category,
      model: result.model,
      classification_ms: result.classification_ms,
      ...result.log,
    });

    res.status(201).json({ id, category: result.category });
  } catch (err) {
    next(err);
  }
});

// GET /search?q=...
// Returns stored tickets whose narrative or category matches the text query.
app.get('/search', (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length === 0) {
      return res.status(400).json({ error: 'query parameter q is required' });
    }
    const results = searchTickets(q);
    res.json({ query: q, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

// GET /stats
// Counts of stored tickets by category. Categories with zero tickets so
// far are included with a count of 0, so consumers don't have to guess
// whether a missing key means "zero" or "not implemented".
app.get('/stats', (req, res, next) => {
  try {
    const stats = getStats();
    const by_category = Object.fromEntries(
      CATEGORIES.map((c) => [c, stats.by_category[c] || 0])
    );
    res.json({ total: stats.total, by_category });
  } catch (err) {
    next(err);
  }
});

// Centralised error handler. Logs the failure and returns a generic 500 -
// callers get a clean error, and the log file gets the actual stack trace
// for reconciliation.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  log({ type: 'error', path: req.originalUrl, message: err.message, stack: err.stack });
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  log({ type: 'startup', message: `ticket-triage-service listening on port ${PORT}`, triage_config: cascadeConfig });
});
