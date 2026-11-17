#!/usr/bin/env bash
# End-to-end check of a running stack through nginx, exactly as users reach it.
#   STOREFRONT=http://localhost:8080 ADMIN=http://localhost:8081 ADMIN_PASSWORD=… scripts/smoke-test.sh
# Optional: EXPECT_VERSION=<git sha> to assert the API build, COMPOSE="docker compose …" to also test a restart.
set -euo pipefail

STOREFRONT=${STOREFRONT:-http://localhost:8080}
ADMIN=${ADMIN:-http://localhost:8081}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@vsev.local}
ADMIN_PASSWORD=${ADMIN_PASSWORD:?set ADMIN_PASSWORD}
SLUG=${CAMPAIGN_SLUG:-vs-ev-plus-bmw-ix2-2026q4}

pass=0
ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -fsS "$@"; }

echo "storefront $STOREFRONT · admin $ADMIN"

curl -fsS "$STOREFRONT/" | grep -q '<div id="root">' && ok "storefront serves the SPA" || fail "storefront index"
[ "$(status "$STOREFRONT/orders/some-deep-link")" = 200 ] && ok "SPA deep links fall back to index.html" || fail "SPA fallback"
headers=$(curl -fsSI "$STOREFRONT/")
grep -qi '^x-frame-options: SAMEORIGIN' <<<"$headers" && grep -qi '^cache-control: no-cache' <<<"$headers" \
  && ok "security + no-cache headers on index.html" || fail "index.html headers: $headers"
asset=$(curl -fsS "$STOREFRONT/" | grep -o '/assets/[^"]*\.js' | head -1)
curl -fsSI "$STOREFRONT$asset" | grep -qi 'cache-control: public, max-age=31536000, immutable' \
  && ok "hashed assets cached immutably" || fail "asset cache header"

health=$(json "$STOREFRONT/api/v1/health")
grep -q '"ok":true' <<<"$health" && ok "API healthy through nginx ($health)" || fail "health: $health"
if [ -n "${EXPECT_VERSION:-}" ]; then
  grep -q "\"version\":\"$EXPECT_VERSION\"" <<<"$health" && ok "running build $EXPECT_VERSION" || fail "expected $EXPECT_VERSION, got $health"
fi

shops=$(json "$STOREFRONT/api/v1/campaigns/$SLUG" | grep -o '"hoursLabel"' | wc -l)
[ "$shops" -gt 0 ] && ok "campaign page has $shops shops" || fail "campaign page"

[ "$(status "$STOREFRONT/api/v1/admin/dashboard")" = 404 ] && ok "admin API hidden on the storefront port" || fail "admin API exposed on storefront"
[ "$(status "$ADMIN/api/v1/campaigns/$SLUG")" = 404 ] && ok "customer API hidden on the admin port" || fail "customer API exposed on admin port"
curl -fsS "$ADMIN/" | grep -q '<div id="root">' && ok "admin console serves the SPA" || fail "admin index"
curl -fsSI "$ADMIN/" | grep -qi '^x-robots-tag: noindex' && ok "admin console is noindex" || fail "admin noindex"

token=$(json -X POST "$ADMIN/api/v1/admin/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$token" ] && ok "admin login" || fail "admin login"
[ "$(status -H "Authorization: Bearer $token" "$ADMIN/api/v1/admin/dashboard")" = 200 ] && ok "admin dashboard" || fail "admin dashboard"

email="smoke-$(date +%s)-$RANDOM@example.com"
utoken=$(json -X POST "$STOREFRONT/api/v1/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"Passw0rd!x\",\"name\":\"Smoke Test\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$utoken" ] && ok "customer registration" || fail "register"
order=$(json -X POST "$STOREFRONT/api/v1/orders" -H "Authorization: Bearer $utoken" -H 'content-type: application/json' \
  -d "{\"campaignSlug\":\"$SLUG\",\"vehicleModelId\":\"m-ix2-xdrive30\",\"plate\":\"SMK-0001\",\"shopId\":\"s-xiyun\",\"deadlineAcknowledged\":true}")
order_id=$(sed -n 's/^{"id":"\([^"]*\)".*/\1/p' <<<"$order")
[ -n "$order_id" ] && ok "order created ($order_id)" || fail "create order: $order"
checkout=$(json -X POST "$STOREFRONT/api/v1/orders/$order_id/checkout" -H "Authorization: Bearer $utoken")
grep -q '"mode":"internal"' <<<"$checkout" && grep -q '"status":"paid"' <<<"$checkout" \
  && ok "checkout paid (built-in gateway)" || grep -q '"mode":"redirect"' <<<"$checkout" \
  && ok "checkout handed to the external cart" || fail "checkout: $checkout"

if [ -n "${COMPOSE:-}" ]; then
  $COMPOSE restart api >/dev/null
  for _ in $(seq 1 30); do
    [ "$(status "$STOREFRONT/api/v1/health")" = 200 ] && break
    sleep 2
  done
  [ "$(status -H "Authorization: Bearer $utoken" "$STOREFRONT/api/v1/me/orders/$order_id")" = 200 ] \
    && ok "order survives an API restart (SQLite volume)" || fail "data lost after restart"
  $COMPOSE exec -T backup sh -c 'node dist/backup.mjs /data/backups/smoke.db && ls /data/backups' | grep -q smoke.db \
    && ok "backup service writes to /data/backups" || fail "backup"
fi

echo "all $pass checks passed"
