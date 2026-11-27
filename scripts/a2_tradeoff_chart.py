"""A2 slide 6: accuracy vs latency trade-off chart, one point per configuration.

    python3 scripts/a2_tradeoff_chart.py [repoRoot]

Reads (run these first):
  results/a2/speed/speed_summary.json      node scripts/summarize_load.js --a2
  results/a2/accuracy_all/summary.json     node scripts/a2_score_split.js --out results/a2/accuracy_all --extra ...
Writes:
  results/a2/tradeoff_chart.png  (for the slide, 16:9, 200 dpi)  and  tradeoff_chart.svg
  results/a2/tradeoff_chart.csv  (the plotted numbers, so the chart can be checked as a table)

Encoding (one x-axis, seconds):
  filled circle  = mean of the per-run p50s; horizontal bar = min-max of the per-run p50s (run-to-run spread)
  open diamond   = p95 pooled over all runs (n stated in the label); a thin line joins it to its p50
  y              = test-set accuracy (90 tickets); dashed line = the overall limit (top model - 10 pp)
  a configuration that fails a per-category limit gets a hollow circle and the failed categories in its label
Colours: the first three categorical slots of the dataviz reference palette (validated all-pairs, light mode).
"""
import csv
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SPEED = os.path.join(ROOT, "results", "a2", "speed", "speed_summary.json")
ACC = os.path.join(ROOT, "results", "a2", "accuracy_all", "summary.json")
OUT = os.path.join(ROOT, "results", "a2")

SERIES = {"qwen2.5:7b": "#257de0", "Cascade A": "#f47230", "Cascade B": "#00b894"}  # fixed order, never by rank
TEXT, TEXT2, GRID, SURFACE = "#191919", "#666666", "#e6e6e6", "#ffffff"
SHORT = {"Credit reporting": "CR", "Debt collection": "DC", "Mortgage": "MO", "Credit card": "CC",
         "Bank account or service": "BA", "Consumer loan": "CL", "Money transfer or service": "MT"}


def load(p, hint):
    if not os.path.exists(p):
        sys.exit(f"Missing {os.path.relpath(p, ROOT)}. Run: {hint}")
    with open(p) as f:
        return json.load(f)


speed = load(SPEED, "node scripts/summarize_load.js --a2")
acc = load(ACC, "node scripts/a2_score_split.js --out results/a2/accuracy_all --extra ... (A2_PLAN.md Phase 6a)")
accByName = {c["name"]: c for c in acc["configs"]}
limit = acc["limits"]["overall"]["limit"]

points = []
for c in speed["configs"]:
    a = accByName.get(c["name"])
    if a is None:
        sys.exit(f"{c['name']} has speed runs but no accuracy result in {os.path.relpath(ACC, ROOT)}")
    points.append({
        "name": c["name"], "runs": c["runs"],
        "p50": c["p50_mean"] / 1000, "p50_min": c["p50_min"] / 1000, "p50_max": c["p50_max"] / 1000,
        "p95": c["p95_pooled"] / 1000, "n": c["pooled_n"],
        "acc": a["test"]["acc"], "correct": a["test"]["correct"], "total": a["test"]["n"],
        "pass": a["pass"], "failed": a["failedCats"], "pass_overall": a["passOverall"],
        "esc": c.get("escalation_load_pct", ""),
    })
missing = [n for n in SERIES if n not in {p["name"] for p in points}]

fig, ax = plt.subplots(figsize=(10, 5.6), dpi=200)
fig.patch.set_facecolor(SURFACE)
ax.set_facecolor(SURFACE)
for s in ("top", "right"):
    ax.spines[s].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color(GRID)
ax.tick_params(colors=TEXT2, labelsize=9, length=0)
ax.grid(True, color=GRID, linewidth=0.8)
ax.set_axisbelow(True)

xmax = max(p["p95"] for p in points)
ys = [p["acc"] for p in points] + [limit]
ylo, yhi = min(ys) - 4, max(ys) + 3
ax.set_xlim(0, xmax * 1.75)  # room for the labels right of each p95
ax.set_ylim(ylo, yhi)

# overall limit
ax.axhline(limit, color=TEXT2, linewidth=1.2, linestyle=(0, (5, 4)), zorder=1)
ax.text(xmax * 0.02, limit - 0.3, f"Overall limit {limit:.1f}% (top model − 10 pp); below it fails", ha="left", va="top", fontsize=8.5, color=TEXT2)
ax.axhspan(ylo, limit, color="#f5f5f5", zorder=0)

# configurations with the same accuracy (likely: 1 ticket = 1.1 pp) are drawn slightly apart so their marks don't overlap
from collections import defaultdict  # noqa: E402

same = defaultdict(list)
for p in points:
    same[p["correct"]].append(p)
tied = False
for grp in same.values():
    grp.sort(key=lambda p: p["p50"])
    for k, p in enumerate(grp):
        p["y"] = p["acc"] + (len(grp) - 1) * 0.3 - k * 0.6
    tied |= len(grp) > 1

