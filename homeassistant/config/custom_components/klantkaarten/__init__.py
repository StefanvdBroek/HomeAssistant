"""Klantkaarten: een klantkaart toevoegen met een foto van de telefoon.

De foto wordt gelezen met zbar (pyzbar): staat er een barcode of QR-code op, dan wordt dat een
kaart in de lijst todo.klantkaarten (titel = winkel, beschrijving = nummer of "qr: <inhoud>")
en wordt de foto niet bewaard. tools/klantkaarten.py maakt er daarna een scherpe barcode van.
Lukt het lezen niet, dan blijft de foto bewaard in /config/media/klantkaarten/<winkel>.<ext>.

Home Assistant laat alleen beheerders uploaden naar Media; dit endpoint werkt voor elke
ingelogde gebruiker. Gebruikt door de kaart www/klantkaart-camera-card.js.

Actie klantkaarten.fotos_omzetten: probeert de barcode te lezen uit alle foto's die al in
/config/media/klantkaarten staan en zet ze om naar kaarten.

Inschakelen in configuration.yaml met:  klantkaarten:
"""
from __future__ import annotations

import ctypes
import io
import logging
import re
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers.typing import ConfigType

DOMAIN = "klantkaarten"
LIJST = "todo.klantkaarten"
_LOGGER = logging.getLogger(__name__)

MAX_GROOTTE = 20 * 1024 * 1024
TOEGESTAAN = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
              "image/heic": ".heic", "image/heif": ".heif", "image/gif": ".gif"}
FOTO_TYPES = set(TOEGESTAAN.values()) | {".jpeg"}


def veilige_naam(naam: str) -> str:
    """Winkelnaam als bestandsnaam: geen mappen, geen rare tekens."""
    naam = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", naam)
    naam = re.sub(r"\s+", " ", naam).strip(" .")
    return naam[:60]


# ----------------------------------------------------------------- barcode lezen
_zbar = None


def _pyzbar():
    """pyzbar met de libzbar uit het Home Assistant-image (Alpine vindt hem niet altijd zelf)."""
    global _zbar  # noqa: PLW0603
    if _zbar is None:
        from pyzbar import zbar_library  # pylint: disable=import-outside-toplevel
        try:
            zbar_library.load()
        except ImportError:
            lib = ctypes.CDLL("libzbar.so.0")
            zbar_library.load = lambda: (lib, [])
        from pyzbar import pyzbar  # pylint: disable=import-outside-toplevel
        _zbar = pyzbar
    return _zbar


