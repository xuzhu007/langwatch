#!/usr/bin/env bash
# Boots the release images on the actual Compose files with synthetic data and no public egress.
set -euo pipefail
umask 077

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../../.." && pwd)
cd "$repo"

plan_only=false
scratch=""
while (($#)); do
  case "$1" in
    --plan-only) plan_only=true; shift ;;
    --run-dir) scratch=${2:?--run-dir needs a directory}; shift 2 ;;
    *) echo 'Usage: compose-offline-smoke.sh [--plan-only] [--run-dir DIR]' >&2; exit 2 ;;
  esac
done
for tool in docker grep jq node openssl; do
  command -v "$tool" >/dev/null || { printf 'Missing smoke prerequisite: %s\n' "$tool" >&2; exit 3; }
done
if [[ -n $scratch ]]; then
  mkdir -p "$scratch"
  [[ -z $(ls -A "$scratch") ]] || { echo 'The smoke evidence directory must be empty' >&2; exit 2; }
  scratch=$(cd "$scratch" && pwd)
else
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/lw-compose-smoke.XXXXXXXX")
fi

version=$(jq -er '."."' .github/.release-please-manifest.json)
export LANGWATCH_IMAGE=${LANGWATCH_IMAGE:-langwatch-fork:$version}
export LANGWATCH_NLP_IMAGE=${LANGWATCH_NLP_IMAGE:-langwatch-fork-langwatch_nlp:$version}
export LANGEVALS_IMAGE=${LANGEVALS_IMAGE:-langwatch-fork-langevals:$version}
export LANGWATCH_PULL_POLICY=never LANGWATCH_NLP_PULL_POLICY=never LANGEVALS_PULL_POLICY=never

fixture_id=$(openssl rand -hex 8)
project="lwsmoke${fixture_id}"
export SMOKE_ENV="$scratch/services.env"
CLICKHOUSE_PASSWORD=$(openssl rand -hex 24)
export CLICKHOUSE_PASSWORD
export POSTGRES_SMOKE_IMAGE=${POSTGRES_SMOKE_IMAGE:-postgres:16}
export REDIS_SMOKE_IMAGE=${REDIS_SMOKE_IMAGE:-redis:alpine}
export CLICKHOUSE_SMOKE_IMAGE=${CLICKHOUSE_SMOKE_IMAGE:-langwatch/clickhouse-serverless:0.4.0}
smoke_key="sk-lw-rh${fixture_id}team"

compose=(docker compose --project-directory "$repo" -p "$project" --env-file "$SMOKE_ENV"
  -f infra/compose.yml -f infra/compose.local-storage.yml -f "$scratch/isolated.yml")
started=false
cleanup() {
  local result=$?
  if "$started"; then
    "${compose[@]}" logs --no-color >"$scratch/compose.log" 2>&1 || true
    "${compose[@]}" down --volumes --remove-orphans >&2 || true
  fi
  rm -f "$SMOKE_ENV"
  printf 'Compose smoke evidence is in %s\n' "$scratch" >&2
  exit "$result"
}
trap cleanup EXIT

{
  printf '%s\n' 'BASE_HOST=http://app:5560' 'NEXTAUTH_URL=http://app:5560' 'AUTH_PROVIDER=email'
  printf '%s\n' 'LANGWATCH_CONNECT_DISABLED=true' 'DISABLE_USAGE_STATS=true' 'IS_SAAS=false'
  printf '%s\n' 'DISABLE_HTTPS_HEADERS=true'
  for key in NEXTAUTH_SECRET CREDENTIALS_SECRET API_TOKEN_JWT_SECRET LW_VIRTUAL_KEY_PEPPER \
    LW_GATEWAY_INTERNAL_SECRET LW_GATEWAY_JWT_SECRET LANGWATCH_NLP_INTERNAL_SECRET LANGY_INTERNAL_SECRET; do
    printf '%s=%s\n' "$key" "$(openssl rand -hex 32)"
  done
} >"$SMOKE_ENV"

cat >"$scratch/isolated.yml" <<'YAML'
services:
  app:
    ports: !reset []
    env_file: !override ["${SMOKE_ENV:?}"]
  workers:
    env_file: !override ["${SMOKE_ENV:?}"]
  langwatch_nlp:
    env_file: !override ["${SMOKE_ENV:?}"]
  langevals:
    ports: !reset []
  postgres:
    ports: !reset []
    image: "${POSTGRES_SMOKE_IMAGE:?}"
    pull_policy: never
  redis:
    image: "${REDIS_SMOKE_IMAGE:?}"
    pull_policy: never
  clickhouse:
    ports: !reset []
    image: "${CLICKHOUSE_SMOKE_IMAGE:?}"
    pull_policy: never
networks:
  default:
    internal: true
YAML

