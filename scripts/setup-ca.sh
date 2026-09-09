#!/usr/bin/env bash
# Exports the corporate root CA from the macOS keychain so Node can verify TLS through
# an intercepting proxy. No-op on machines without one.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/certs/corporate-ca.pem"
mkdir -p "$(dirname "$out")"
: > "$out"
for name in Zscaler "Netskope" "Palo Alto"; do
  security find-certificate -a -c "$name" -p /Library/Keychains/System.keychain >> "$out" 2>/dev/null || true
done
count=$(grep -c 'BEGIN CERTIFICATE' "$out" || true)
if [ "$count" -eq 0 ]; then
  rm -f "$out"
  echo "No intercepting CA found in the system keychain — nothing to do."
else
  echo "Wrote $count certificate(s) to certs/corporate-ca.pem"
fi