# labels sit right of each p95 diamond, one line each; nudge apart (in points) when accuracies are close
pt_per_pp = 5.6 * 72 * 0.8 / (yhi - ylo)
order = sorted(points, key=lambda p: p["y"])
for i, p in enumerate(order):
    p["dy"] = 0.0
    if i:
        prev = order[i - 1]
        gap = (p["y"] - prev["y"]) * pt_per_pp + p["dy"] - prev["dy"]
        if gap < 13:
            p["dy"] = prev["dy"] + (p["y"] - prev["y"]) * -pt_per_pp + 13

for p in points:
    col = SERIES[p["name"]]
    y = p["y"]
    ax.plot([p["p50"], p["p95"]], [y, y], color=col, linewidth=1, alpha=0.45, zorder=2)
    ax.plot([p["p50_min"], p["p50_max"]], [y, y], color=col, linewidth=2.5, solid_capstyle="round", zorder=3)
    ax.scatter([p["p95"]], [y], s=70, marker="D", facecolor=SURFACE, edgecolor=col, linewidth=2, zorder=4)
    ax.scatter([p["p50"]], [y], s=95, marker="o", facecolor=col if p["pass"] else SURFACE, edgecolor=col if p["pass"] else col,
               linewidth=2.2, zorder=5)
    verdict = "passes both limits" if p["pass"] else "fails " + (", ".join(SHORT.get(c, c) for c in p["failed"]) if p["failed"] else "overall limit")
    if p["failed"] and not p["pass_overall"]:
        verdict = "fails overall and " + ", ".join(SHORT.get(c, c) for c in p["failed"])
    esc = f" · {p['esc']:.0f}% escalated" if isinstance(p["esc"], (int, float)) else ""
    ax.annotate(f"{p['name']}: {p['correct']}/{p['total']}, {verdict}{esc} · p50 {p['p50']:.1f} s, p95 {p['p95']:.1f} s",
                xy=(p["p95"], y), xytext=(10, p["dy"]), textcoords="offset points", ha="left", va="center", fontsize=8.6, color=TEXT, zorder=6)

ax.set_xlabel("Latency per ticket under load (s)", fontsize=10, color=TEXT)
ax.set_ylabel("Test-set accuracy (%, 90 tickets)", fontsize=10, color=TEXT)
ax.set_title("Accuracy vs latency: A2 configurations", loc="left", fontsize=13, color=TEXT, pad=44, fontweight="bold")
nruns = "/".join(str(p["runs"]) for p in points)
ax.text(0, 1.085, f"Circle = mean p50 of {nruns} runs, bar = min–max of the run p50s · diamond = p95 of all runs pooled · hollow circle = fails a limit",
        transform=ax.transAxes, fontsize=8.5, color=TEXT2)

# legend: identity (colour) and mark key (shape)
from matplotlib.lines import Line2D  # noqa: E402

handles = [Line2D([], [], marker="o", linestyle="", markersize=8, markerfacecolor=SERIES[p["name"]], markeredgecolor=SERIES[p["name"]], label=p["name"]) for p in points]
handles += [Line2D([], [], marker="o", linestyle="", markersize=7, markerfacecolor=TEXT2, markeredgecolor=TEXT2, label="p50 (mean of runs)"),
            Line2D([], [], marker="D", linestyle="", markersize=6, markerfacecolor=SURFACE, markeredgecolor=TEXT2, markeredgewidth=1.6, label="p95 (pooled)")]
ax.legend(handles=handles, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=len(handles), fontsize=8.5, frameon=False, labelcolor=TEXT,
          handletextpad=0.3, columnspacing=1.4, borderaxespad=0.2)

foot = ["Higher and further left is better. Single models other than qwen2.5:7b fail the accuracy limits, so they were not speed-tested."]
if tied:
    foot.append("Configurations with equal accuracy are drawn 0.6 pp apart; the labels give the exact counts.")
if missing:
    foot.append(f"Not yet run: {', '.join(missing)}.")
foot.append("Source: results/a2/speed/speed_summary.json (JMeter .jtl + service log), results/a2/accuracy_all/summary.json.")
for k, line in enumerate(reversed(foot)):
    fig.text(0.01, 0.01 + k * 0.025, line, fontsize=7.5, color=TEXT2)
fig.tight_layout(rect=(0, 0.015 + 0.025 * len(foot), 1, 1))

os.makedirs(OUT, exist_ok=True)
fig.savefig(os.path.join(OUT, "tradeoff_chart.png"), facecolor=SURFACE)
fig.savefig(os.path.join(OUT, "tradeoff_chart.svg"), facecolor=SURFACE)
with open(os.path.join(OUT, "tradeoff_chart.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["config", "runs", "p50_mean_s", "p50_min_s", "p50_max_s", "p95_pooled_s", "pooled_n", "test_correct", "test_n", "test_acc_pct", "escalation_load_pct", "passes_limits", "failed_categories", "overall_limit_pct"])
    for p in points:
        w.writerow([p["name"], p["runs"], round(p["p50"], 2), round(p["p50_min"], 2), round(p["p50_max"], 2), round(p["p95"], 2), p["n"], p["correct"], p["total"],
                    round(p["acc"], 1), p["esc"] if p["esc"] != "" else "", p["pass"], "; ".join(p["failed"]), round(limit, 1)])
print(f"Wrote results/a2/tradeoff_chart.png, .svg and .csv ({len(points)} configurations{'; missing ' + ', '.join(missing) if missing else ''})")