"${compose[@]}" config --format json | jq -e --arg id "$project" '
  .name == $id and .networks.default.internal and
  ([.services[].ports | length] | add) == 0 and
  ([.services[].pull_policy] | all(. == "never")) and
  ([.services[].networks | keys[]] | unique) == ["default"] and
  .services.app.volumes[0].source == "langwatch_objects" and
  .services.app.volumes == .services.workers.volumes and
  .services.app.environment.LANGWATCH_CONNECT_DISABLED == "true" and
  .services.workers.environment.LANGWATCH_CONNECT_DISABLED == "true" and
  .services.langwatch_nlp.command == ["nlpgo"] and
  .services.langwatch_nlp.environment.SERVER_ADDR == ":5561"
' >/dev/null
"${compose[@]}" config --images >"$scratch/images.txt"
if "$plan_only"; then
  cat "$scratch/images.txt"
  exit 0
fi

mapfile -t images < <(sort -u "$scratch/images.txt")
docker image inspect "${images[@]}" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{json .RepoTags}}' \
  >"$scratch/image-identities.txt"

wait_http() {
  local service=$1 url=$2 timeout=$3
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if "${compose[@]}" exec -T "$service" curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  printf '%s remained unready for %s seconds at %s\n' "$service" "$timeout" "$url" >&2
  return 1
}

started=true
"${compose[@]}" up -d --wait --wait-timeout 150 postgres redis clickhouse
[[ $(docker network inspect "${project}_default" --format '{{.Internal}}') == true ]]
"${compose[@]}" up -d --no-deps langwatch_nlp langevals workers app
wait_http workers http://127.0.0.1:2999/readyz 600
wait_http app http://127.0.0.1:5560/readyz 300
wait_http app http://langwatch_nlp:5561/healthz 90
wait_http app http://langevals:5562/healthcheck 90
if "${compose[@]}" exec -T app curl -4sS --noproxy '*' --max-time 3 https://example.com/ \
  >"$scratch/egress.txt" 2>&1; then
  echo 'External egress unexpectedly succeeded' >&2
  exit 1
fi

"${compose[@]}" run --rm --no-deps -w /app/apps/tasks workers pnpm task upgrade status --json \
  >"$scratch/ledger.txt" 2>"$scratch/ledger.stderr"
"${compose[@]}" exec -T postgres psql -U prisma -d mydb -At -v ON_ERROR_STOP=1 \
  -c "SELECT status, count(*) FROM mydb_upgrade_ledger._langwatch_upgrade_step GROUP BY status ORDER BY status" \
  >"$scratch/ledger-counts.txt"
if grep -q '^failed|' "$scratch/ledger-counts.txt"; then
  echo 'Failed steps in the upgrade ledger' >&2
  exit 1
fi

"${compose[@]}" exec -T postgres psql -U prisma -d mydb -v run="$fixture_id" -f - \
  <"$here/seed/tenancy.sql" >"$scratch/fixture.txt"
node "$here/otlp-batch.mjs" lw-offline-smoke 1 >"$scratch/otlp.json"
trace_id=$(jq -er '.resourceSpans[0].scopeSpans[0].spans[0].traceId' "$scratch/otlp.json")
"${compose[@]}" exec -T app curl -fsS --max-time 15 -H "X-Auth-Token: $smoke_key" \
  -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:5560/api/otel/v1/traces \
  <"$scratch/otlp.json" >"$scratch/ingest.json"

deadline=$((SECONDS + 90))
while (( SECONDS < deadline )); do
  if "${compose[@]}" exec -T app curl -fsS --max-time 5 -H "X-Auth-Token: $smoke_key" \
    "http://127.0.0.1:5560/api/v1/traces/$trace_id?format=json" >"$scratch/trace.json" 2>"$scratch/trace.stderr" &&
    jq -e '.spans | length == 2' "$scratch/trace.json" >/dev/null; then
    break
  fi
  sleep 2
done
jq -e '.spans | length == 2' "$scratch/trace.json" >/dev/null

"${compose[@]}" exec -T app curl -fsS --max-time 30 -H "X-Auth-Token: $smoke_key" \
  -H 'Content-Type: application/json' --data "{\"trace_id\":\"$trace_id\",\"evaluation_id\":\"offline-$trace_id\",\"data\":{\"input\":\"synthetic prompt\",\"output\":\"synthetic response\"}}" \
  http://127.0.0.1:5560/api/v1/evaluations/langwatch/api_keys_and_secrets_detection/evaluate >"$scratch/evaluation.json"
jq -e '(.status == "processed") and (.passed == true)' "$scratch/evaluation.json" >/dev/null

"${compose[@]}" exec -T app curl -fsS --max-time 30 -H 'Content-Type: application/json' \
  --data '{"data":[{"output":"alpha","expected_output":"alpha"},{"output":"beta","expected_output":"gamma"}]}' \
  http://langevals:5562/langevals/exact_match/evaluate >"$scratch/langevals.json"
