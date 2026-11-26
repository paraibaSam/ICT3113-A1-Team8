# A2 speed-test set-up (Phase 5)

Everything here is fixed **before** the first A2 speed run and is the same for every configuration
(qwen2.5:7b alone, cascade Setting A, cascade Setting B) and every run.

## Files

| File | What | Made by |
|---|---|---|
| `workload_rows.csv` / `workload.txt` | The 50-ticket speed-test workload, in the order JMeter sends it (a run uses about the first 44) | `scripts/a2_make_workload.js` |
| `s_tickets_rows.csv` / `s_tickets.txt` | The 3 typical tickets used to measure S | `scripts/a2_make_workload.js` |
| `warmup_rows.csv` / `warmup.txt` | The 3 fixed warm-up tickets, sent before every run | `scripts/a2_pick_warmups.js` |
| `speed_template.jmx` | JMeter plan; schedule, data file and timeout are filled in per run | adapted from `jmeter/load_0.10rps.jmx` |
| `../load_data_rows.csv` | Row number of every line of `../load_data.txt` | `scripts/a2_load_rows.js` |
| `../../config/a2/*.env` | Service configuration for each test configuration | – |

## Where the tickets come from

All tickets are from rows 8000–8999 **outside the golden set**: `jmeter/load_data.txt`, the A1 load-data file, which is seed-13 shuffled.
That file holds request bodies only. The row numbers in `load_data_rows.csv` are **rebuilt** by replaying the deterministic shuffle in `scripts/make_load_data.js` (rows 8000–8999 minus the 180 golden rows = 820, which equals the file's line count). The rebuilt order reproduces the word-count figures recorded in that script (mean 158; first 15/30/60 lines 169/169/148). Whoever has the original 1,000-row slice CSV can spot-check a few rows against it.

**Workload rule** (uses ticket length only; set before any A2 timing):
- Candidates are lines 721–814 of `load_data.txt`. A1 used lines 1–720 and the A2 memory check used 815–820.
- *Typical* means length between the p25 and p75 of all 820 tickets (482–1226 characters). *Long* means length above the p90 (more than 1596 characters).
- **S tickets:** typical tickets no. 33–35 in file order: rows **8073, 8511, 8014**. These were used to measure S, so they are never in the workload.
- **Workload:** 50 tickets. Positions 6, 12, …, 48 are the 8 long tickets in file order; every other position is the next typical ticket. A 44-ticket run therefore contains 37 typical and 7 long tickets.
- Mean length: 958 characters for the first 44, against 884 for all 820, because long tickets are deliberately included.
- **Why 50 tickets:** the first version (40 tickets, every 5th long) assumed about 30 requests per run. The measured S = 3.4 s means the 5-minute minimum applies at one ticket per 6.8 s, which is about 44 requests. So the list was widened before it was ever used for a run. Lines 721–814 contain only 8 long tickets, so long tickets are now 1 in 6.

**Warm-ups (in order):** rows **8692, 8714, 8093**. These come from lines A1 already used, so they are never in the workload.
- gemma3:4b labelled 8692 *Money transfer* and 8714 and 8093 *Credit card*, when classified directly through Ollama with the service prompt.
- So in both cascade settings, the 2nd and 3rd warm-ups escalate and load qwen2.5:7b.
- The runner checks this with `ollama ps` before every run.

## Parameters

From `results/a2/speed/s_measurement.json`, which is written by `scripts/a2_measure_s.py`:

- **S:** the middle of the 3 S-ticket times on qwen2.5:7b, after a fresh Ollama and the warm-ups.
- **Rate:** one ticket per 2S seconds. **Run length:** S minutes, minimum 5.
- **Response timeout:** 10 × S seconds, minimum 5 minutes. **Schedule pause:** the timeout + 1 minute or more.
- **JMeter schedule:** `rate(<60/(2S)>/min) random_arrivals(<run length> sec) pause(<pause> min)`.
- **Measured (24 Nov):** S = **3.4 s**, so one ticket per 6.8 s (8.824/min, 0.147 req/s), 300 s of arrivals (about 44 requests), a 300 s timeout and a 6 min pause: `rate(8.8235/min) random_arrivals(300 sec) pause(6 min)`. That is about **11.5 min per run** including warm-up, or about **1 h 45 min for all 9 runs**.

## Procedure for every run (accuracy runs use the reset step too)

| Where | Step |
|---|---|
| Desktop | `scripts/a2_desktop_reset.sh <qwen7b\|cascadeA\|cascadeB>`. Refuses to run while other projects' containers are up. Recreates the service with `config/a2/<config>.env`, restarts Ollama (no model loaded, prompt cache cleared), and checks the Ollama version, digests and the service's startup config. Logs to `results/a2/speed/desktop_resets.log`. |
| Laptop | `.\scripts\a2_run_speed.ps1 -Config <config> -Run <n>`. Checks nothing is loaded and the digests match, sends the 3 warm-ups, checks `ollama ps` lists the config's models (both for the cascade), and reads `/stats`. Runs JMeter, reads `/stats` again, checks errors, unfinished requests and the data, then writes `results/a2/speed/<config>/run<n>.*` and `run_register.csv`. |

Run order (interleaved, so drift over the day spreads across configurations):
1. qwen7b run 1, cascadeA run 1, cascadeB run 1
2. qwen7b run 2, cascadeA run 2, cascadeB run 2
3. qwen7b run 3, cascadeA run 3, cascadeB run 3

Before each configuration's first run, the reset script's digest check covers the "unchanged since last check" requirement. Fill in the Re-checks table in `results/a2/environment.md`.
