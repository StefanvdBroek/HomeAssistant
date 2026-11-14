#!/usr/bin/env bash
# Home Assistant op macOS beheren (testomgeving).
#   scripts/mac/ha.sh up | down | restart | logs | status | eufy
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
  eufy)    # Brug voor de Eufy-deurbel; vraagt EUFY_USERNAME/EUFY_PASSWORD in .env
           if ! grep -qE '^EUFY_USERNAME=.+' .env 2>/dev/null; then
             echo "✗ Vul eerst EUFY_USERNAME en EUFY_PASSWORD in .env in (zie .env.example)." >&2; exit 1
           fi
           compose --profile eufy up -d eufy-security-ws go2rtc
           echo "→ In Home Assistant: Eufy Security toevoegen met host eufy-security-ws, poort 3000" ;;
  *)       echo "Gebruik: $0 up|down|restart|logs|status|eufy" >&2; exit 1 ;;
esac
