"""A2 Step 4 set-up: measure S and derive the speed-test parameters (run on the DESKTOP).

Brief: restart Ollama, do the normal warm-up, then send three DIFFERENT tickets of typical length to the
top model one at a time; S = the middle time. Rate = one ticket every 2S seconds; run length = S minutes
(minimum 5); HTTP response timeout = 10 x S seconds (minimum 5 minutes); schedule pause = timeout + at
least 1 minute.

Steps:
  1. scripts/a2_desktop_reset.sh qwen7b   (service = qwen2.5:7b alone, fresh Ollama, digests checked)
  2. the 3 fixed warm-up tickets (jmeter/a2/warmup.txt) through POST /tickets, timings discarded
  3. the 3 S tickets (jmeter/a2/s_tickets.txt) through POST /tickets, one at a time, wall-clock timed
  4. writes results/a2/speed/s_measurement.json and .md

The tickets go through the real service, so they appear in data/service.log and the ticket DB.

Usage: python3 scripts/a2_measure_s.py [--allow-other-containers]
"""
import csv
import json
import math
import os
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BASE = "http://localhost:3000"
CLIENT_PEAK_RPS = 0.016  # A1 workload model: required load
OUT = os.path.join(ROOT, "results", "a2", "speed")


def post(body):
    req = urllib.request.Request(f"{BASE}/tickets", data=body.encode("ascii"), headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=900) as r:
        resp = json.load(r)
        status = r.status
    return time.perf_counter() - t0, status, resp


def lines(name):
    with open(os.path.join(ROOT, "jmeter", "a2", name), encoding="ascii") as f:
        return [l.rstrip("\n") for l in f if l.strip()]


def rows(name):
    with open(os.path.join(ROOT, "jmeter", "a2", name), newline="") as f:
        return list(csv.DictReader(f))


def main():
    extra = [a for a in sys.argv[1:] if a == "--allow-other-containers"]
    subprocess.run(["bash", os.path.join(ROOT, "scripts", "a2_desktop_reset.sh"), "qwen7b", *extra], check=True)

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    warm = []
    for body, r in zip(lines("warmup.txt"), rows("warmup_rows.csv")):
        t, st, resp = post(body)
        warm.append({"row_id": int(r["row_id"]), "seconds": round(t, 3), "status": st, "category": resp.get("category")})
        print(f"warm-up row {r['row_id']}: {t:.2f} s (discarded)")

    timed = []
    for body, r in zip(lines("s_tickets.txt"), rows("s_tickets_rows.csv")):
        t, st, resp = post(body)
        timed.append({"row_id": int(r["row_id"]), "chars": int(r["chars"]), "seconds": round(t, 3), "status": st, "category": resp.get("category")})
        print(f"S ticket row {r['row_id']} ({r['chars']} chars): {t:.2f} s")

    S = round(statistics.median(x["seconds"] for x in timed), 1)
    interval = 2 * S
    rate_per_min = 60 / interval
    run_sec = int(round(max(S, 5) * 60))
    timeout_sec = int(math.ceil(max(10 * S, 300)))
    pause_min = int(math.ceil(timeout_sec / 60)) + 1
    expected = round(run_sec / interval)
    rps = 1 / interval

    res = {
        "measured_utc": started,
        "model": "qwen2.5:7b",
        "warmups_discarded": warm,
        "s_tickets": timed,
        "S_seconds": S,
        "interval_seconds": round(interval, 1),
        "rate_per_min": round(rate_per_min, 4),
        "rate_rps": round(rps, 5),
        "run_seconds": run_sec,
        "expected_requests_per_run": expected,
        "response_timeout_seconds": timeout_sec,
        "pause_minutes": pause_min,
        "client_peak_rps": CLIENT_PEAK_RPS,
        "test_rate_vs_client_peak": "above" if rps > CLIENT_PEAK_RPS else "below",
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "s_measurement.json"), "w") as f:
        json.dump(res, f, indent=2)

    md = [
        "# A2 speed-test parameters (measured S)", "",
        f"Measured {started} on the desktop, after `scripts/a2_desktop_reset.sh qwen7b` (fresh Ollama, digests checked) and the 3 fixed warm-ups.",
        "Each ticket was sent alone through `POST /tickets` (wall-clock time measured on the desktop). Produced by `scripts/a2_measure_s.py`.", "",
        "| Ticket row | Length (chars) | Time (s) | Answer |", "|---|---|---|---|",
        *[f"| {x['row_id']} | {x['chars']} | {x['seconds']:.2f} | {x['category']} |" for x in timed], "",
        f"- **S = {S} s** (middle of the three)",
        f"- **Rate:** one ticket every 2S = {interval:.1f} s = **{rate_per_min:.3f} tickets/min** ({rps:.4f} req/s)",
        f"- **Run length:** S minutes (minimum 5) = **{run_sec} s** → about **{expected} requests per run**",
        f"- **HTTP response timeout:** 10 × S (minimum 5 min) = **{timeout_sec} s**",
        f"- **Schedule pause after arrivals:** timeout + at least 1 min = **{pause_min} min**",
        f"- **Client peak (A1 workload model):** {CLIENT_PEAK_RPS} req/s. The test rate is **{res['test_rate_vs_client_peak']}** the client peak"
        + (", so a configuration that keeps up at this rate also handles the client's load." if rps > CLIENT_PEAK_RPS else ", so results compare configurations but don't show the client's peak can be handled."),
        "", "Warm-up tickets (timings discarded): " + ", ".join(f"row {w['row_id']} {w['seconds']:.2f} s" for w in warm),
    ]
    with open(os.path.join(OUT, "s_measurement.md"), "w") as f:
        f.write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
