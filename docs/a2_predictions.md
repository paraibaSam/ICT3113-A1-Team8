# A2 prediction record (Team 8)

**Status:** to be committed **before the first A2 benchmark run** and not revised afterwards. Outcomes are compared against these on slide 7.
**Cascade under test:** `docs/escalation_rule.md`, gemma3:4b → qwen2.5:7b, category rule. Setting A escalates on predicted {Credit card}; Setting B on predicted {Debt collection, Credit card}.

## What these predictions are based on

| Evidence | Used for |
|---|---|
| Single-model test-set accuracy (Phase 1, `results/a2/accuracy_singles/summary.md`). This is measured, not predicted: only qwen2.5:7b passes both limits. | Starting point for the cascade's test accuracy |
| Tuning-set simulation of the rule (`results/a2/rule_design/tuning_analysis.md`) | How escalation changes each category |
| A1 load runs: gemma3:4b's predicted-category mix on 271 non-golden tickets (`data/service.log`, 8 Oct) | Escalation fraction under load |
| A1 latency: accuracy-run round trips, and the 0.10 req/s load runs (`results/load/load_summary.md`) | Latency |

The cascade was **not** simulated on the test rows. Its test-set predictions come from gemma3:4b's single-model test result plus the per-category changes the rule caused on the **tuning** set.

Limits (from Phase 1): overall ≥ **62/90** (68.9%). Per category: CR ≥ 20/25, DC ≥ 3/7, MO ≥ 14/18, CC ≥ 4/7, BA ≥ 8/11, CL ≥ 3/9, MT ≥ 9/13.

---

## P1. Fastest configuration that satisfies the accuracy limits

**Prediction: qwen2.5:7b alone.** The cascade will be faster at the median but will **fail the per-category limit on Consumer loan** (2/9 against a limit of 3/9), so it will not qualify.

Reasons:
1. gemma3:4b fails Consumer loan on the test set (2/9). On tuning, the rule changed nothing for Consumer loan (3/10 before and after): Consumer loan tickets are rarely predicted as Credit card or Debt collection, and qwen2.5:7b is no better on them (1/10 on tuning). So the rule should not recover this category.
2. Bank account (gemma3:4b 6/11, limit 8/11) **will** be recovered, because its most common error is being labelled Credit card, which the rule escalates.
3. All other single models already fail the limits on the measured test set, so qwen2.5:7b is the only alternative.

Confidence: about 55%. Consumer loan has 9 test tickets, so one ticket decides it. We will say on the slides that the category is too small to be a fair test.

**If the cascade does pass** Consumer loan (the 45% case), we predict **Setting A** is the fastest qualifying configuration, on p50.

---

## P2. Cascade predictions at each setting

Assumptions: S ≈ 6 s (qwen2.5:7b, typical ticket), so the arrival rate is 1 ticket every 12 s (5/min, 0.083 req/s), with 6-minute runs of about 30 tickets. If S turns out different, the **ratios** in the last rows are the prediction that still holds.

| Quantity | qwen2.5:7b alone | **Cascade A** {CC} | **Cascade B** {DC, CC} |
|---|---|---|---|
| Escalation, accuracy test (90 test tickets) | – | **20%** (18/90), range 15–25% | **29%** (26/90), range 23–35% |
| Escalation, speed test (service log, non-golden tickets) | – | **17%** (≈5 of 30 per run), range 12–23% | **27%** (≈8 of 30), range 20–33% |
| Test accuracy, overall | 71/90 (78.9%), measured | **68/90 (75.6%)** | **69/90 (76.7%)** |
| Passes overall limit (≥62/90) | yes | **yes** | **yes** |
| Passes per-category limits | yes | **no**: Consumer loan 2/9 | **no**: Consumer loan 2/9 |
| p50 latency, mean of 3 runs | **7.5 s** (range 6.5–9 s) | **6.5 s** (range 5.5–7.5 s) | **7.2 s** (range 6–8.5 s) |
| p95 latency, 3 runs pooled (≈90 req) | **17 s** | **19 s** | **20 s** |
| p50 relative to qwen2.5:7b alone | 1.00 | **0.80–0.95× (faster)** | **0.90–1.05× (about equal)** |
| p95 relative to qwen2.5:7b alone | 1.00 | **> 1.0× (slower)** | **> 1.0× (slower)** |
| Errors and unfinished requests | 0 | 0 | 0 |
| Achieved throughput | ≈ arrival rate (0.08 req/s) | ≈ arrival rate | ≈ arrival rate |

