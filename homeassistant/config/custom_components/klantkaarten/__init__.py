"""Klantkaarten: foto van een klantkaart opslaan vanaf de telefoon.

Home Assistant laat alleen beheerders uploaden naar Media. Deze integratie voegt één endpoint
toe waarmee elke ingelogde gebruiker een foto van een klantkaart kan opslaan in
/config/media/klantkaarten/<winkel>.<ext>. Het dashboard "Klantkaarten" gebruikt het via de kaart
www/klantkaart-camera-card.js; tools/klantkaarten.py maakt er daarna een kaart van.

Inschakelen in configuration.yaml met:  klantkaarten:
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

DOMAIN = "klantkaarten"
_LOGGER = logging.getLogger(__name__)

MAX_GROOTTE = 20 * 1024 * 1024
TOEGESTAAN = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
              "image/heic": ".heic", "image/heif": ".heif", "image/gif": ".gif"}


def veilige_naam(naam: str) -> str:
    """Winkelnaam als bestandsnaam: geen mappen, geen rare tekens."""
    naam = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", naam)
    naam = re.sub(r"\s+", " ", naam).strip(" .")
    return naam[:60]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    map_ = Path(hass.config.path("media", "klantkaarten"))
    await hass.async_add_executor_job(lambda: map_.mkdir(parents=True, exist_ok=True))
    hass.http.register_view(KlantkaartUploadView(map_))
    return True


class KlantkaartUploadView(HomeAssistantView):
    """POST /api/klantkaarten/upload  (multipart: naam, foto) – voor elke ingelogde gebruiker."""

    url = "/api/klantkaarten/upload"
    name = "api:klantkaarten:upload"
    requires_auth = True

    def __init__(self, map_: Path) -> None:
        self.map = map_

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        request._client_max_size = MAX_GROOTTE  # noqa: SLF001
        try:
            data = await request.post()
        except ValueError:
            return self.json_message("Foto is te groot (max. 20 MB)", 413)

        naam = veilige_naam(str(data.get("naam", "")))
        foto = data.get("foto")
        if not naam:
            return self.json_message("Vul de naam van de winkel in", 400)
        if foto is None or not hasattr(foto, "file"):
            return self.json_message("Geen foto ontvangen", 400)
        extensie = TOEGESTAAN.get((foto.content_type or "").lower())
        if extensie is None:
            return self.json_message("Alleen foto's (JPG, PNG, HEIC, WebP)", 415)

        doel = self.map / f"{naam}{extensie}"

        def opslaan() -> None:
            # Een eerdere foto van dezelfde winkel (andere extensie) vervangen.
            for oud in self.map.glob(f"{glob_escape(naam)}.*"):
                oud.unlink()
            with open(doel, "wb") as uit:
                uit.write(foto.file.read())

        await hass.async_add_executor_job(opslaan)
        gebruiker = request["hass_user"].name
        _LOGGER.info("Klantkaart '%s' opgeslagen door %s", naam, gebruiker)

        if hass.services.has_service("script", "klantkaarten_bijwerken"):
            hass.async_create_task(
                hass.services.async_call("script", "klantkaarten_bijwerken", blocking=False)
            )
        return self.json({"naam": naam, "bestand": doel.name})


def glob_escape(tekst: str) -> str:
    return re.sub(r"([*?\[\]])", r"[\1]", tekst)
