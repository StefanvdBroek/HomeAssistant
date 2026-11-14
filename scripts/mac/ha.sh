#!/usr/bin/env bash
# Home Assistant op macOS beheren (testomgeving).
#   scripts/mac/ha.sh up | down | restart | logs | status
set -euo pipefail

cd "$(dirname "$0")/../.."

MAC_LAN_IP="$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || true)"
if [[ -z "$MAC_LAN_IP" ]]; then
  echo "✗ Geen netwerkadres gevonden (wifi/ethernet uit?)." >&2
  exit 1
fi
export MAC_LAN_IP

compose() { docker compose -f docker-compose.yml -f docker-compose.mac.yml "$@"; }

case "${1:-up}" in
  up)      compose up -d homeassistant
           echo "→ http://smarthome.local  (of http://$MAC_LAN_IP)" ;;
  down)    compose down ;;
  restart) compose up -d --force-recreate homeassistant ;;
  logs)    compose logs -f homeassistant ;;
  status)  compose ps ;;
  *)       echo "Gebruik: $0 up|down|restart|logs|status" >&2; exit 1 ;;
esac