jq -e 'map(.passed) == [true, false]' "$scratch/langevals.json" >/dev/null

cat >"$scratch/nlp.json" <<'JSON'
{"type":"execute_flow","payload":{"trace_id":"offline-service-smoke","origin":"workflow","inputs":[{}],"workflow":{
  "workflow_id":"fixture","api_key":"fixture","spec_version":"1.3","name":"Offline workflow","icon":"","description":"","version":"1","template_adapter":"default","state":{},
  "nodes":[
    {"id":"entry","type":"entry","data":{"outputs":[{"identifier":"text","type":"str"}],"dataset":{"inline":{"records":{"text":["langwatch"]}}},"entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1}},
    {"id":"uppercase","type":"code","data":{"parameters":[{"identifier":"code","type":"code","value":"import langwatch\n\ndef execute(text):\n    return {'answer': text.upper()}\n"}],"inputs":[{"identifier":"text","type":"str"}],"outputs":[{"identifier":"answer","type":"str"}]}},
    {"id":"end","type":"end","data":{"inputs":[{"identifier":"answer","type":"str"}]}}
  ],"edges":[
    {"id":"in-text","source":"entry","sourceHandle":"outputs.text","target":"uppercase","targetHandle":"inputs.text","type":"default"},
    {"id":"out-answer","source":"uppercase","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
  ]
}}}
JSON
nlp_code=$("${compose[@]}" exec -T app curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary @- http://langwatch_nlp:5561/go/studio/execute_sync \
  <"$scratch/nlp.json")
[[ $nlp_code == 401 ]]
nlp_secret=$(sed -n 's/^LANGWATCH_NLP_INTERNAL_SECRET=//p' "$SMOKE_ENV")
"${compose[@]}" exec -T app curl -fsS --max-time 30 -H 'Content-Type: application/json' \
  -H 'X-LangWatch-Origin: workflow' -H "X-LangWatch-NLP-Secret: $nlp_secret" \
  --data-binary @- http://langwatch_nlp:5561/go/studio/execute_sync \
  <"$scratch/nlp.json" >"$scratch/nlp-response.json"
jq -e '(.status == "success") and (.result.answer == "LANGWATCH")' "$scratch/nlp-response.json" >/dev/null

"${compose[@]}" exec -T langwatch_nlp /usr/bin/python3.11 - <<'PY' >"$scratch/nlp-models.txt"
import json
import os
from pathlib import Path
catalog = Path(os.environ['LANGWATCH_MODEL_CATALOG_DIR'])
for filename in ['model-catalog.json', 'model-catalog.overlay.json']:
    assert isinstance(json.loads((catalog / filename).read_text()), (dict, list))
print('NLP packaged model catalogue passed')
PY

"${compose[@]}" exec -T langevals python - <<'PY' >"$scratch/langevals-tokenizers.txt"
import json
import os
from pathlib import Path
import tiktoken
catalog = Path(os.environ['LANGWATCH_MODEL_PRICING_DIR'])
for filename in ['model-catalog.json', 'model-catalog.overlay.json']:
    assert isinstance(json.loads((catalog / filename).read_text()), (dict, list))
for name in tiktoken.list_encoding_names():
    assert tiktoken.get_encoding(name).encode('LangWatch')
    print(name)
PY

"${compose[@]}" exec -T app node -e '
  const fs = require("node:fs"); const assert = require("node:assert/strict");
  for (const name of ["vocab.bpe", "encoder.json", "o200k_base.tiktoken", "cl100k_base.tiktoken", "r50k_base.tiktoken", "p50k_base.tiktoken"]) {
    assert(fs.statSync(`${process.env.TIKTOKENS_PATH}/${name}`).size > 0, name);
  }
' >"$scratch/app-tokenizers.txt"

"${compose[@]}" exec -T clickhouse clickhouse-client --password "$CLICKHOUSE_PASSWORD" --database langwatch \
  --query "SELECT version(), (SELECT max(version_id) FROM goose_db_version), count() FROM stored_spans WHERE TraceId = '$trace_id'" \
  >"$scratch/clickhouse.tsv"
latest_migration=$(find packages/clickhouse-migrations/migrations -name '*.sql' -printf '%f\n' | sort | tail -1)
latest_version=$((10#${latest_migration%%_*}))
awk -v version="$latest_version" '$2 == version && $3 == 2 {ok=1} END {exit !ok}' "$scratch/clickhouse.tsv"

echo 'PASS: isolated Compose, API and worker ready, trace ingestion/readback, evaluation, NLP code workflow, model catalogs, tokenizer caches, ClickHouse migrations, and egress blocked.'
