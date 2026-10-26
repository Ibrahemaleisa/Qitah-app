#!/usr/bin/env bash
# Smoke test through CloudFront: /health and /ready must return 200 with {"ok":true}.
# Usage: infra/scripts/smoke-test.sh https://dxxxxxxxx.cloudfront.net
set -euo pipefail
BASE="${1%/}"

for path in /health /ready; do
  echo "GET ${BASE}${path}"
  body="$(curl -fsS --max-time 10 --retry 12 --retry-delay 10 --retry-all-errors "${BASE}${path}")"
  echo "  -> ${body}"
  if [[ "$(jq -r '.ok' <<<"$body")" != "true" ]]; then
    echo "::error::${path} did not report ok=true"
    exit 1
  fi
done

# The ALB must refuse direct traffic (no secret origin header) - checked only when ALB_DNS is given.
if [[ -n "${ALB_DNS:-}" ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${ALB_DNS}/health" || true)"
  echo "Direct ALB request -> HTTP ${code} (expected 403 or timeout)"
  if [[ "$code" == "200" ]]; then
    echo "::error::ALB answered 200 without the CloudFront origin header"
    exit 1
  fi
fi
echo "Smoke test passed."
