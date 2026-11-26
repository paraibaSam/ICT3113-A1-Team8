# A2 speed-test parameters (measured S)

Measured 2026-11-24T06:47:05+00:00 on the desktop, after `scripts/a2_desktop_reset.sh qwen7b` (fresh Ollama, digests checked) and the 3 fixed warm-ups.
Each ticket was sent alone through `POST /tickets` (wall-clock time measured on the desktop). Produced by `scripts/a2_measure_s.py`.

| Ticket row | Length (chars) | Time (s) | Answer |
|---|---|---|---|
| 8073 | 1153 | 4.42 | Debt collection |
| 8511 | 777 | 2.87 | Money transfer or service |
| 8014 | 976 | 3.44 | Mortgage |

- **S = 3.4 s** (middle of the three)
- **Rate:** one ticket every 2S = 6.8 s = **8.824 tickets/min** (0.1471 req/s)
- **Run length:** S minutes (minimum 5) = **300 s** → about **44 requests per run**
- **HTTP response timeout:** 10 × S (minimum 5 min) = **300 s**
- **Schedule pause after arrivals:** timeout + at least 1 min = **6 min**
- **Client peak (A1 workload model):** 0.016 req/s. The test rate is **above** the client peak, so a configuration that keeps up at this rate also handles the client's load.

Warm-up tickets (timings discarded): row 8692 12.95 s, row 8714 5.13 s, row 8093 3.59 s
