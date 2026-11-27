# A2 test environment (Phase 0)

Recorded **2026-11-24 05:55 UTC** on the service machine (the desktop, `DESKTOP-H2TR5SM`), at repo commit `cf1eb1c`.
Re-check the digests and settings before each configuration's speed runs and append the output to the *Re-checks* section at the bottom.

## Verdict

| Check | Result |
|---|---|
| Model digests vs A1 (`README.md`) | ✅ **match** for qwen2.5:7b, gemma3:4b, qwen2.5:3b, granite3.3:8b |
| gemma3:1b | ⚠️ **no longer installed** on this machine (see note 2) |
| Ollama version | ✅ 0.34.4 (same as A1) |
| Docker version | ✅ 29.5.3 (same as A1) |
| Classification prompt | ✅ unchanged since A1: `service/src/ollamaClient.js` last changed in `64a0d5f init` |
| Ollama inference settings | defaults, see below; hold constant for every A2 configuration |
| Machine | ⚠️ **not verified to be the A1 machine** (A1 never recorded its hardware; A1's accuracy and load logs were committed by other members, and gemma3:1b, which A1 load-tested, is not on this desktop). A2 desktop: 16 logical CPUs, 15.2 GiB RAM visible to WSL2 and Docker. TODO: team to confirm which machine ran A1 |

## Model digests

The README digests are the digest of the **model weights layer** (`application/vnd.ollama.image.model`) in each Ollama manifest.
This is **not** the digest that `ollama list` or `/api/tags` shows, which is the digest of the manifest file. Both are recorded here.

| Tag | Weights layer digest (= README) | Matches A1 | Manifest digest (`ollama list` ID) | Size | Quant |
|---|---|---|---|---|---|
| qwen2.5:7b | `2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730` | ✅ | `845dbda0ea48…` | 4.68 GB | Q4_K_M |
| gemma3:4b | `aeda25e63ebd698fab8638ffb778e68bed908b960d39d0becc650fa981609d25` | ✅ | `a2af6cc3eb7f…` | 3.34 GB | Q4_K_M |
| qwen2.5:3b | `5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6` | ✅ | `357c53fb659c…` | 1.93 GB | Q4_K_M |
| granite3.3:8b | `77bcee066a76dcdd10d0d123c87e32c8ec2c74e31b6ffd87ebee49c9ac215dca` | ✅ | `fd429f23b909…` | 4.94 GB | Q4_K_M |
| gemma3:1b | `7cd4618c1faf8b7233c6c906dac1694b6a47684b37b8895d470ac688520b9c01` (A1) | ⚠️ not installed | – | – | – |

Command used (prints the weights layer digest, comparable with the README):

```bash
docker compose exec ollama sh -c 'cd /root/.ollama/models/manifests/registry.ollama.ai/library && for f in */*; do echo "${f%/*}:${f#*/} $(grep -o "image.model\",\"digest\":\"sha256:[0-9a-f]*" $f | cut -d: -f3)"; done'
```

Raw output (2026-11-24 05:56 UTC); models that are not A2 candidates are also listed:

```
gemma2:9b ff1d1fc78170d787ee1201778e2dd65ea211654ca5fb7d69b5a2e7b123a50373
gemma3:4b aeda25e63ebd698fab8638ffb778e68bed908b960d39d0becc650fa981609d25
granite3.3:8b 77bcee066a76dcdd10d0d123c87e32c8ec2c74e31b6ffd87ebee49c9ac215dca
llama3.1:8b 667b0c1932bc6ffc593ed1d03f895bf2dc8dc6df21db3042284a6f4416b06a29
llama3.2:1b 74701a8c35f6c8d9a4b91f3f3497643001d63e0c7a84e085bed452548fa88d45
llama3.2:3b dde5aa3fc5ffc17176b5e8bdc82f587b24b2678c6c66101bf7da77af9f7ccdff
mistral:7b f5074b1221da0f5a2910d33b642efa5b9eb58cfdddca1c79e16d7ad28aa2b31f
phi4-mini:latest 3c168af1dea0a414299c7d9077e100ac763370e5a98b3c53801a958a47f0a5db
qwen2.5:3b 5ee4f07cdb9beadbbb293e85803c569b01bd37ed059d2715faa7bb405f31caa6
qwen2.5:7b 2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730
```

## Software versions

| Component | Version | A1 |
|---|---|---|
| Ollama (container `ollama/ollama:latest`, local image `sha256:8262851b2846…`, created about 2 months ago) | 0.34.4 | 0.34.4 |
| Docker Engine / Compose | 29.5.3 / 5.1.4 | 29.5.3 |
| Triage service base image | `node:20-alpine` (service/Dockerfile) | Node.js 20 |
| Node.js on host (scripts) | 18.20.8 | – |
| Host OS | Ubuntu 22.04.5 LTS on WSL2, kernel 6.18.58.1-microsoft-standard-WSL2 | – |
| JMeter / Java (load generator, **laptop**) | *to be filled in by A on the laptop* | 5.6.3 / 1.8 |

## Hardware and resource limits (service machine)

| Item | Value |
|---|---|
| CPU | AMD Ryzen 7 7800X3D, 8 cores / 16 threads; 16 logical CPUs visible to WSL2, Docker and the Ollama container |
| RAM | 15.2 GiB visible to WSL2 and Docker (`MemTotal` 15,935,352 kB); Ollama reports `total=15.2 GiB` for CPU inference |
| Ollama container limits | none set (`NanoCpus=0`, `Memory=0`, no cpuset): it can use all 16 CPUs and all 15.2 GiB |
| GPU | none used: Ollama `inference compute: library=cpu`; `ollama ps` shows `100% CPU` |

## Ollama inference settings (hold constant for every configuration)

From the Ollama server's `server config` log line at startup, plus `docker-compose.yml`:

| Setting | Value | Note |
|---|---|---|
| `OLLAMA_KEEP_ALIVE` | `-1` (forever) | set in `docker-compose.yml` |
| `OLLAMA_NUM_PARALLEL` | `1` | default |
| `OLLAMA_MAX_LOADED_MODELS` | `0` (auto) | default; two models loaded together without changing it (see `memory_check.txt`) |
| `OLLAMA_CONTEXT_LENGTH` | `0` (default) → **4096** per model as shown by `ollama ps` | default |
| `OLLAMA_FLASH_ATTENTION` | `false` | default |
| `OLLAMA_KV_CACHE_TYPE` | (empty, f16) | default |
| `OLLAMA_MAX_QUEUE` | `512` | default |
| Thread count | not set (Ollama chooses) | default |
| Request options (service) | `{ temperature: 0 }`, `stream: false` | `service/src/ollamaClient.js` |

No Ollama setting was changed for A2.

## Notes

1. **Do not `ollama pull` or upgrade.** `docker-compose.yml` uses `ollama/ollama:latest`. Start containers with `docker compose up -d --pull never` so a newer image is never fetched.
2. **gemma3:1b is missing** from this machine; it was removed at some point after A1. This doesn't affect A2 testing: gemma3:1b fails both accuracy limits on the test set (25/90) using its A1 predictions, so it needs no speed test and isn't a cascade candidate. Its A1 predictions were produced with digest `7cd4618c…` on Ollama 0.34.4 on this machine, which is what the reuse condition requires. **Do not re-pull it.** If it is ever needed, pull it and check that the weights layer digest is `7cd4618c…` before using it.
3. **Other containers on the host.** `lab01-mw-mysqldb-1` (about 380 MiB) and `lab01-mw-git-server-1` were running during this check. With both cascade models loaded, only about 1.8 GiB of host RAM is free (see `memory_check.txt`). **Stop these containers before every A2 run** and keep other heavy apps closed, so that conditions are the same for every configuration.

## Re-checks before each configuration

| When (UTC) | Before configuration | Digests match? | Ollama version | Settings unchanged? | By |
|---|---|---|---|---|---|
| | qwen2.5:7b speed runs | | | | |
| | Cascade A speed runs | | | | |
| | Cascade B speed runs | | | | |
