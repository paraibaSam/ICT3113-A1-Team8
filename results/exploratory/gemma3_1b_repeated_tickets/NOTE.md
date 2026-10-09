# Discarded first attempt: gemma3:1b load runs that repeated tickets

What this is: the first attempt at the gemma3:1b load test (8 Oct, about 07:34 to 08:33 UTC). Nine runs (0.05, 0.10 and 0.20 req/s, three each)
sent the same first tickets of `jmeter/load_data.txt` on every run, in the same order: lines 1-15, 1-30 and 1-60. Each folder holds the JMeter
results (`.jtl`) and JMeter log (`.log`) of one run.

Why it was discarded: tickets sent for the second time or later were answered much faster. Over the nine runs the median latency was about
0.23 s for repeated tickets and about 1.5 s for the roughly 60 first-time requests (for example one ticket took 2.8 s the first time and 0.2 s every
time after). In the accuracy run, where every ticket was new, no request took under 0.9 s. Not every ticket sped up. The likely cause is Ollama's
prompt cache; that is not proven. Runs that repeat tickets do not measure what a complaint desk sees, where every ticket is new.

What replaced it: the runner now gives every run its own block of tickets (see the README), and the model is unloaded before each model's
first run. The valid runs are in `results/load/`.

The matching lines are not in `data/service.log`: the log was restored to its last commit before the reruns.