def lees_code(data: bytes) -> tuple[str, str] | None:
    """Geeft (soort, waarde) van de grootste barcode/QR-code op de foto, of None."""
    from PIL import Image, ImageOps  # pylint: disable=import-outside-toplevel

    pyzbar = _pyzbar()
    beeld = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("L")
    if max(beeld.size) > 2400:
        beeld.thumbnail((2400, 2400))

    def pogingen():
        yield beeld
        if max(beeld.size) < 1600:  # kleine of vage codes: ook vergroot proberen
            yield beeld.resize((beeld.width * 2, beeld.height * 2))
        # Op een schermafbeelding raakt zbar in de war door alles rond de code: zoek daarom
        # ook in overlappende stroken (zo groot als ~1/4 van de hoogte), met een witte rand.
        # Zwart-wit maakt gekleurde randen (blauw, oranje) wit; smallere stroken laten
        # logo's en tekst naast de code weg.
        zwartwit = beeld.point(lambda p: 255 if p > 128 else 0)
        hoogte = max(beeld.height // 4, 200)
        for boven in range(0, max(beeld.height - hoogte, 0) + 1, max(hoogte // 3, 1)):
            onder = min(boven + hoogte, beeld.height)
            for links, rechts in ((0, 1), (0.08, 0.92), (0.12, 0.82)):
                vak = (int(beeld.width * links), boven, int(beeld.width * rechts), onder)
                for bron in (beeld, zwartwit):
                    yield ImageOps.expand(bron.crop(vak), border=40, fill=255)

    for poging in pogingen():
        codes = [c for c in pyzbar.decode(poging) if c.data]
        if codes:
            code = max(codes, key=lambda c: c.rect.width * c.rect.height)
            waarde = code.data.decode("utf-8", errors="replace").strip()
            if code.type == "QRCODE":
                return "QR-code", f"qr: {waarde}"
            return code.type, waarde
    return None


async def kaart_opslaan(hass: HomeAssistant, naam: str, beschrijving: str) -> None:
    """Kaart in de lijst zetten; bestaat de winkel al, dan het nummer bijwerken."""
    antwoord = await hass.services.async_call(
        "todo", "get_items", {"status": ["needs_action", "completed"]},
        target={"entity_id": LIJST}, blocking=True, return_response=True)
    bestaand = [i for i in antwoord[LIJST]["items"] if i["summary"].lower() == naam.lower()]
    if bestaand:
        await hass.services.async_call(
            "todo", "update_item", {"item": bestaand[0]["uid"], "description": beschrijving},
            target={"entity_id": LIJST}, blocking=True)
    else:
        await hass.services.async_call(
            "todo", "add_item", {"item": naam, "description": beschrijving},
            target={"entity_id": LIJST}, blocking=True)


def bijwerken(hass: HomeAssistant) -> None:
    if hass.services.has_service("script", "klantkaarten_bijwerken"):
        hass.async_create_task(
            hass.services.async_call("script", "klantkaarten_bijwerken", blocking=False))


# ------------------------------------------------------------------------ setup
async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    map_ = Path(hass.config.path("media", "klantkaarten"))
    await hass.async_add_executor_job(lambda: map_.mkdir(parents=True, exist_ok=True))
    hass.http.register_view(KlantkaartUploadView(map_))

    async def fotos_omzetten(call: ServiceCall) -> ServiceResponse:
        omgezet, niet_gelezen = [], []
        fotos = await hass.async_add_executor_job(
            lambda: [f for f in sorted(map_.iterdir()) if f.suffix.lower() in FOTO_TYPES])
        for foto in fotos:
            try:
                inhoud = await hass.async_add_executor_job(foto.read_bytes)
                gevonden = await hass.async_add_executor_job(lees_code, inhoud)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Kan %s niet lezen", foto.name)
                gevonden = None
            if gevonden is None:
                niet_gelezen.append(foto.stem)
                continue
            await kaart_opslaan(hass, foto.stem, gevonden[1])
            await hass.async_add_executor_job(foto.unlink)
            omgezet.append({"naam": foto.stem, "soort": gevonden[0]})
        bijwerken(hass)
        return {"omgezet": omgezet, "niet_gelezen": niet_gelezen}

    hass.services.async_register(DOMAIN, "fotos_omzetten", fotos_omzetten,
                                 supports_response=SupportsResponse.OPTIONAL)

    async def items_met_naam(naam: str) -> list[dict]:
        antwoord = await hass.services.async_call(
            "todo", "get_items", {"status": ["needs_action", "completed"]},
            target={"entity_id": LIJST}, blocking=True, return_response=True)
        return [i for i in antwoord[LIJST]["items"] if i["summary"].strip().lower() == naam.lower()]

    def fotos_van(naam: str) -> list[Path]:
        return [f for f in map_.glob(f"{glob_escape(naam)}.*") if f.suffix.lower() in FOTO_TYPES]

    async def wijzigen(call: ServiceCall) -> None:
        """Naam en/of nummer van een kaart aanpassen (ook een kaart die nog een foto is)."""
        naam = call.data["naam"].strip()
        nieuw = veilige_naam(call.data.get("nieuwe_naam") or naam) or naam
        nummer = (call.data.get("nummer") or "").strip()
        items = await items_met_naam(naam)
        if nummer:
            if items:
                await hass.services.async_call(
                    "todo", "update_item",
                    {"item": items[0]["uid"], "rename": nieuw, "description": nummer},
                    target={"entity_id": LIJST}, blocking=True)
            else:
                await kaart_opslaan(hass, nieuw, nummer)
            # Er is nu een nummer: een eventuele foto van deze kaart is niet meer nodig.
            await hass.async_add_executor_job(
                lambda: [f.unlink() for f in fotos_van(naam) + (fotos_van(nieuw) if nieuw != naam else [])])
        else:
            if items and nieuw != naam:
                await hass.services.async_call(
                    "todo", "update_item", {"item": items[0]["uid"], "rename": nieuw},
                    target={"entity_id": LIJST}, blocking=True)
            if nieuw != naam:  # foto meeverhuizen naar de nieuwe naam
                await hass.async_add_executor_job(
                    lambda: [f.rename(f.with_name(nieuw + f.suffix)) for f in fotos_van(naam)])
        _LOGGER.info("Klantkaart '%s' gewijzigd", naam)
        bijwerken(hass)

    async def verwijderen(call: ServiceCall) -> None:
        """Kaart weghalen: uit de lijst en de eventuele foto."""
        naam = call.data["naam"].strip()
        for item in await items_met_naam(naam):
            await hass.services.async_call(
                "todo", "remove_item", {"item": item["uid"]},
                target={"entity_id": LIJST}, blocking=True)
        await hass.async_add_executor_job(lambda: [f.unlink() for f in fotos_van(naam)])
        _LOGGER.info("Klantkaart '%s' verwijderd", naam)
        bijwerken(hass)

    hass.services.async_register(DOMAIN, "wijzigen", wijzigen)
    hass.services.async_register(DOMAIN, "verwijderen", verwijderen)
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
        inhoud = foto.file.read()
        gebruiker = request["hass_user"].name

        # 1. Barcode of QR-code op de foto? Dan wordt dat de kaart en bewaren we de foto niet.
        try:
            gevonden = await hass.async_add_executor_job(lees_code, inhoud)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Barcode lezen mislukt")
            gevonden = None
        if gevonden:
            await kaart_opslaan(hass, naam, gevonden[1])
            await hass.async_add_executor_job(self._verwijder_fotos, naam)
            _LOGGER.info("Klantkaart '%s' (%s) toegevoegd door %s", naam, gevonden[0], gebruiker)
            bijwerken(hass)
            return self.json({"naam": naam, "gelezen": True, "soort": gevonden[0]})

        # 2. Niets gevonden: de foto zelf bewaren.
        doel = self.map / f"{naam}{extensie}"

        def opslaan() -> None:
            self._verwijder_fotos(naam)
            doel.write_bytes(inhoud)

        await hass.async_add_executor_job(opslaan)
        _LOGGER.info("Foto van klantkaart '%s' opgeslagen door %s", naam, gebruiker)
        bijwerken(hass)
        return self.json({"naam": naam, "gelezen": False, "bestand": doel.name})

    def _verwijder_fotos(self, naam: str) -> None:
        """Eerdere foto('s) van dezelfde winkel weghalen."""
        for oud in self.map.glob(f"{glob_escape(naam)}.*"):
            oud.unlink()


def glob_escape(tekst: str) -> str:
    return re.sub(r"([*?\[\]])", r"[\1]", tekst)
