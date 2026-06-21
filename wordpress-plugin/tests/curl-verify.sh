#!/usr/bin/env bash
#
# curl-verify.sh — end-to-end verification of the khaveeai REST session route.
#
# Exercises POST {BASE}/wp-json/khaveeai/v1/session as a fully anonymous
# client (no cookies, no nonce header) and asserts the four observable
# Phase 6 REST success criteria:
#
#   (1) REST-01 — anonymous 200 + an ek_-prefixed ephemeralToken in the JSON body
#   (2) REST-02 — the configured OpenAI key never appears in the response
#   (3) REST-03 — looping past the per-IP rate limit (D-01: 5 per 10 min) returns 429
#   (4) REST-04 — the 200 response carries Cache-Control: no-store
#
# PREREQUISITES (human steps — see 06-04-PLAN.md Task 2):
#   - A running WordPress install with the khaveeai plugin active
#     (wp-env recommended: `npx @wordpress/env start`, serves WP at
#     http://localhost:8888 — see .planning/research/STACK.md).
#   - khaveeai_settings.api_key set to a REAL OpenAI API key, e.g.:
#       wp option update khaveeai_settings '{"api_key":"sk-...","instructions":"...","voice":"alloy"}' --format=json
#     so that ConfigSourceInterface::get_api_key() returns a real key.
#   - Rate-limit transients cleared before a clean run, since check (3)
#     intentionally consumes the per-IP budget:
#       wp transient delete --all
#   - Optionally export KHAVEEAI_TEST_KEY to the same real key used above
#     so check (2) can assert the literal key value never leaks; if unset,
#     check (2) still asserts no `sk-`-prefixed string appears, but prints
#     a SKIP note for the exact-key substring assertion.
#
# Usage:
#   bash wordpress-plugin/tests/curl-verify.sh [base_url]
#   KHAVEEAI_TEST_KEY='sk-...' bash wordpress-plugin/tests/curl-verify.sh http://localhost:8888
#
# Exits 0 only if all four checks PASS; exits non-zero on any failure.

set -euo pipefail

BASE="${1:-http://localhost:8888}"
ROUTE="${BASE}/wp-json/khaveeai/v1/session"
REQUEST_BODY='{"sessionConfig":{"type":"realtime"}}'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
	echo "PASS: $1"
	PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
	echo "FAIL: $1"
	FAIL_COUNT=$((FAIL_COUNT + 1))
}

# Issue one anonymous POST, capturing headers+body together (-i) and the
# HTTP status code on the last line via -w. No -b/-c cookie jar and no
# X-WP-Nonce header is sent anywhere in this script — deliberate, since
# the route's permission_callback is __return_true (PITFALLS.md Pitfall 2).
do_post() {
	curl -sS -i \
		-X POST \
		-H 'Content-Type: application/json' \
		--data "${REQUEST_BODY}" \
		-w '\nHTTP_STATUS:%{http_code}\n' \
		"${ROUTE}"
}

extract_status() {
	echo "$1" | grep -o 'HTTP_STATUS:[0-9]*' | tail -1 | cut -d: -f2
}

echo "=== khaveeai REST contract verification ==="
echo "Target: ${ROUTE}"
echo

# ── Check 1 (REST-01): anonymous 200 + ek_-prefixed ephemeralToken ──
echo "--- Check 1 (REST-01): anonymous 200 + ephemeralToken ---"
RESPONSE_1="$(do_post)"
STATUS_1="$(extract_status "${RESPONSE_1}")"

if [ "${STATUS_1}" = "200" ]; then
	if command -v jq >/dev/null 2>&1; then
		BODY_1="$(echo "${RESPONSE_1}" | sed -n '/^{/,/^}/p')"
		TOKEN="$(echo "${BODY_1}" | jq -r '.data.ephemeralToken // empty' 2>/dev/null || true)"
	else
		TOKEN="$(echo "${RESPONSE_1}" | grep -o '"ephemeralToken"[[:space:]]*:[[:space:]]*"ek_[^"]*"' | head -1 | grep -o 'ek_[^"]*' || true)"
	fi

	if echo "${TOKEN}" | grep -q '^ek_'; then
		pass "REST-01 — HTTP 200 with ephemeralToken starting 'ek_' (token: ${TOKEN:0:8}...)"
	else
		fail "REST-01 — HTTP 200 but no ek_-prefixed ephemeralToken found in response body"
	fi
else
	fail "REST-01 — expected HTTP 200, got ${STATUS_1}"
fi
echo

# ── Check 2 (REST-02): configured OpenAI key never appears in the response ──
echo "--- Check 2 (REST-02): API key absent from response ---"
if [ -n "${KHAVEEAI_TEST_KEY:-}" ]; then
	if echo "${RESPONSE_1}" | grep -qF "${KHAVEEAI_TEST_KEY}"; then
		fail "REST-02 — configured KHAVEEAI_TEST_KEY value found in response (headers+body)"
	else
		pass "REST-02 — configured KHAVEEAI_TEST_KEY value not found in response (headers+body)"
	fi
else
	echo "SKIP: KHAVEEAI_TEST_KEY not set — cannot assert against the exact configured key value."
fi

if echo "${RESPONSE_1}" | grep -qE 'sk-[A-Za-z0-9_-]{8,}'; then
	fail "REST-02 — an sk-prefixed string was found in the response (possible key leak)"
else
	pass "REST-02 — no sk-prefixed string found anywhere in the response"
fi
echo

# ── Check 3 (REST-03): looping past the per-IP limit (D-01: 5/10min) returns 429 ──
echo "--- Check 3 (REST-03): rate limit (429 past per-IP cap) ---"
FOUND_429=0
for i in $(seq 1 7); do
	RESP_LOOP="$(do_post)"
	STATUS_LOOP="$(extract_status "${RESP_LOOP}")"
	echo "  request ${i}/7 -> HTTP ${STATUS_LOOP}"
	if [ "${STATUS_LOOP}" = "429" ]; then
		FOUND_429=1
	fi
done

if [ "${FOUND_429}" -eq 1 ]; then
	pass "REST-03 — at least one of 7 rapid requests returned HTTP 429"
else
	fail "REST-03 — no request in the 7-request loop returned HTTP 429 (per-IP limit not enforced?)"
fi
echo

# ── Check 4 (REST-04): Cache-Control: no-store on the 200 response from Check 1 ──
echo "--- Check 4 (REST-04): Cache-Control: no-store header ---"
if echo "${RESPONSE_1}" | grep -qi '^Cache-Control:[[:space:]]*no-store'; then
	pass "REST-04 — Cache-Control: no-store present on the 200 response"
else
	fail "REST-04 — Cache-Control: no-store header not found on the 200 response"
fi
echo

echo "=== Summary: ${PASS_COUNT} passed, ${FAIL_COUNT} failed ==="

if [ "${FAIL_COUNT}" -gt 0 ]; then
	exit 1
fi

exit 0
