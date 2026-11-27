# Ticket triage service (ICT3113 Assignment 1, Team 8)

This repository holds a ticket triage service and the tests we ran against it. `POST /tickets` waits while a
local model (Ollama, CPU only) classifies a complaint narrative into one of seven categories. The service has no
caching, queue, batching or retries. It is the plain baseline, and optimisation is Assignment 2.

The repository has the service, the golden test set, the prediction record, the test scripts, the raw JMeter
results, the service log, and a script that checks the results against that log (`scripts/reconcile_logs.js`).

## Results

We tested five models. The table gives accuracy on the 180 golden tickets, p95 latency at 0.10 requests per second
(mean of three runs) and capacity. Capacity is 1 divided by the mean single-request response time. At 0.20 requests
per second the three slowest models completed 0.19, 0.15 and 0.11 requests per second, which matches it. The full
load tables are in `results/load/load_summary.md`.

| Model | Accuracy | p95 at 0.10 req/s | Capacity (req/s) |
|---|---|---|---|
| gemma3:1b | 23.9% | 4.0 s | 0.49 (stress test: about 0.5) |
| qwen2.5:3b | 61.1% | 6.7 s | 0.36 |
| gemma3:4b | 70.6% | 13.1 s | 0.20 |
| qwen2.5:7b | 75.0% | 19.7 s | 0.15 |
| granite3.3:8b | 67.2% | 43.7 s | 0.11 |

The requirements were a p95 of 5 s or less and a p99 of 10 s or less at the required load (0.016 requests per
second), accuracy of at least 85% overall, and at least 70% in every category. No candidate meets all of them. The
best accuracy is 75.0% (qwen2.5:7b, which reaches 70% in 5 of the 7 categories). Only gemma3:1b meets the latency
requirement, and its accuracy is below the 29.4% a model would score by always answering the most common category.

We recommend gemma3:4b. It is the most accurate model that meets the p99 requirement at the required load. It
misses the p95 requirement (8.7 s) and both accuracy requirements. Ollama is the bottleneck: the service adds 3 to
4 ms per request, and in the stress test latency started to climb at about 0.5 requests per second, the same point
that 1/S gives for gemma3:1b.

## Repository layout

```
.
├── docker-compose.yml        service and Ollama (CPU only, OLLAMA_KEEP_ALIVE=-1)
├── .env.example              copy to .env and set OLLAMA_MODEL
├── service/                  Node.js, Express and SQLite triage service
├── data/service.log          append-only JSON-line log, kept for reconciliation
├── golden-set/               golden test set (CSV) and the labelling workbook
├── ICT3113_Team8_Prediction_Records.pdf   predictions, committed before the first benchmark run
├── jmeter/                   JMeter plans (0.10 and 0.20 req/s, stress ramp, pilot) and load_data.txt
├── scripts/                  accuracy test, load runner, summaries, reconciliation, confusion-matrix notebook
└── results/
    ├── <model>/              accuracy run: per_ticket_results.csv, summary.json and .md, confusion_matrix.png
    ├── heatmap_*.png, confusion_matrices_all_models.png
    ├── load/<model>/<rate>/  runs 1 to 3: .jtl, .jmx (exact plan), .data.txt (exact tickets), .log
    ├── load/                 also run_register.csv, load_summary.*, per_run_summary.csv
    ├── stress/gemma3_1b/     the stress run and its analysis
    ├── pilot/                a one-minute check of the setup, not a measurement
    ├── exploratory/          a discarded first attempt, kept as evidence (see Notes)
    └── reconciliation.txt    output of scripts/reconcile_logs.js
```

## Running the service

```bash
cp .env.example .env           # then set OLLAMA_MODEL to one of the tags below
docker compose up -d --build
docker compose exec ollama ollama pull gemma3:4b      # repeat for each model you want
docker compose exec triage-service printenv OLLAMA_MODEL
```

The candidate models are pinned by tag and digest. `ollama list` shows the first 12 characters of the digest.

| Tag | Digest |
|---|---|
| gemma3:1b | sha256:7cd4618c1faf8b7233c6c906dac1694b6a47684b37b8895d470ac688520b9c01 |
| gemma3:4b | sha256:aeda25e63ebd698fab8638ffb778e68bed908b960d39d0becc650fa981609d25 |
| qwen2.5:3b | sha256:5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6 |
| qwen2.5:7b | sha256:2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730 |
| granite3.3:8b | sha256:77bcee066a76dcdd10d0d123c87e32c8ec2c74e31b6ffd87ebee49c9ac215dca |

