#!/usr/bin/env bash
#
# Restrict the origin's HTTP port to Cloudflare's published IP ranges.
#
# WHY: the site sits behind Cloudflare, but the Oracle box also answers on its own
# public IP with port 80 open to 0.0.0.0/0. Anyone who resolves that address (the
# ranges are trivially discoverable from historical DNS records — this is not a
# secret you can keep) reaches the Node process directly, which means the WAF,
# rate limiting, bot management, caching and TLS in front of it are all optional.
# Every "client IP" header is also attacker-chosen on that path, which is why
# nothing in the app authorizes on one.
#
# WHAT THIS DOES: allows 80/443 only from Cloudflare, keeps SSH as-is, and leaves
# everything else denied. Run it on the server, not on your Mac.
#
#   scp scripts/lock-origin-to-cloudflare.sh ubuntu@<host>:~
#   ssh ubuntu@<host> 'sudo bash ~/lock-origin-to-cloudflare.sh'
#
# The stronger alternative is a Cloudflare Tunnel: cloudflared dials out, so you
# close 80/443 entirely and there is no inbound surface left to filter. Prefer it
# if you are willing to change how traffic reaches the box. This script is the
# minimal-change option that keeps the current topology.
#
# Re-run after Cloudflare changes its ranges (rare; they publish updates).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

command -v ufw >/dev/null || { echo "ufw not installed" >&2; exit 1; }

echo "==> Fetching Cloudflare IP ranges"
V4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4)
V6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6)

# Refuse to touch the firewall on a partial fetch — a truncated list would lock
# out real traffic, and a failed one would otherwise leave the box wide open.
[[ $(wc -l <<<"$V4") -ge 5 ]] || { echo "v4 list looks wrong, aborting" >&2; exit 1; }
[[ $(wc -l <<<"$V6") -ge 3 ]] || { echo "v6 list looks wrong, aborting" >&2; exit 1; }

echo "==> Backing up current rules to /root/ufw-backup-before-cf.txt"
ufw status numbered > /root/ufw-backup-before-cf.txt 2>&1 || true

echo "==> Removing blanket 80/443 rules"
# Delete by rule text; ignore misses so the script is idempotent.
for rule in "80/tcp" "443/tcp" "80" "443"; do
  yes | ufw delete allow "$rule" >/dev/null 2>&1 || true
done

echo "==> Allowing 80/443 from Cloudflare only"
while read -r cidr; do
  [[ -z "$cidr" ]] && continue
  ufw allow from "$cidr" to any port 80 proto tcp comment 'cloudflare' >/dev/null
  ufw allow from "$cidr" to any port 443 proto tcp comment 'cloudflare' >/dev/null
done <<<"$V4
$V6"

echo "==> SSH stays open (do not lock yourself out)"
ufw allow 22/tcp comment 'ssh' >/dev/null

ufw --force enable
ufw status verbose

cat <<'DONE'

==> Done. Verify from your laptop:

    curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://apanjwani0.com/    # expect 200
    curl -sS -m 10 -o /dev/null -w '%{http_code}\n' http://<origin-ip>/        # expect timeout

If the direct hit still returns 200, the OCI Security List is still allowing it —
UFW is only the OS-level firewall. Narrow the ingress rule for TCP 80/443 in the
OCI console (Subnet -> Security -> Default Security List) to the same ranges.
DONE
