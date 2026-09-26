# Ticket Triage Service (Assignment 1 baseline)

A synchronous ticket classification service: `POST /tickets` blocks until the
model backend (Ollama, CPU-only) has classified the ticket. No caching, no
queuing, no batching - deliberately the straightforward implementation, per
the assignment brief. Optimisation is Assignment 2.

## Stack

- Node.js + Express
- SQLite (`better-sqlite3`) for storage - a single file, no separate DB container
- Ollama for model inference, run in its own container, CPU only

## Project layout

```
.
├── docker-compose.yml       # wires triage-service + ollama together
├── .env.example             # copy to .env to set OLLAMA_MODEL
├── data/                    # bind-mounted: tickets.db + service.log land here
└── service/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── index.js         # Express app: POST /tickets, GET /search, GET /stats
        ├── db.js            # SQLite setup + queries
        ├── ollamaClient.js  # builds the prompt, calls Ollama, parses the category
        ├── categories.js    # the 7 fixed categories
        └── logger.js        # JSON-line request/classification logging
```

## Running it

```bash
cp .env.example .env
docker compose up -d --build
```

First run only - pull the model(s) you'll actually benchmark into the
`ollama` container (this is on the model container, not the host):

```bash
docker compose exec ollama ollama pull llama3.2:1b
# repeat for each candidate models, e.g.:
# docker compose exec ollama ollama pull qwen2.5:1.5b
# docker compose exec ollama ollama pull llama3.1:8b
```

Then switch which model the service calls by setting `OLLAMA_MODEL` in
`.env` (or as an env var override) and restarting the `triage-service`
container - no rebuild needed:

```bash
OLLAMA_MODEL=qwen2.5:1.5b docker compose up -d triage-service
```

For Step 4 (candidate models), pin and report **both** the tag and the
digest, e.g. via `docker compose exec ollama ollama show llama3.2:1b
--modelfile` or `ollama list` output - the tag alone isn't enough to
reproduce a result.

## Endpoints

### `POST /tickets`

```bash
curl -X POST http://localhost:3000/tickets \
  -H 'Content-Type: application/json' \
  -d '{"narrative": "My mortgage servicer will not release my escrow funds."}'
# -> 201 { "id": 1, "category": "Mortgage" }
```

Blocks until classification completes. Returns `400` if `narrative` is
missing or empty.

### `GET /search?q=...`

```bash
curl "http://localhost:3000/search?q=mortgage"
```

Matches against both the stored narrative and category (simple `LIKE`
query - no ranking, no fuzzy matching; this is the baseline).

### `GET /stats`

```bash
curl http://localhost:3000/stats
# -> { "total": 2, "by_category": { "Credit reporting": 0, "Mortgage": 1, ... } }
```

All seven categories are always present in the response, even at 0, so
callers don't have to guess whether a missing key means zero or a bug.

## Logs

Every request and every classification is written as one JSON line to
`data/service.log` (and to stdout, so `docker compose logs -f
triage-service` also works). Fields include request path/status/duration,
and for classifications: category, model, per-request classification
latency, and whether the model's raw output had to fall back to a default
category (`fallback_used: true`) because it didn't match any of the seven
categories.

**Keep `data/service.log` and your JMeter `.jtl` files in the repository**
for every run you report (per the assignment's Deliverables section) - the
brief requires every number in your report to reconcile with these logs.

## What's deliberately NOT here (baseline scope)

- No caching of classifications.
- No request queue - concurrent requests are handled by however many
  concurrent connections your load generator opens; the service does not
  throttle or buffer them itself.
- No retry logic against Ollama - a failed backend call surfaces as a
  `500` and is logged with the stack trace.
- No bulk import - the only way data enters the system is one ticket at a
  time via `POST /tickets`, matching how the client's real intake works.

## Testing load generator placement

Per Step 5 of the brief: **do not run JMeter on the same machine as this
service** when you get to load testing. A co-hosted load generator steals
CPU from the service and produces latency numbers that won't be accepted
as evidence. This docker-compose setup is for local development; your
actual benchmark runs need the service (+ Ollama) on one machine and
JMeter on another.
