#!/usr/bin/env bash
# Eenmalige voorbereiding op de mini-pc. Veilig om opnieuw te draaien.
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. .env aanmaken
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "→ .env aangemaakt. Pas MQTT_PASSWORD (en eventueel ZIGBEE_DEVICE) aan en draai dit script opnieuw."
  exit 0
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${MQTT_USER:-}" || -z "${MQTT_PASSWORD:-}" || "${MQTT_PASSWORD}" == "verander-mij" ]]; then
  echo "✗ Stel eerst MQTT_USER en een eigen MQTT_PASSWORD in .env in." >&2
  exit 1
fi

# 2. Mosquitto-wachtwoordbestand aanmaken
mkdir -p mosquitto/data mosquitto/log
if [[ ! -f mosquitto/config/passwd ]]; then
  docker run --rm -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
    sh -c "touch /mosquitto/config/passwd \
      && mosquitto_passwd -b /mosquitto/config/passwd '$MQTT_USER' '$MQTT_PASSWORD' \
      && chmod 0700 /mosquitto/config/passwd \
      && chown root:root /mosquitto/config/passwd"
  echo "→ Mosquitto-gebruiker '$MQTT_USER' aangemaakt."
else
  echo "✓ mosquitto/config/passwd bestaat al (verwijder het om opnieuw aan te maken)."
fi

# 3. Zigbee2MQTT-configuratie klaarzetten
mkdir -p zigbee2mqtt/data
if [[ ! -f zigbee2mqtt/data/configuration.yaml ]]; then
  cp zigbee2mqtt/configuration.template.yaml zigbee2mqtt/data/configuration.yaml
  echo "→ zigbee2mqtt/data/configuration.yaml aangemaakt."
else
  echo "✓ zigbee2mqtt/data/configuration.yaml bestaat al."
fi

# 4. Home Assistant secrets
if [[ ! -f homeassistant/config/secrets.yaml ]]; then
  cp homeassistant/config/secrets.yaml.example homeassistant/config/secrets.yaml
  echo "→ homeassistant/config/secrets.yaml aangemaakt."
fi

echo
echo "Klaar. Start met:"
echo "  docker compose up -d                    # Home Assistant + Mosquitto"
echo "  docker compose --profile zigbee up -d   # + Zigbee2MQTT"
