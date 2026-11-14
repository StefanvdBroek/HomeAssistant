# Home Assistant

Docker-omgeving voor Home Assistant op een Linux mini-pc, met Mosquitto (MQTT) en optioneel Zigbee2MQTT en ESPHome.

| Dienst | Poort | Standaard aan |
|---|---|---|
| Home Assistant | http://&lt;ip&gt;:8123 | ✅ |
| Mosquitto (MQTT) | 1883 | ✅ |
| Zigbee2MQTT | http://&lt;ip&gt;:8080 | `--profile zigbee` |
| ESPHome | http://&lt;ip&gt;:6052 | `--profile esphome` |

> Bedoeld voor Linux. Op macOS/Windows werken `network_mode: host`, Bluetooth en USB-sticks niet goed binnen Docker.

## Installatie op de mini-pc

```bash
git clone https://github.com/StefanvdBroek/HomeAssistant.git
cd HomeAssistant
./scripts/setup.sh        # maakt .env aan
nano .env                 # stel MQTT_PASSWORD (en ZIGBEE_DEVICE) in
./scripts/setup.sh        # maakt wachtwoordbestand en configuraties aan
docker compose up -d
```

Open daarna `http://<ip-van-mini-pc>:8123` en maak een account aan.

### Zigbee2MQTT

1. Steek de Zigbee-stick in en zoek het pad op: `ls -l /dev/serial/by-id/`
2. Zet dat pad in `.env` bij `ZIGBEE_DEVICE` en kies de juiste `ZIGBEE_ADAPTER`
   (`zstack` voor SONOFF ZBDongle-P, `ember` voor ZBDongle-E).
3. Start: `docker compose --profile zigbee up -d`

### MQTT koppelen aan Home Assistant

Instellingen → Apparaten & diensten → Integratie toevoegen → **MQTT**:

- Broker: `localhost` (Home Assistant draait in host-netwerkmodus)
- Poort: `1883`
- Gebruiker/wachtwoord: `MQTT_USER` / `MQTT_PASSWORD` uit `.env`

Zigbee2MQTT-apparaten verschijnen daarna automatisch in Home Assistant.

## Beheer

```bash
docker compose pull && docker compose up -d   # updaten (lees eerst de release notes)
docker compose logs -f homeassistant          # logs bekijken
docker compose restart homeassistant          # herstarten
```

## Wat staat er in git?

Alleen de configuratie (`configuration.yaml`, automations, scripts, scenes, compose-bestand). Runtime-data, databases,
`.env`, `secrets.yaml`, het Mosquitto-wachtwoordbestand en de Zigbee-netwerksleutel staan in `.gitignore`.

**Back-up:** maak naast git ook regelmatig een back-up van de hele map (vooral `homeassistant/config/.storage` en
`zigbee2mqtt/data`). Zonder die bestanden ben je je gekoppelde apparaten en Zigbee-netwerk kwijt.
