"""Airco-schema: eenvoudige tijdsblokken per airco.

Een tijdsblok = dagen + begintijd + eindtijd + modus + temperatuur + ventilatorstand.
Aan het begin gaat de airco aan met die instellingen, aan het eind weer uit. Loopt een blok over
middernacht (eind vóór begin), dan valt het eind op de dag erna.

De blokken staan in .storage/airco_schema (niet in git, wel in de back-ups) en worden beheerd
met de kaart www/airco-schema-card.js op het dashboard "Airco's". De kaart leest
sensor.airco_schema en gebruikt de acties hieronder; die werken voor elke ingelogde gebruiker.

configuration.yaml:
  airco_schema:
    woonkamer: climate.living_room_woonkamer_air_conditioning
    zolder: climate.zolder_zolder_air_conditioning_air_care
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
import homeassistant.util.dt as dt_util

DOMAIN = "airco_schema"
SENSOR = "sensor.airco_schema"
_LOGGER = logging.getLogger(__name__)

MODI = ["heat", "cool", "auto", "dry", "fan_only"]
MET_TEMPERATUUR = {"heat", "cool", "auto"}
MODUS_NL = {"heat": "verwarmen", "cool": "koelen", "auto": "automatisch", "dry": "drogen",
            "fan_only": "ventilator"}
TIJD = vol.All(cv.string, vol.Match(r"^([01]\d|2[0-3]):[0-5]\d$"))

CONFIG_SCHEMA = vol.Schema({DOMAIN: {cv.slug: cv.entity_id}}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    aircos: dict[str, str] = config[DOMAIN]
    store = Store(hass, 1, DOMAIN)
    data = await store.async_load() or {}
    data.setdefault("aircos", {})
    for naam in aircos:
        data["aircos"].setdefault(naam, {"aan": True, "regels": []})

    @callback
    def publiceer() -> None:
        """Toestand voor de kaart: alle blokken per airco."""
        totaal = sum(len(a["regels"]) for a in data["aircos"].values() if a)
        hass.states.async_set(SENSOR, totaal, {
            "friendly_name": "Airco-schema", "icon": "mdi:calendar-clock",
            "aircos": {n: {**data["aircos"][n], "klimaat": aircos[n]} for n in aircos},
        })

    async def bewaar() -> None:
        await store.async_save(data)
        publiceer()

    def airco_data(naam: str) -> dict:
        if naam not in aircos:
            raise vol.Invalid(f"Onbekende airco: {naam}")
        return data["aircos"][naam]

    # ------------------------------------------------------------- acties
    async def blok_opslaan(call: ServiceCall) -> None:
        a = airco_data(call.data["airco"])
        if call.data["begin"] == call.data["eind"]:
            raise vol.Invalid("Begin- en eindtijd zijn gelijk")
        blok = {
            "id": call.data.get("id") or uuid.uuid4().hex[:8],
            "dagen": sorted(set(call.data["dagen"])),
            "begin": call.data["begin"],
            "eind": call.data["eind"],
            "modus": call.data["modus"],
            "temperatuur": call.data.get("temperatuur"),
            "ventilator": call.data.get("ventilator"),
            "actief": call.data.get("actief", True),
        }
        a["regels"] = [r for r in a["regels"] if r["id"] != blok["id"]] + [blok]
        a["regels"].sort(key=lambda r: (min(r["dagen"]), r["begin"]))
        await bewaar()

    async def blok_verwijderen(call: ServiceCall) -> None:
        a = airco_data(call.data["airco"])
        a["regels"] = [r for r in a["regels"] if r["id"] != call.data["id"]]
        await bewaar()

    async def aan_uit(call: ServiceCall) -> None:
        airco_data(call.data["airco"])["aan"] = call.data["aan"]
        await bewaar()

    hass.services.async_register(DOMAIN, "blok_opslaan", blok_opslaan, vol.Schema({
        vol.Required("airco"): cv.string,
        vol.Optional("id"): cv.string,
        vol.Required("dagen"): vol.All(cv.ensure_list, [vol.All(vol.Coerce(int), vol.Range(0, 6))],
                                       vol.Length(min=1)),
        vol.Required("begin"): TIJD,
        vol.Required("eind"): TIJD,
        vol.Required("modus"): vol.In(MODI),
        vol.Optional("temperatuur"): vol.Any(None, vol.Coerce(float)),
        vol.Optional("ventilator"): vol.Any(None, cv.string),
        vol.Optional("actief", default=True): cv.boolean,
    }))
    hass.services.async_register(DOMAIN, "blok_verwijderen", blok_verwijderen, vol.Schema({
        vol.Required("airco"): cv.string, vol.Required("id"): cv.string}))
    hass.services.async_register(DOMAIN, "aan_uit", aan_uit, vol.Schema({
        vol.Required("airco"): cv.string, vol.Required("aan"): cv.boolean}))

    # -------------------------------------------------------------- timer
    async def aanzetten(naam: str, blok: dict) -> None:
        klimaat = aircos[naam]
        doel = {"entity_id": klimaat}
        await hass.services.async_call("climate", "set_hvac_mode",
                                       {**doel, "hvac_mode": blok["modus"]}, blocking=True)
        if blok["modus"] in MET_TEMPERATUUR and blok.get("temperatuur"):
            await hass.services.async_call("climate", "set_temperature",
                                           {**doel, "temperature": blok["temperatuur"]}, blocking=True)
        if blok.get("ventilator"):
            await hass.services.async_call("climate", "set_fan_mode",
                                           {**doel, "fan_mode": blok["ventilator"]}, blocking=True)
        temp = f", {blok['temperatuur']:g} °C" if blok["modus"] in MET_TEMPERATUUR and blok.get("temperatuur") else ""
        await logboek(naam, f"aangezet volgens schema: {MODUS_NL[blok['modus']]}{temp}"
                            f"{', ventilator ' + blok['ventilator'] if blok.get('ventilator') else ''}")

    async def uitzetten(naam: str) -> None:
        await hass.services.async_call("climate", "turn_off", {"entity_id": aircos[naam]}, blocking=True)
        await logboek(naam, "uitgezet volgens schema")

    async def logboek(naam: str, tekst: str) -> None:
        await hass.services.async_call("logbook", "log", {"name": f"Airco {naam}", "message": tekst})

    async def elke_minuut(nu: datetime) -> None:
        nu = dt_util.as_local(nu)
        tijd, dag = nu.strftime("%H:%M"), nu.weekday()
        for naam in aircos:
            a = data["aircos"][naam]
            if not a.get("aan"):
                continue
            regels = [r for r in a["regels"] if r.get("actief", True)]
            # Eerst uit, dan aan: sluit een blok aan op een ander, dan blijft hij aan.
            eind_nu = [r for r in regels if r["eind"] == tijd and (
                (r["eind"] > r["begin"] and dag in r["dagen"])
                or (r["eind"] < r["begin"] and (dag - 1) % 7 in r["dagen"]))]
            begin_nu = [r for r in regels if r["begin"] == tijd and dag in r["dagen"]]
            try:
                if eind_nu and not begin_nu:
                    await uitzetten(naam)
                for blok in begin_nu:
                    await aanzetten(naam, blok)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Airco %s schakelen volgens schema mislukt", naam)

    async_track_time_change(hass, elke_minuut, second=0)
    publiceer()
    return True
