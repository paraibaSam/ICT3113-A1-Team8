# Stress test result

- File: `stress.jtl`  |  requests: 405  |  errors: 0
- Ramp (planned): 6/min to 48/min over 15 min; windows of 60 s by arrival time

| Minute | Planned rate (/min) | Requests | Mean ms | p50 ms | p95 ms | Max ms | In flight |
|---|---|---|---|---|---|---|---|
| 0 | 7.4 | 8 | 1957 | 1574 | 2638 | 2638 | 1.25 |
| 1 | 10.2 | 9 | 1953 | 1939 | 2990 | 2990 | 1.44 |
| 2 | 13 | 10 | 2138 | 1920 | 3742 | 3742 | 1.2 |
| 3 | 15.8 | 12 | 2529 | 2019 | 6007 | 6007 | 1.42 |
| 4 | 18.6 | 19 | 3260 | 3507 | 5713 | 5713 | 2.05 |
| 5 | 21.4 | 24 | 2751 | 2432 | 5498 | 5918 | 2.04 |
| 6 | 24.2 | 18 | 2629 | 2675 | 4682 | 4682 | 1.56 |
| 7 | 27 | 22 | 2749 | 1976 | 5823 | 7121 | 1.86 |
| 8 | 29.8 | 39 | 8989 | 8660 | 14895 | 15172 | 5.49 |
| 9 | 32.6 | 31 | 10086 | 9596 | 15291 | 16329 | 7 |
| 10 | 35.4 | 48 | 33612 | 33441 | 49383 | 49675 | 26.85 |
| 11 | 38.2 | 43 | 55228 | 55368 | 62578 | 66158 | 35.77 |
| 12 | 41 | 35 | 64749 | 64791 | 68576 | 68592 | 41.57 |
| 13 | 43.8 | 47 | 75894 | 72576 | 94517 | 95716 | 54.21 |
| 14 | 46.6 | 40 | 111282 | 111298 | 123715 | 127184 | 20.5 |

## What the test found

- Baseline latency (median of the first 3 windows): **1920 ms** (mean 2016 ms)
- Latency starts rising (p50 at least 2x baseline for two windows in a row): **window starting minute 8 (planned rate 29.8/min = 0.5 req/s)**
- Requirement breached (p95 above 5000 ms for two windows in a row): **window starting minute 3 (planned rate 15.8/min = 0.26 req/s)**
- Still climbing at the end: p50 slope over the last 3 windows = **23254 ms per minute** (latency is still growing: no steady state at the end of the ramp)
- Capacity estimate if one request is served at a time (1 / baseline mean): **29.76/min = 0.5 req/s**

Reading the result: the sustainable rate is the planned rate of the window just BEFORE latency starts rising. Compare it with the capacity estimate; a gap is expected, because random arrivals make queues form before the average load reaches capacity (the variability term in the Kingman formula). Each window holds only 10 to 50 requests, so its p95 is close to its maximum: read the trend, not single windows.