To switch model, stop the previous one with `docker compose exec ollama ollama stop <old tag>` (this also clears
Ollama's prompt cache), edit `.env`, run `docker compose up -d triage-service`, and check with `printenv` as above.

The service listens on port 3000.

| Endpoint | Behaviour |
|---|---|
| `POST /tickets` with `{"narrative": "..."}` | classifies with Ollama, stores the ticket in SQLite and returns `201 {id, category}`. Returns `400` if the narrative is empty. |
| `GET /search?q=` | LIKE match on narrative and category, up to 50 tickets, newest first. Returns `400` without `q`. |
| `GET /stats` | the total and a count for each of the 7 categories |
| `GET /health` | liveness check (not part of the specification) |

## Running the tests

The service and Ollama run on one machine, the desktop. JMeter runs on a separate machine, the laptop. We used
Docker 29.5.3, Ollama 0.34.4, Node.js 20, JMeter 5.6.3 and Java 1.8.

The accuracy test runs next to the service:

```bash
node scripts/accuracy_test.js --csv golden-set/ict3113_team8_golden_set_with_narratives.csv --model gemma3:4b
```

It sends the 180 golden tickets one at a time and writes `results/<model>/`. The confusion matrices and heatmaps
come from `scripts/confusion_matrices.ipynb`.

The load test runs on the laptop, from the repo root in PowerShell, after the desktop has been switched to the model:

```powershell
.\scripts\run_load.ps1 -Model gemma3:4b -Rates 0.10rps,0.20rps
```

Each rate gets three runs, interleaved. A run is 5 minutes of random (Poisson) arrivals from JMeter's Open Model
Thread Group, which is open loop: 30 requests at 0.10 req/s and 60 at 0.20 req/s. Every request carries a ticket that
model has not seen yet. Each run takes its own block of `jmeter/load_data.txt`, which holds 820 narratives from rows
8000 to 8999 with the golden tickets removed, shuffled with seed 13 (`scripts/make_load_data.js`). Every model gets the
same blocks. JMeter interrupts requests that are still running when a schedule ends, so the runner adds a pause of
1 to 7 minutes to the end of each schedule, depending on model and rate. After each run it checks the request count,
errors, cut-off requests and whether the request sizes match the intended tickets. Pass `-JMeter` and `-HostIp` if
JMeter or the desktop are somewhere else. The 0.05 req/s plan was prepared but not run, so always pass
`-Rates 0.10rps,0.20rps`.

The stress test used gemma3:1b only. `.\scripts\run_load.ps1 -Model gemma3:1b -Stress` ramps the arrival rate from
0.10 to 0.80 req/s over 15 minutes (405 new tickets). `node scripts/analyse_stress.js results/stress/gemma3_1b/stress.jtl`
then reports where latency starts to rise (p50 at least twice the baseline for two 60-second windows) and where p95
exceeds 5 s.

`node scripts/summarize_load.js results/load` produces p50, p95, p99, throughput and error rate, with the mean and
range over the three runs.

## Logs and reconciliation

`data/service.log` is append-only. It holds these entries, in order:

| When (UTC) | Lines | What |
|---|---|---|
| 26 Sep | 6 classifications, 1 error | smoke tests with llama3.2:1b. The error is a malformed JSON request sent during testing. |
| 6 Oct | 180 (llama3.2:1b) | an unplanned first run with a model that is not a candidate. Kept, not reported. |
| 6 Oct | 5 x 180, plus 1 test ticket for gemma3:1b | the five accuracy runs |
| 8 Oct | 271 per model (gemma3:1b: 362) | load runs: 270 requests plus one warm-up ticket per script run. The gemma3:1b figure also includes the two superseded runs and their reruns. |
| 9 Oct | 406 | the gemma3:1b stress run: 405 requests plus one warm-up |

That is 2,939 classifications in total. For every load and stress run, `scripts/reconcile_logs.js` checks three
things. The number of `POST /tickets` lines the service logged in the run's window must equal the rows in the `.jtl`.
Every classification in that window must name the run's model. JMeter's elapsed time must never be below the
service's own duration for the same request. The median gap is 8 to 24 ms per run, and the largest is 738 ms in the
stress test, when 62 requests were in flight. For the accuracy runs it checks that the predictions match the log's
classifications in order. All runs reconcile, and the output is in `results/reconciliation.txt`.

The log does not contain the 6-request pilot (`results/pilot/`) or the discarded first load attempt described below,
because the log was restored to its last commit before the reruns. `run_register.csv` has one row per run. Two
gemma3:1b rows, the runs at 0.10 and 0.20 req/s that start on 8 Oct at 09:02 and 09:09, were replaced by reruns at 13:33
and 13:40.

## Notes

The first gemma3:1b load attempt sent the same first tickets on every run. Repeats were answered at a median of
about 0.23 s, against about 1.5 s for new tickets, although not every ticket sped up. Ollama's prompt cache is the
likely cause, but we have not proved it. We discarded that attempt and kept its raw files in `results/exploratory/`.

The laptop's clock ran about 1 s ahead of the desktop's, and the reconciliation window allows for that.

There is one accuracy run per model, and each load run has 30 or 60 requests, so p95 and p99 rest on the slowest
two or three requests. The range across the three runs matters as much as the mean.

All results use the single zero-shot prompt in `service/src/ollamaClient.js` with exact-match parsing. Parser
fallbacks are logged as `fallback_used` and were not corrected.

The golden set has 180 tickets labelled independently by two team members (Cohen's kappa 0.866). It was frozen and
committed together with the prediction record before the first benchmark run.

## Acknowledgements

We used Claude (Anthropic) to create the automation scripts: the accuracy test, the load and stress tooling
(`run_load.ps1`, `make_load_data.js`, `summarize_load.js`, `analyse_stress.js`, `reconcile_logs.js`) and the JMeter
test plans. The team checked the plans in JMeter, adjusted some JMeter settings, ran every test on its own machines, and checked the results against the service logs. The team made the decisions on requirements, candidate models and the recommendation.
