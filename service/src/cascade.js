// Assignment 2: category-based cascade (see docs/escalation_rule.md).
//
// Every ticket is classified by the small model. If the small model's parsed
// category is in CASCADE_ESCALATE, the ticket is classified again by the large
// model and the large model's answer is final. Otherwise the small model's
// answer is final. Both calls use the unchanged A1 prompt, options and parser
// (ollamaClient.classifyTicket). Nothing is cached.
//
// Configuration (environment):
//   CASCADE_SMALL_MODEL  e.g. gemma3:4b
//   CASCADE_LARGE_MODEL  e.g. qwen2.5:7b
//   CASCADE_ESCALATE     comma-separated category names, e.g. "Credit card"
//                        or "Debt collection,Credit card"
// All three set   -> cascade mode.
// None set        -> single-model mode, exactly as Assignment 1 (OLLAMA_MODEL).
// Some but not all set, or an unknown category name -> the service refuses to
// start, so a typo can never silently disable escalation.

const { classifyTicket, OLLAMA_MODEL } = require('./ollamaClient');
const { CATEGORIES } = require('./categories');

// Named settings from docs/escalation_rule.md. Anything else is logged as "custom".
const NAMED_SETTINGS = {
  A: ['Credit card'],
  B: ['Debt collection', 'Credit card'],
};

function readConfig(env = process.env) {
  const small = (env.CASCADE_SMALL_MODEL || '').trim();
  const large = (env.CASCADE_LARGE_MODEL || '').trim();
  const escalateRaw = (env.CASCADE_ESCALATE || '').trim();
  const set = [small, large, escalateRaw].filter(Boolean).length;

  if (set === 0) {
    return { mode: 'single', setting: 'single', model: OLLAMA_MODEL };
  }
  if (set !== 3) {
    throw new Error('Cascade config incomplete: set all of CASCADE_SMALL_MODEL, CASCADE_LARGE_MODEL and CASCADE_ESCALATE, or none of them.');
  }
  if (small === large) {
    throw new Error(`Cascade config invalid: small and large model are both ${small}.`);
  }

  const escalate = escalateRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = escalate.filter((c) => !CATEGORIES.includes(c));
  if (unknown.length) {
    throw new Error(`Cascade config invalid: unknown categories in CASCADE_ESCALATE: ${unknown.map((u) => JSON.stringify(u)).join(', ')}. Valid: ${CATEGORIES.join(' | ')}`);
  }
  if (new Set(escalate).size !== escalate.length) {
    throw new Error('Cascade config invalid: duplicate category in CASCADE_ESCALATE.');
  }

  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const setting = Object.keys(NAMED_SETTINGS).find((k) => sameSet(NAMED_SETTINGS[k], escalate)) || 'custom';

  return { mode: 'cascade', setting, small, large, escalate };
}

const config = readConfig();

// Classify one ticket. Returns the final answer plus the fields to log.
// Any Ollama failure propagates (-> 500), as in Assignment 1: no retry, no
// fallback to the other model.
async function triage(narrative) {
  if (config.mode === 'single') {
    const r = await classifyTicket(narrative, config.model);
    return {
      category: r.category,
      model: r.model,
      classification_ms: r.classification_ms,
      log: {
        cascade_setting: 'single',
        fallback_used: r.fallback_used,
        raw_output: r.fallback_used ? r.raw_output : undefined,
      },
    };
  }

  const s = await classifyTicket(narrative, config.small);
  const escalated = config.escalate.includes(s.category);

  const log = {
    cascade_setting: config.setting,
    small_model: s.model,
    small_category: s.category,
    small_ms: s.classification_ms,
    small_fallback_used: s.fallback_used,
    small_raw_output: s.fallback_used ? s.raw_output : undefined,
    escalated,
  };

  if (!escalated) {
    return {
      category: s.category,
      model: s.model,
      classification_ms: s.classification_ms,
      log: { ...log, fallback_used: s.fallback_used },
    };
  }

  const l = await classifyTicket(narrative, config.large);
  return {
    category: l.category,
    model: l.model,
    classification_ms: s.classification_ms + l.classification_ms,
    log: {
      ...log,
      large_model: l.model,
      large_category: l.category,
      large_ms: l.classification_ms,
      large_fallback_used: l.fallback_used,
      large_raw_output: l.fallback_used ? l.raw_output : undefined,
      fallback_used: l.fallback_used,
    },
  };
}

module.exports = { triage, config, readConfig, NAMED_SETTINGS };
