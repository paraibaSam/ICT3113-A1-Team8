# JMeter plan validation (24 Nov 2026, before any A2 speed run)

Check that `jmeter/a2/speed_template.jmx` behaves as the runner assumes. **Not a measurement:** the plan was pointed at a throwaway local HTTP server on port 3999 that answers 201 at once, so the real service, `data/service.log` and `/stats` were not touched.

- JMeter **5.6.3** (apache-jmeter-5.6.3.tgz, SHA-512 verified), OpenJDK 17, on the desktop (WSL2).
- Template filled in the same way as `scripts/a2_run_speed.ps1` does: data file = `jmeter/a2/workload.txt`, timeout 300000 ms; only the port was changed to 3999.

| Test | Schedule | Requests (rate × duration) | Result |
|---|---|---|---|
| t1 | `rate(8.8235/min) random_arrivals(60 sec) pause(5 sec)` | 8 (8.8) | exit 0, 8 × 201, arrivals spread over 49 s |
| t2 | `rate(88.235/min) random_arrivals(30 sec) pause(5 sec)` | 44 (44.1) | exit 0, 44 × 201, arrivals spread over 29 s |

Findings:
1. A fractional per-minute rate and `sec` units are accepted.
2. JMeter sends ⌊rate × duration⌋ requests. The real schedule `rate(8.8235/min) random_arrivals(300 sec) pause(6 min)` therefore sends **44** requests per run, matching `expected_requests_per_run` in `s_measurement.json`.
3. Request bodies arrive in workload order (lines 1..n of `workload.txt`), one per request, with no recycling.
4. `sentBytes` minus ticket length is a constant 180–181 bytes (headers), so the runner's data check (spread ≤ 2) works.

Note for the laptop: JMeter needs a working Java. On the desktop, `JAVA_HOME` pointed at a Java 21 that is not installed and had to be set to the Java 17 that is.