Predicted test-set per-category results (right/n), from gemma3:4b's test result plus the tuning-set change caused by each setting:

| | CR (≥20/25) | DC (≥3/7) | MO (≥14/18) | CC (≥4/7) | BA (≥8/11) | CL (≥3/9) | MT (≥9/13) | Total |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:7b (measured) | 23 | 4 | 16 | 5 | 9 | 4 | 10 | 71 |
| gemma3:4b (measured) | 22 | 3 | 17 | 6 | 6 ✗ | 2 ✗ | 10 | 66 |
| **Cascade A (predicted)** | 23 | 3 | 17 | 5 | **8** | **2 ✗** | 10 | **68** |
| **Cascade B (predicted)** | 23 | 4 | 17 | 5 | **8** | **2 ✗** | 10 | **69** |

Escalated vs accepted accuracy (accuracy test):

| | Escalated tickets right | Accepted tickets right |
|---|---|---|
| Cascade A | about **65%** (tuning 13/19) | about **75%** (tuning 51/71) |
| Cascade B | about **70%** (tuning 20/27) | about **75%** (tuning 45/63) |

Reasons for the latency predictions:
- **Why the cascade is predicted faster at p50 but slower at p95.** Most tickets (about 83% under Setting A) finish after gemma3:4b alone (about 5 s), which pulls the median down. An escalated ticket pays for both models (about 5 s + 7 s = 12 s, plus any queueing), which pushes the tail up. The cascade's service time is bimodal, and higher variance lengthens queueing waits at the same average load.
- **Why the gain is small.** gemma3:4b is only about 25% faster than qwen2.5:7b (A1: about 5.2 s vs 6.8 s). Using mean = small + escalation × large, the cascade breaks even at about 24% escalation. Setting A (about 17–20%) is just below this, and Setting B (about 27–29%) just above.
- **CPU contention.** Both models share the same 16 CPUs. When an escalated ticket on qwen2.5:7b overlaps with a new ticket on gemma3:4b, both slow down. We expect this to cost the cascade a further 5–10%, which is why the p50 range for Setting A extends close to qwen2.5:7b's.
- **Escalation under load is lower than in the accuracy test.** gemma3:4b labelled 17.3% of the A1 load tickets Credit card and 10.0% Debt collection, against 21% and 9% on the tuning set.

---

## P3. Categories expected to lose the most accuracy when the small model's answer is accepted

Compared with qwen2.5:7b alone, on the test set:

1. **Debt collection** (Setting A): accepted gemma3:4b debt-collection answers are weaker than qwen2.5:7b's (tuning: qwen2.5:7b 9/9, gemma3:4b 6/9). Predicted 3/7 vs 4/7. Setting B escalates these and should recover it.
2. **Bank account or service**: gemma3:4b's accepted Bank account and Money transfer predictions are often wrong (tuning precision 5/12 and 6/10). Predicted 8/11 vs 9/11: still at the limit, but the most likely category to fall just below it.
3. **Consumer loan**: predicted 2/9 vs 4/9. Neither model handles it well, the rule does not escalate it, and it is the category we expect to fail the limit.
4. **Credit card** loses about 1 ticket for a different reason: escalating correct Credit card answers to qwen2.5:7b breaks some (tuning: 10/13 became 8/13).

Categories expected **not** to lose accuracy: Mortgage (gemma3:4b 17/18 vs 16/18), Credit reporting and Money transfer.

---

## P4. Other quantitative predictions

- **S** will be measured between **5.5 and 7 s**, giving a rate of about 5 tickets/min and a run length of 6–7 minutes.
- `ollama ps` will list both models before every cascade run, and **no run will show a model reload** (`load_duration` under 100 ms after warm-up).
- Spread of p50 across the 3 runs will be within **±20%** of the mean for every configuration.
- Every speed-test run will reconcile: JMeter rows = `/stats` increase = service-log `POST /tickets` lines.

---

## Sign-off

Predictions agreed by the team before the first A2 benchmark run.

| Member | Name | Agreed (date) |
|---|---|---|
| A | | |
| B | | |
| C | | |
| D | | |
| E | | |
