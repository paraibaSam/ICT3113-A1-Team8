# Cascade smoke test (24 Nov 2026)

Check that the A2 cascade in `POST /tickets` works before any benchmark run. **Not a measurement.**

- The service ran with a separate log and DB (`LOG_PATH`/`DB_PATH` overridden), so `data/service.log` and the `/stats` total used for the benchmark runs are untouched.
- Tickets: 4 **tuning-set** rows (8094, 8096, 8382, 8307), chosen because gemma3:4b labelled them Credit card, Credit card, Debt collection and Mortgage in A1. No test-set rows were used.
- Run order: Setting A, Setting B, single mode (qwen2.5:7b). Ollama was **not** restarted between modes, so the B and single times are prompt-cache hits and mean nothing.

| Row | Setting A | Setting B | Single (qwen2.5:7b) |
|---|---|---|---|
| 8094 | gemma CC → **escalated** → qwen BA | gemma CC → **escalated** → qwen BA | BA |
| 8096 | gemma CC → **escalated** → qwen BA | gemma CC → **escalated** → qwen BA | BA |
| 8382 | gemma DC → accepted | gemma DC → **escalated** → qwen DC | DC |
| 8307 | gemma MO → accepted | gemma MO → accepted | MO |

Also checked: empty narrative returns 400; `/stats` counts the 4 tickets; the response is `{id, category}` only; the startup line logs the active config. Offline unit tests: `node --test service/test/` (9 pass).
