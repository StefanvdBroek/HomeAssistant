#!/usr/bin/env bash
# Kondigt smarthome.local aan via Bonjour (mDNS) met het huidige IP-adres van deze Mac,
# en houdt de poort-80-koppeling van Home Assistant op dat IP-adres.
# Draait permanent; wordt gestart door de LaunchAgent uit install-mdns.sh.
set -uo pipefail

HOSTNAME_MDNS="${HOSTNAME_MDNS:-smarthome.local}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

current_ip=""
dns_pid=""

cleanup() { [[ -n "$dns_pid" ]] && kill "$dns_pid" 2>/dev/null; exit 0; }
trap cleanup INT TERM

while true; do
  ip="$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)"

  if [[ -n "$ip" && "$ip" != "$current_ip" ]]; then
    [[ -n "$dns_pid" ]] && kill "$dns_pid" 2>/dev/null
    echo "$(date '+%F %T') $HOSTNAME_MDNS -> $ip"
    dns-sd -P "Home Assistant" _http._tcp local 80 "$HOSTNAME_MDNS" "$ip" >/dev/null &
    dns_pid=$!
    current_ip="$ip"
  fi

  # Draait de container op een oud IP-adres? Dan opnieuw koppelen.
  if [[ -n "$current_ip" ]] && docker inspect homeassistant >/dev/null 2>&1; then
    if ! docker port homeassistant 8123/tcp 2>/dev/null | grep -q "^$current_ip:80$"; then
      echo "$(date '+%F %T') Home Assistant opnieuw koppelen aan $current_ip:80"
      "$SCRIPT_DIR/ha.sh" up >/dev/null 2>&1 || true
    fi
  fi

  # dns-sd gestopt? Volgende ronde opnieuw starten.
  if [[ -n "$dns_pid" ]] && ! kill -0 "$dns_pid" 2>/dev/null; then
    current_ip=""
  fi

  sleep 30
done
