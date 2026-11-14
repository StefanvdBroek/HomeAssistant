"""Kleine helper om Home Assistant-websocketcommando's uit te voeren.

Draai in de container:  docker exec -i homeassistant python3 - < scripts/ha/ws.py '<json-lijst met commando's>'
Leest de token uit /config/.ha_token. Elk commando is een dict zonder "id"; het resultaat
van elk commando wordt als JSON-regel geprint.
"""
import asyncio, json, sys
import aiohttp

async def main(cmds):
    token = open("/config/.ha_token").read().strip()
    async with aiohttp.ClientSession() as s, s.ws_connect("http://localhost:8123/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": token})
        if (await ws.receive_json()).get("type") != "auth_ok":
            sys.exit("auth mislukt")
        for i, c in enumerate(cmds, start=1):
            await ws.send_json({"id": i, **c})
            while True:
                m = await ws.receive_json()
                if m.get("id") == i and m.get("type") == "result":
                    print(json.dumps({"cmd": c["type"], "success": m["success"], "result": m.get("result"), "error": m.get("error")}, ensure_ascii=False))
                    break

asyncio.run(main(json.loads(sys.argv[1])))
