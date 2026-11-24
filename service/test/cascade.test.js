// Offline tests for the A2 cascade rule (no Ollama needed).
// Run from the repo root: node --test service/test/
// Ollama is replaced by a mock `node-fetch` that answers from a per-model script.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
let answers = {}; // model -> function(narrative) -> raw text, or Error to throw
const calls = [];

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'node-fetch') {
    return async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ model: body.model, prompt: body.prompt, options: body.options });
      const a = answers[body.model];
      if (!a) return { ok: false, status: 404, statusText: 'Not Found', text: async () => `model ${body.model} not found` };
      const narrative = body.prompt.split('"""\n')[1].split('\n"""')[0];
      return { ok: true, json: async () => ({ response: a(narrative) }) };
    };
  }
  return origLoad.call(this, req, ...rest);
};

// Load a fresh copy of cascade.js under the given environment.
function load(env) {
  for (const k of ['CASCADE_SMALL_MODEL', 'CASCADE_LARGE_MODEL', 'CASCADE_ESCALATE', 'OLLAMA_MODEL']) delete process.env[k];
  Object.assign(process.env, env);
  for (const f of ['cascade.js', 'ollamaClient.js']) delete require.cache[path.join(SRC, f)];
  return require(path.join(SRC, 'cascade.js'));
}

const A = { CASCADE_SMALL_MODEL: 'small', CASCADE_LARGE_MODEL: 'large', CASCADE_ESCALATE: 'Credit card' };
const B = { ...A, CASCADE_ESCALATE: 'Debt collection, Credit card' };

test('single mode = A1 behaviour: one call to OLLAMA_MODEL', async () => {
  const { triage, config } = load({ OLLAMA_MODEL: 'solo' });
  answers = { solo: () => 'Mortgage' };
  calls.length = 0;
  const r = await triage('my mortgage');
  assert.equal(config.mode, 'single');
  assert.equal(r.category, 'Mortgage');
  assert.equal(r.model, 'solo');
  assert.equal(calls.length, 1);
  assert.equal(r.log.cascade_setting, 'single');
});

test('setting A: non-escalated category -> small answer only', async () => {
  const { triage, config } = load(A);
  answers = { small: () => 'Mortgage', large: () => { throw new Error('large must not be called'); } };
  calls.length = 0;
  const r = await triage('t1');
  assert.equal(config.setting, 'A');
  assert.deepEqual([r.category, r.model, r.log.escalated], ['Mortgage', 'small', false]);
  assert.deepEqual(calls.map((c) => c.model), ['small']);
});

test('setting A: Credit card -> escalated, large answer is final', async () => {
  const { triage } = load(A);
  answers = { small: () => 'Credit card', large: () => 'Bank account or service' };
  calls.length = 0;
  const r = await triage('t2');
  assert.deepEqual([r.category, r.model, r.log.escalated], ['Bank account or service', 'large', true]);
  assert.equal(r.log.small_category, 'Credit card');
  assert.equal(r.log.large_category, 'Bank account or service');
  assert.deepEqual(calls.map((c) => c.model), ['small', 'large']);
  assert.equal(r.classification_ms, r.log.small_ms + r.log.large_ms);
});

test('both calls use the identical A1 prompt and options', async () => {
  const { triage } = load(A);
  const { buildPrompt } = require(path.join(SRC, 'ollamaClient.js'));
  answers = { small: () => 'Credit card', large: () => 'Credit card' };
  calls.length = 0;
  await triage('same narrative');
  assert.equal(calls[0].prompt, buildPrompt('same narrative'));
  assert.equal(calls[1].prompt, calls[0].prompt);
  assert.deepEqual(calls[0].options, { temperature: 0 });
  assert.deepEqual(calls[1].options, { temperature: 0 });
});

test('setting A: Debt collection is NOT escalated; setting B escalates it', async () => {
  answers = { small: () => 'Debt collection', large: () => 'Credit reporting' };
  let m = load(A);
  assert.equal((await m.triage('t3')).log.escalated, false);
  m = load(B);
  assert.equal(m.config.setting, 'B');
  const r = await m.triage('t3');
  assert.deepEqual([r.log.escalated, r.category, r.model], [true, 'Credit reporting', 'large']);
});

test('fallback (unparseable "4") -> Credit reporting, accepted, flag logged', async () => {
  const { triage } = load(A);
  answers = { small: () => '4', large: () => { throw new Error('large must not be called'); } };
  const r = await triage('t4');
  assert.deepEqual([r.category, r.log.escalated, r.log.small_fallback_used, r.log.small_raw_output], ['Credit reporting', false, true, '4']);
});

test('no caching: same narrative twice -> small model called twice', async () => {
  const { triage } = load(A);
  answers = { small: () => 'Mortgage' };
  calls.length = 0;
  await triage('repeat');
  await triage('repeat');
  assert.equal(calls.length, 2);
});

test('Ollama error on the large model propagates (-> 500), no fallback to small', async () => {
  const { triage } = load({ ...A, CASCADE_LARGE_MODEL: 'missing' });
  answers = { small: () => 'Credit card' };
  await assert.rejects(triage('t5'), /missing/);
});

test('config validation', () => {
  assert.throws(() => load({ CASCADE_SMALL_MODEL: 'small' }), /incomplete/);
  assert.throws(() => load({ ...A, CASCADE_ESCALATE: 'Credit Card' }), /unknown categories/); // wrong case
  assert.throws(() => load({ ...A, CASCADE_LARGE_MODEL: 'small' }), /both small/);
  assert.equal(load({ ...A, CASCADE_ESCALATE: 'Mortgage' }).config.setting, 'custom');
});
