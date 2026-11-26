#!/usr/bin/env bash
# A2: reset the DESKTOP (service machine) before every accuracy or speed-test run.
#
#   scripts/a2_desktop_reset.sh <qwen7b|cascadeA|cascadeB> [--allow-other-containers]
#
# 1. refuses to run while containers from other projects are running (they take RAM/CPU and would make
#    conditions differ between runs), unless --allow-other-containers is given
# 2. (re)creates the triage service with config/a2/<config>.env (never pulls a newer image)
# 3. restarts the Ollama container: clears Ollama's prompt cache, no model loaded
# 4. checks Ollama version and the weights-layer digests of the models this config uses
# 5. checks that no model is loaded and the service is healthy, and that the service started with the
#    intended config (its startup log line)
# 6. appends a JSON line to results/a2/speed/desktop_resets.log
#
# After this, run the warm-ups + measurement from the laptop (scripts/a2_run_speed.ps1) or the accuracy
# test (scripts/a2_accuracy_test.js) on the desktop.
set -euo pipefail

cd "$(dirname "$0")/.."
CFG="${1:-}"
ALLOW_OTHERS="${2:-}"
ENV_FILE="config/a2/${CFG}.env"
[[ -f "$ENV_FILE" ]] || { echo "usage: $0 <qwen7b|cascadeA|cascadeB> [--allow-other-containers]"; exit 1; }

EXPECTED_OLLAMA="0.34.4"
declare -A DIGEST=(
  ["qwen2.5:7b"]="2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730"
  ["gemma3:4b"]="aeda25e63ebd698fab8638ffb778e68bed908b960d39d0becc650fa981609d25"
)
case "$CFG" in
  qwen7b)   MODELS=("qwen2.5:7b"); SETTING="single" ;;
  cascadeA) MODELS=("gemma3:4b" "qwen2.5:7b"); SETTING="A" ;;
  cascadeB) MODELS=("gemma3:4b" "qwen2.5:7b"); SETTING="B" ;;
esac
PROJECT="$(basename "$PWD" | tr '[:upper:]' '[:lower:]')"

# 1. other containers
OTHERS="$(docker ps --format '{{.Names}}' | grep -v "^${PROJECT}-" || true)"
if [[ -n "$OTHERS" && "$ALLOW_OTHERS" != "--allow-other-containers" ]]; then
  echo "Other containers are running and would compete for RAM/CPU:"; echo "$OTHERS" | sed 's/^/  /'
  echo "Stop them (docker stop <name>) or pass --allow-other-containers."; exit 2
fi

# 2 + 3. service with this config, then a fresh Ollama
docker compose --env-file "$ENV_FILE" up -d --pull never --force-recreate triage-service >/dev/null
docker compose restart ollama >/dev/null
for i in $(seq 1 60); do curl -sf localhost:11434/api/version >/dev/null && break; sleep 1; done
for i in $(seq 1 60); do curl -sf localhost:3000/health >/dev/null && break; sleep 1; done
curl -sf localhost:3000/health >/dev/null || { echo "service not healthy"; exit 3; }

# 4. version and digests
VER="$(curl -sf localhost:11434/api/version | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')"
[[ "$VER" == "$EXPECTED_OLLAMA" ]] || { echo "Ollama version $VER != $EXPECTED_OLLAMA"; exit 4; }
DIGESTS_JSON="{"
for m in "${MODELS[@]}"; do
  f="/root/.ollama/models/manifests/registry.ollama.ai/library/${m%%:*}/${m#*:}"
  d="$(docker compose exec -T ollama sh -c "grep -o 'image.model\",\"digest\":\"sha256:[0-9a-f]*' '$f' | cut -d: -f3")"
  [[ "$d" == "${DIGEST[$m]}" ]] || { echo "DIGEST MISMATCH for $m: $d"; exit 5; }
  DIGESTS_JSON+="\"$m\":\"$d\","
done
DIGESTS_JSON="${DIGESTS_JSON%,}}"

# 5. nothing loaded, service config as intended
LOADED="$(curl -sf localhost:11434/api/ps | python3 -c 'import json,sys;print(" ".join(m["name"] for m in json.load(sys.stdin).get("models",[])))')"
[[ -z "$LOADED" ]] || { echo "models still loaded after restart: $LOADED"; exit 6; }
STARTUP="$(docker compose logs --no-log-prefix triage-service 2>/dev/null | grep '"type":"startup"' | tail -1)"
GOT_SETTING="$(echo "$STARTUP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["triage_config"]["setting"])')"
[[ "$GOT_SETTING" == "$SETTING" ]] || { echo "service started with setting '$GOT_SETTING', expected '$SETTING'"; exit 7; }

# 6. record
mkdir -p results/a2/speed
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTUP_CFG="$(echo "$STARTUP" | python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin)["triage_config"]))')"
echo "{\"time\":\"$TS\",\"config\":\"$CFG\",\"ollama\":\"$VER\",\"digests\":$DIGESTS_JSON,\"service\":$STARTUP_CFG,\"other_containers\":\"$(echo $OTHERS)\"}" >> results/a2/speed/desktop_resets.log

echo "READY $TS: config=$CFG (setting $SETTING), Ollama $VER restarted, no model loaded, digests OK for ${MODELS[*]}."
echo "Next: from the laptop run  .\\scripts\\a2_run_speed.ps1 -Config $CFG -Run <1|2|3>"
