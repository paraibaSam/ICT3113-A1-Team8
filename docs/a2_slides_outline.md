# A2 slides outline: `Group08_A2.pptx` (max 8 slides)

Slide list and required content come from the brief (Deliverables → Slide requirements).

**How to use this file**
- Numbers that are already measured are written in. Numbers still to come are `{{PLACEHOLDERS}}`. The table at the end ([Numbers to fill](#numbers-to-fill)) says which file and command each one comes from.
- Search for `{{` to find every gap, and `TODO` for things a person must decide or write.
- Every figure on slides 4–7 must trace to a `.jtl` file or the service log. Keep the "Source" line under each slide accurate, and put it in the speaker notes.
- Show counts next to every percentage (right/n), as the brief requires.

Category short names used below: CR Credit reporting · DC Debt collection · MO Mortgage · CC Credit card · BA Bank account or service · CL Consumer loan · MT Money transfer or service.

---

## Slide 1: Cover (owner: C)

**Title:** Fast triage within an accuracy floor: cascade vs single model on CPU-only Ollama

- Group 08: TODO names and student IDs (5 members)
- Repository: TODO paste the HTTPS link (origin is `paraibaSam/ICT3113-A1-Team8`); state the branch or tag that was submitted
- **Top A1 model:** qwen2.5:7b, A1 accuracy on the full golden set **135/180 = 75.0%**
- **Test set** (even rows of the row_id-sorted golden set, 90 tickets): qwen2.5:7b **71/90 = 78.9%** (A1 records). Re-run on the A2 desktop: **70/90 (77.8%)**, with 89/90 answers identical
- **Overall limit:** 78.9% − 10 pp = **68.9% (at least 62/90)**
- **Per-category limits** (qwen2.5:7b on the test set − 15 pp):

| | CR | DC | MO | CC | BA | CL | MT |
|---|---|---|---|---|---|---|---|
| Test n | 25 | 7 | 18 | 7 | 11 | 9 | 13 |
| qwen2.5:7b | 23/25 (92.0%) | 4/7 (57.1%) | 16/18 (88.9%) | 5/7 (71.4%) | 9/11 (81.8%) | 4/9 (44.4%) | 10/13 (76.9%) |
| Limit | 77.0% (≥20) | 42.1% (≥3) | 73.9% (≥14) | 56.4% (≥4) | 66.8% (≥8) | 29.4% (≥3) | 61.9% (≥9) |
| Too small (<10)? | | **yes** | | **yes** | | **yes** | |

Small note on the slide: limits are derived from the A1 records, as the brief defines them. If they're recalculated from the A2 rerun (70/90), the overall limit becomes 67.8% (≥61/90) and Bank account ≥7/11 (other categories unchanged). **Every configuration's pass/fail is the same under either set.**

Source: `results/a2/accuracy_singles/summary.md`, `golden-set/a2_split.csv` (split committed in `cf1eb1c`); rerun: `results/a2/accuracy_cascade/qwen7b/summary.md`.

---

## Slide 2: Cascade design (owners: C + B)

**Diagram** (TODO draw): `POST /tickets` → gemma3:4b (every ticket) → is the predicted category in the escalation set? → **no:** return gemma's answer · **yes:** qwen2.5:7b classifies → return qwen's answer. Response is always `{id, category}`; the log records which model answered and whether the ticket was escalated.

**Rule in full** (`docs/escalation_rule.md`):
- Small model **gemma3:4b**, large model **qwen2.5:7b**. Both are A1 candidates, with the same prompt, parser and Ollama settings as A1.
- Escalate when gemma3:4b's **predicted** category is in the escalation set. The true category is unknown at run time.
- Unparseable small-model output falls back to "Credit reporting", as in A1. It is accepted, not escalated.
- Errors return 500 as in A1: no retry and no fallback to the other model. No caching.

**Settings tested:**

| Setting | Escalate when gemma3:4b predicts |
|---|---|
| A | Credit card |
| B | Debt collection, Credit card |

**Why this rule** (tuning set only, `results/a2/rule_design/tuning_analysis.md`):
- gemma3:4b's main failure is Bank account tickets labelled Credit card, and qwen2.5:7b recovers most of them.
- Category-based escalation needs no extra model call, so it has the lowest overhead. The other approaches in the brief add a call (agreement, self-reported confidence), and length didn't predict errors in our data.
- Break-even escalation is about 24% (A1 timings). Setting A sits below it and Setting B above it, so the two settings show the trade-off.

**Memory check:** both models stay loaded together. `ollama ps` lists gemma3:4b (2.68 GiB) and qwen2.5:7b (4.71 GiB), with no reload after the first load (`load_duration` 2 ms). Source: `results/a2/memory_check.txt`.

---

## Slide 3: Test environment and method (owner: A)

**Machines**
- **Service: a different desktop from A1** (the brief asks for this to be reported and explained). Reason: TODO, e.g. the A1 machine belongs to another member and wasn't available. A1 machine: TODO CPU / logical CPUs / RAM given to Docker and Ollama. A2 desktop: AMD Ryzen 7 7800X3D (8C/16T), 16 logical CPUs and 15.2 GiB visible to WSL2/Docker, no container limits, CPU only. Ollama 0.34.4 with `NUM_PARALLEL=1`, `KEEP_ALIVE=-1` and context 4096, held constant for all configurations. Source: `results/a2/environment.md`.
- **What the change affects:** all A2 speeds are measured on the A2 desktop; no A1 speed figure is reused. qwen2.5:7b was re-scored here on the 90 test tickets: 70/90 vs 71/90 in A1, 89/90 identical answers, same pass/fail for every configuration. The other single models' accuracies are A1 records from the A1 machine.
- **Load generator:** a separate laptop running JMeter 5.6.3. TODO laptop model, CPU, RAM and Java version.
- **Network:** TODO describe the final set-up, e.g. "laptop and desktop on the same wifi hotspot (10.71.149.x); service reached through Windows port forwarding into WSL".

**Arrival rate (S method)**
- After a fresh Ollama and the warm-up, 3 typical tickets were sent to qwen2.5:7b, one at a time: rows **8073 (4.42 s), 8511 (2.87 s), 8014 (3.44 s)**, giving **S = 3.4 s**.
- Rate: one ticket per 2S = **6.8 s**, i.e. **8.82/min (0.147 req/s)**, open model with random arrivals.
- Run length: max(S min, 5 min) = **5 min**, about **44 requests per run**.
- Client peak (A1 workload model) is 0.016 req/s. The test rate is **above** it.
- Source: `results/a2/speed/s_measurement.md`.

**Workload:** 50 fixed non-golden tickets from rows 8000–8999, in a fixed order, identical for every configuration. Every 6th ticket is long (>p90 length); the rest are typical (p25–p75). A run uses the first ~44 (37 typical + 7 long). The row list is in `jmeter/a2/workload_rows.csv` (a supporting file).

**Each run:**
1. Recreate the service with the configuration, restart Ollama (prompt cache cleared, no model loaded) and check digests and version.
2. Send 3 fixed warm-ups (rows 8692, 8714, 8093) and discard them. The 2nd and 3rd are escalated by both settings, so both models are warm. Check that `ollama ps` lists the configuration's models.
3. Read `/stats`, run JMeter, read `/stats` again.
4. **Drain:** HTTP timeout 10×S, minimum **300 s**; schedule pause **6 min** (longer than the timeout).
5. Run order interleaved: qwen7b → A → B, repeated 3 times.

**Changes from A1:**
- New rate and run length, from the S method.
- A2 workload and warm-up tickets.
- Network set-up: TODO.
- gemma3:1b removed from the machine. Its A1 records are reused, and it fails accuracy anyway.
- **Different service machine from A1** (see the Service line above).
- qwen2.5:7b re-scored on the test set on the A2 desktop, because the machine changed: 70/90 vs 71/90.
- TODO: the cascadeA run 1 rerun, if one is done (see the open issues at the end).

---

## Slide 4: Accuracy results (owner: D)

90 test tickets, sent once per configuration through `POST /tickets`. Single models reuse their A1 prediction records, scored on test rows only (say this on the slide). The digest, prompt and Ollama version are unchanged. To check the reuse holds on the A2 desktop, the top model was re-run here (row below).

| Config | Overall | CR | DC | MO | CC | BA | CL | MT | Passes |
|---|---|---|---|---|---|---|---|---|---|
| *limit* | ≥62/90 | ≥20/25 | ≥3/7 | ≥14/18 | ≥4/7 | ≥8/11 | ≥3/9 | ≥9/13 | |
| qwen2.5:7b (top) | 71/90 (78.9%) | 23 | 4 | 16 | 5 | 9 | 4 | 10 | **yes** |
| qwen2.5:7b, A2 rerun | 70/90 (77.8%) | 23 | 4 | 16 | 5 | 8 | 4 | 10 | **yes** |
| gemma3:4b | 66/90 (73.3%) | 22 | 3 | 17 | 6 | 6 ✗ | 2 ✗ | 10 | no |
| granite3.3:8b | 62/90 (68.9%) | 21 | 3 | 16 | 7 | 6 ✗ | 4 | 5 ✗ | no |
| qwen2.5:3b | 55/90 (61.1%) ✗ | 20 | 4 | 17 | 6 | 4 ✗ | 0 ✗ | 4 ✗ | no |
| gemma3:1b | 25/90 (27.8%) ✗ | 3 ✗ | 4 | 5 ✗ | 1 ✗ | 1 ✗ | 7 | 4 ✗ | no |
| **Cascade A** | 70/90 (77.8%) | 22 | 4 | 18 | 5 | 9 | **2 ✗** | 10 | **no (CL)** |
| **Cascade B** | 72/90 (80.0%) | 23 | 4 | 18 | 5 | 9 | 3 | 10 | **yes** |

Note on the slide: DC, CC and CL have fewer than 10 test tickets, so one ticket is 11–14 pp. Cascade A fails CL by **one ticket** (2/9 against a limit of 3/9). The rerun differs from A1 on one ticket (row 8954, Bank account → answered Credit reporting), and the pass/fail column is the same with limits from either qwen2.5:7b figure.

**Cascade escalation (accuracy test):**

| | Escalated | Accepted from gemma3:4b: right | Escalated to qwen2.5:7b: right | qwen2.5:7b changed the answer |
|---|---|---|---|---|
| Setting A | **17/90 (18.9%)** | 60/73 (82.2%) | 10/17 (58.8%) | 9 tickets: 5 fixed, 1 broken |
| Setting B | **23/90 (25.6%)** | 57/67 (85.1%) | 15/23 (65.2%) | 12 tickets: 7 fixed, 1 broken |

Confusion matrices: put the 3 relevant ones (qwen2.5:7b, Cascade A, Cascade B) small on the slide or in a backup slide. They are in `results/a2/accuracy_all/summary.md`.

Source: `results/a2/accuracy_all/summary.md`, `results/a2/accuracy_cascade/<config>/summary.md` (`qwen7b` = the rerun). All 90 predictions of each cascade setting and of the rerun reconcile with `data/service.log` (`node scripts/reconcile_logs.js`).

---

## Slide 5: Speed results (owner: D)

Speed-tested: qwen2.5:7b (the only single model that passes) and both cascade settings (required in all cases). Each configuration had 3 runs × ~44 requests at 0.147 req/s. Latency = JMeter `elapsed` of successful requests.

**Per run:**

| Config | Run | Sent | Completed | Errors | Unfinished | p50 (s) | Throughput (req/s) | Escalated under load |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b | 1 | 44 | 44 | 0 | 0 | 3.7 | {{QWEN_R1_THR}} | – |
| qwen2.5:7b | 2 | {{…}} | | | | {{QWEN_R2_P50}} | | – |
| qwen2.5:7b | 3 | {{…}} | | | | {{QWEN_R3_P50}} | | – |
| Cascade A | 1 | {{A_R1 — see open issue 1}} | | | | {{A_R1_P50}} | | {{A_R1_ESC}} |
| Cascade A | 2 | | | | | {{A_R2_P50}} | | {{A_R2_ESC}} |
| Cascade A | 3 | | | | | {{A_R3_P50}} | | {{A_R3_ESC}} |
| Cascade B | 1 | 44 | 44 | 0 | 0 | 4.4 | {{B_R1_THR}} | 11/44 (25%) |
| Cascade B | 2 | | | | | {{B_R2_P50}} | | {{B_R2_ESC}} |
| Cascade B | 3 | | | | | {{B_R3_P50}} | | {{B_R3_ESC}} |

**Per configuration:**

| Config | p50 mean [min–max] across runs | p95 pooled (n) | Error rate | Escalation: under load / accuracy test |
|---|---|---|---|---|
| qwen2.5:7b | {{QWEN_P50_MEAN}} [{{…}}] | {{QWEN_P95}} ({{QWEN_N}}) | {{QWEN_ERR}} | – |
| Cascade A | {{A_P50_MEAN}} [{{…}}] | {{A_P95}} ({{A_N}}) | {{A_ERR}} | {{A_ESC_LOAD}} / 18.9% |
| Cascade B | {{B_P50_MEAN}} [{{…}}] | {{B_P95}} ({{B_N}}) | {{B_ERR}} | {{B_ESC_LOAD}} / 25.6% |

- One line explaining any large gap between escalation under load and in the accuracy test (different tickets: non-golden workload vs test set). TODO.
- **No p99:** the sample is too small.
- Source: `results/a2/speed/speed_summary.md` (from `.jtl` + `data/service.log`). All runs reconcile: TODO paste the `node scripts/reconcile_logs.js` result once it shows OK.

---

## Slide 6: Trade-off (owner: E)

**Chart:** `results/a2/tradeoff_chart.png` (from `python3 scripts/a2_tradeoff_chart.py`). It shows one point per configuration and setting, with accuracy against latency and the overall limit as a dashed line.

**Interpretation (2–3 lines, TODO once the numbers are in).** Template:
- "{{FASTEST_PASSING}} is the fastest configuration inside both limits: p50 {{…}} s vs {{…}} s for qwen2.5:7b ({{×}}), pooled p95 {{…}} vs {{…}} s."
- "Cascade A is {{faster/slower}} but fails the Consumer loan limit by one ticket (2/9)."
- "Cascade B passes both limits with {{B_ESC_LOAD}} escalation; {{its latency vs qwen}}."

---

## Slide 7: Predictions, recommendation, defence (owners: E, C for predictions)

**Predictions vs outcomes** (predictions committed before the first benchmark run: `docs/a2_predictions.md`, commit `4ad45b1`):

| Prediction | Predicted | Outcome | Right? / why it differed |
|---|---|---|---|
| P1 fastest qualifying config | qwen2.5:7b alone (cascades fail CL) | {{FASTEST_PASSING}} | TODO: A fails CL as predicted; **B passes CL (3/9)**, which we predicted it wouldn't |
| P2 escalation, accuracy test | A 20%, B 29% | A 18.9% (17/90), B 25.6% (23/90) | within the predicted ranges (A 15–25%, B 23–35%) |
| P2 escalation, under load | A 17%, B 27% | A {{A_ESC_LOAD}}, B {{B_ESC_LOAD}} | TODO |
| P2 overall accuracy | A 68/90, B 69/90 | A 70/90, B 72/90 | better than predicted: Mortgage 18/18 and BA 9/11 held; TODO one line |
| P2 p50 | qwen 7.5 s, A 6.5 s, B 7.2 s | qwen {{…}}, A {{…}}, B {{…}} | TODO (S came out lower than expected, see P4) |
| P2 pooled p95 | qwen 17 s, A 19 s, B 20 s | {{…}} | TODO |
| P3 categories losing most | DC (A), BA, CL | CL lost 2 tickets in A and 1 in B; DC and BA did **not** drop (4/7, 9/11) | TODO why |
| P4 S | 5.5–7 s | **3.4 s** | wrong: the S tickets were typical-length and the machine was idle; A1 times included load |
| P4 no model reload, ≤±20% p50 spread, all runs reconcile | as stated | TODO | TODO (see open issues 1 and 2) |

**Recommendation:** **{{RECOMMENDED}}**
- Speed gain vs qwen2.5:7b alone: p50 {{×/s}}, pooled p95 {{×/s}}.
- Accuracy cost: overall {{pp}} ({{n}}/90 vs 71/90), by category {{list}}.
- If the cascade lost: explain with the measured numbers, using small + f × large = {{small_ms}} + {{f}} × {{large_ms}} ≈ {{estimate}} vs qwen alone {{…}}. The model times under load are in the third table of `speed_summary.md`.

---

## Slide 8: Limitations, references, AI declaration (owner: E; everyone adds AI notes)

**What the results don't show:**
- **Sample size:** 90 test tickets. DC, CC and CL have fewer than 10 each, so one ticket is 11–14 pp, and Cascade A fails CL by one ticket. Each speed run has about 44 requests, and p95 rests on about 130 pooled requests.
- **Seen tickets:** every model saw the whole golden set in A1. The test set is fair between configurations, not new data.
- **Reused accuracy records:** single-model accuracies other than qwen2.5:7b come from A1 runs on the A1 machine, which is a different machine from A2's. Strictly, the brief allows reuse only on the same machine; they all fail by wide margins (see slide 4), so a one-ticket machine difference can't change their result. The qwen2.5:7b rerun on the A2 desktop gave 70/90 vs 71/90, so run-to-run and machine differences are about one ticket. Differences between configurations of 1–2 tickets are within that.
- **Not the client's A1 machine:** the client requires the deployed system to run on the A1 machine's CPU and RAM. Speeds were measured on a different desktop, so absolute latencies won't carry over. TODO once the A1 specs are known: if the A1 machine is slower or has less RAM, say the ranking is expected to hold but the latencies will be higher, and whether both cascade models (about 7.4 GiB) fit in its RAM.
- **One machine and one arrival rate:** 0.147 req/s, which is **above** the client peak of 0.016 req/s, so a configuration that keeps up here also handles the client's load. The results say nothing about other rates or hardware.
- **Network and clocks:** TODO, e.g. wifi hotspot and port forwarding; the clock mismatch in qwen7b run 1 (open issue 2).
- **Escalation depends on the ticket mix:** it differed between the test set and the load workload.

**References and licences:**
- CFPB Consumer Complaint Database
- Ollama (MIT)
- Model licences:
  - qwen2.5:7b and qwen2.5:3b: Apache 2.0 (TODO check: 3b is under the Qwen Research licence)
  - gemma3:4b and gemma3:1b: Gemma Terms of Use
  - granite3.3:8b: Apache 2.0
- Apache JMeter (Apache 2.0)

**AI declaration (TODO, each member):**
- What the AI tools produced: e.g. the cascade code, the JMeter plan and runner scripts, the analysis scripts and this outline.
- What the team did: chose the rule and settings, ran the tests, checked the figures and made the recommendation.

---

## Numbers to fill

Run these after the last speed run (all three runs of every configuration committed):
```
node scripts/reconcile_logs.js          # every A2 row must say OK; note any that don't
node scripts/summarize_load.js --a2     # writes results/a2/speed/speed_summary.md (+ .csv/.json, speed_per_run.csv)
python3 scripts/a2_tradeoff_chart.py    # writes results/a2/tradeoff_chart.png (+ .svg/.csv)
```

| Placeholder | Where to read it |
|---|---|
| per-run Sent / Completed / Errors / Unfinished / p50 / Throughput / Escalated | `speed_summary.md` → "Per run" |
| `*_P50_MEAN` [min–max], `*_P95` (n), error rate | `speed_summary.md` → "Per configuration" |
| `*_ESC_LOAD` | `speed_summary.md` → "Escalation: load / test" column |
| `FASTEST_PASSING`, speed gain ×, p95 vs qwen | `speed_summary.md` → "Fastest configuration within the accuracy limits" and the "p50 / p95 vs qwen2.5:7b" column |
| small_ms, large_ms, estimate for slide 7 | `speed_summary.md` → "Why the cascade is faster or slower" |
| chart | `results/a2/tradeoff_chart.png` |
| accuracy figures (already filled) | `results/a2/accuracy_all/summary.md` |

---

## Open issues found in round 1 (27 Nov), to resolve before the slides are final

1. **Cascade A run 1 never reached the service.** All 44 JMeter requests failed with `ConnectTimeoutException` to `10.71.149.225:3000`. `/stats` didn't change (237 → 237) and the service logged no requests. The warm-ups just before and the `ollama ps` call just after both worked, so the laptop lost its connection to the desktop during the run. This measures the network, not the configuration.
   - Suggested handling: rename its files to `results/a2/speed/cascadeA/run1_failed_network.*`. The summary and reconcile scripts only read `run<N>.jtl`, so renamed files are skipped. Keep them committed.
   - Mark its row in `run_register.csv` as failed, log it in the decisions log, and rerun cascadeA run 1 after a reset, as the last run of round 3.
   - Mention it on slide 3 or 8.
2. **qwen7b run 1: JMeter times are about 4–5% *shorter* than the service's own durations** (e.g. 16.97 s vs 17.80 s). A request can't take longer on the service than at the client, so one machine's clock ran at a different speed during this run. Cascade B run 1 doesn't show this: the gap is +19 ms median, as expected.
   - The two clocks are also about 12 s apart. That offset is harmless, and the reconcile script allows for it, but it shows the desktop's Windows clock isn't synced (`w32tm`: "Local CMOS Clock, not synchronized").
   - Request counts reconcile (44 = 44 = 44); only the time check fails.
   - Watch the reconcile gap columns in rounds 2–3. If it recurs, report it as a measurement limitation (about ±5% on latency), and don't make claims about differences smaller than that.
3. **The A2 desktop is not the A1 machine** (confirmed by the team, 27 Nov).
   - **Re-score done (27 Nov):** qwen2.5:7b on the A2 desktop scored 70/90 against 71/90 in A1, with 89/90 identical answers. Limits from either figure give the same pass/fail for every configuration, so no other re-scoring is needed (`results/a2/accuracy_cascade/qwen7b/`).
   - **Still open:** get the A1 machine's CPU, logical CPU count and RAM, and the reason for the change. Then fill in the TODOs on slides 3 and 8, including whether both cascade models (about 7.4 GiB together) fit in the A1 machine's RAM.
