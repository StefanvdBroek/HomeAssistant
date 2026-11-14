#!/usr/bin/env bash
# Meldt aan Home Assistant dat de iPhone gebeld wordt, zodat de stofzuiger kan pauzeren.
#
# De iPhone geeft dat zelf niet door, maar een Mac met "Gesprekken van iPhone" (FaceTime >
# Instellingen) gaat mee over. Dit script volgt het logboek van macOS (callservicesd) en roept
# de webhook uit packages/stofzuiger_telefoon.yaml aan met:
#   gaat_over         er komt een gesprek binnen (telefoon of FaceTime)
#   elders_opgenomen  opgenomen op de iPhone (het einde daarvan ziet de Mac niet)
#   beeindigd         gesprek voorbij (gemist, geweigerd of op de Mac gevoerd)
#
# Draait als LaunchAgent: scripts/mac/install-telefoon.sh
# Testen zonder te bellen: scripts/mac/telefoon-monitor.sh --test gaat_over
set -uo pipefail

cd "$(dirname "$0")/../.."
HA_URL="${HA_URL:-http://localhost:8123}"
WEBHOOK_ID="$(sed -n 's/^telefoon_webhook_id:[[:space:]]*//p' homeassistant/config/secrets.yaml 2>/dev/null | tr -d '"'"'"' ')"

if [[ -z "$WEBHOOK_ID" ]]; then
  echo "✗ telefoon_webhook_id ontbreekt in homeassistant/config/secrets.yaml" >&2
  exit 1
fi

meld() {
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "{\"gebeurtenis\": \"$1\"}" "$HA_URL/api/webhook/$WEBHOOK_ID")
  echo "$(date '+%F %T') $1 -> $code"
}

if [[ "${1:-}" == "--test" ]]; then
  meld "${2:-gaat_over}"
  exit 0
fi

echo "$(date '+%F %T') telefoon-monitor gestart (Home Assistant: $HA_URL)"

# Alleen de regels die het begin en einde van een gesprek aangeven.
/usr/bin/log stream --style compact --predicate 'process == "callservicesd" AND (
    eventMessage CONTAINS "Handle incoming IncomingCall message"
    OR eventMessage CONTAINS "reportNewIncomingCallWithUUID"
    OR eventMessage CONTAINS "Handle incoming CallAnsweredElsewhere message"
    OR eventMessage CONTAINS "Handle incoming CallDisconnected message"
    OR eventMessage CONTAINS "sendCallDisconnectedMessageToClientForCall")' |
while IFS= read -r regel; do
  case "$regel" in
    *"IncomingCall message"* | *reportNewIncomingCallWithUUID*) meld gaat_over ;;
    *CallAnsweredElsewhere*) meld elders_opgenomen ;;
    *CallDisconnected* ) meld beeindigd ;;
  esac
done
