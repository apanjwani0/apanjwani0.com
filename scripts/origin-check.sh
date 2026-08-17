#!/usr/bin/env bash
#
# Verify the origin + edge posture from outside, the way an attacker sees it.
#
#   npm run origin:check
#
# No credentials, no SSH, no cloud API. Every check here is a plain HTTP request
# any stranger could make — that is the point. A control you can only confirm by
# logging into a dashboard is a control you will stop confirming.
#
# Covers the three settings that live outside git and therefore have nothing else
# asserting them: the Cloudflare Transform Rule injecting x-origin-auth, the
# Browser Cache TTL override, and whether the origin still answers on its own IP.
# security:smoke asserts the code half; this asserts the deployed half.
#
# Exit 0 = every invariant holds. Non-zero = at least one regressed.
set -uo pipefail   # deliberately not -e: every check must run so you see it all

SITE=${SITE:-https://apanjwani0.com}
ORIGIN_IP=${ORIGIN_IP:-80.225.248.246}

fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
note() { printf '      %s\n' "$1"; }

printf '\n\033[1mSite reachable through Cloudflare\033[0m  (%s)\n' "$SITE"
site_head=$(curl -sSI -m 15 "$SITE" 2>/dev/null)
site_code=$(printf '%s' "$site_head" | awk 'NR==1{print $2}')
if [[ $site_code == 200 ]]; then
  ok "200"
else
  bad "expected 200, got '${site_code:-no response}' — the site is down for real users"
  note "If you just enabled the origin lock, the Transform Rule value and the"
  note "ORIGIN_SHARED_SECRET GitHub secret disagree. Fix the RULE (instant),"
  note "not the secret (costs a redeploy)."
fi

printf '\n\033[1mOrigin not reachable directly\033[0m  (http://%s/)\n' "$ORIGIN_IP"
direct_code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "http://$ORIGIN_IP/" 2>/dev/null)
curl_rc=$?
if (( curl_rc == 28 || curl_rc == 7 )); then
  ok "connection blocked (curl rc=$curl_rc) — firewall is doing its job"
elif [[ $direct_code == 404 ]]; then
  warn "app lock holding (404), but the box still answers"
  note "Every scanner still wakes the origin and burns CPU, and the only thing"
  note "standing between them and the app is one Cloudflare Transform Rule."
  note "Close it at the network — see the CIDR list printed below."
  # Not a failure: this is the documented intermediate state after the app-level
  # lock is enabled but before the firewall half is done.
  cache=$(curl -sSI -m 8 "http://$ORIGIN_IP/" 2>/dev/null | tr -d '\r' \
          | awk -F': ' 'tolower($1)=="cache-control"{print $2}')
  [[ $cache == *no-store* ]] \
    && ok "the 404 is no-store (a broken rule cannot get cached and outlive the fix)" \
    || bad "the 404 is cacheable ('${cache:-none}') — a bad rule would stick at the edge"
elif [[ $direct_code == 200 ]]; then
  bad "200 — Cloudflare is fully bypassable, the app is answering strangers directly"
else
  warn "unexpected '${direct_code:-none}' (curl rc=$curl_rc)"
fi

printf '\n\033[1mEdge caches HTML, browsers do not\033[0m\n'
cc=$(printf '%s' "$site_head" | tr -d '\r' \
     | awk -F': ' 'tolower($1)=="cache-control"{print $2}')
if [[ -z $cc ]]; then
  bad "no cache-control header at all"
else
  note "$cc"
  # max-age must be 0: browser-cached HTML cannot be purged, so any non-zero
  # value makes an /admin edit invisible until every visitor's own cache expires.
  # Cloudflare's Browser Cache TTL silently rewrites this — hence checking live.
  [[ $cc == *"max-age=0"* ]] \
    && ok "max-age=0 — content edits are purgeable" \
    || bad "max-age is not 0 — Cloudflare Browser Cache TTL is overriding it again"
  [[ $cc == *"s-maxage="* ]] \
    && ok "s-maxage present — the edge still caches" \
    || bad "no s-maxage — every request is waking the origin"
fi

cf_status=$(printf '%s' "$site_head" | tr -d '\r' \
            | awk -F': ' 'tolower($1)=="cf-cache-status"{print $2}')
[[ -n $cf_status ]] \
  && ok "cf-cache-status: $cf_status" \
  || bad "no cf-cache-status — the response never went through Cloudflare"

if [[ $direct_code == 404 || $direct_code == 200 ]]; then
  printf '\n\033[1mCloudflare ranges to allow (everything else denied)\033[0m\n'
  # Fetched one at a time on purpose: the v4 list ships without a trailing
  # newline, so a single multi-URL curl fuses its last CIDR onto the first v6 one.
  ranges=""
  for list in ips-v4 ips-v6; do
    body=$(curl -fsS -m 20 "https://www.cloudflare.com/$list") \
      || { warn "could not fetch $list"; ranges=""; break; }
    ranges+="$body"$'\n'
  done
  if [[ -n $ranges ]]; then
    printf '%s' "$ranges" | grep . | sed 's/^/      /'
    note ""
    note "$(printf '%s' "$ranges" | grep -c .) rules to add, TCP port 80, in the"
    note "OCI console: VCN → Subnets → Security → Default Security List."
  fi
fi

printf '\n'
(( fail )) && { printf '\033[31mFAIL\033[0m — see above\n\n'; exit 1; }
printf '\033[32mAll checks passed\033[0m\n\n'
