# Stacks op de Docker-VM

Docker-host naast Home Assistant OS op Proxmox: **VM 103 `docker`** (Debian 13 "trixie",
2 vCPU, 3 GB RAM, 32 GB; IP 192.168.2.43, gebruiker `beheer` met SSH-sleutel).

| Stack | Map op de VM | Adres |
|---|---|---|
| Portainer | `/opt/stacks/portainer` | https://192.168.2.43:9443 |
| Uptime Kuma | `/opt/stacks/uptime-kuma` | http://192.168.2.43:3001 |
| Glances (alleen API, voor Home Assistant) | `/opt/stacks/glances` | http://192.168.2.43:61208/api/4 |

Een stack bijwerken: compose-bestand hier aanpassen, naar de VM kopiëren en daar
`docker compose up -d` (of in Portainer: Stacks). Gegevensmappen (`data/`, volumes) staan niet in git;
ze zitten in de wekelijkse Proxmox-back-up van VM 103.
