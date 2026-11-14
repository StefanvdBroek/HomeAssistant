"""Bouwt de klantkaarten voor het dashboard "Klantkaarten".

Bronnen (beide toe te voegen via de Home Assistant-app):
  1. De takenlijst "Klantkaarten": titel = winkel, beschrijving = kaartnummer.
     Een 13-cijferig EAN-nummer wordt een EAN-13-barcode, al het andere Code 128.
     Begint de beschrijving met "qr:" dan wordt het een QR-code van de rest.
     Beschrijving "foto: <bestandsnaam>" koppelt een geüploade foto aan deze winkel.
  2. Foto's in Media > My media > klantkaarten: bestandsnaam = winkel. Foto's met een
     automatische naam (image.jpg, IMG_1234.HEIC, ...) heten "Nieuwe foto" tot ze gekoppeld zijn.

Gebruik (vanuit een automatisering): klantkaarten.py <base64 van de JSON-lijst met taken>
Schrijft de afbeeldingen naar /config/www/klantkaarten/ (onder moeilijk te raden namen,
want /local is zonder inloggen bereikbaar) en een overzicht naar /config/klantkaarten/index.json.
"""
import base64
import hashlib
import io
import json
import re
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

UIT = Path("/config/www/klantkaarten")
DATA = Path("/config/klantkaarten")
FOTOS = Path("/config/media/klantkaarten")
FOTO_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}
# Namen die de camera of telefoon zelf geeft; die zeggen niets over de winkel.
AUTOMATISCHE_NAAM = re.compile(r"^(image|img|photo|foto|pxl|dsc|screenshot|schermafbeelding)[\s_-]*[\d\s_.()-]*", re.I)

# --------------------------------------------------------------------- Code 128
# Breedtes (balk, ruimte, balk, ...) per waarde 0-106; elke code is 11 modules (stop 13).
CODE128 = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 "
    "122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 "
    "321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 "
    "211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 "
    "213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 "
    "121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 "
    "241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 "
    "412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 "
    "211214 211232 2331112"
).split()
START_B, START_C, STOP = 104, 105, 106


def code128_modules(tekst):
    """Geeft een lijst met 1 (zwart) en 0 (wit) modules."""
    if tekst.isdigit() and len(tekst) % 2 == 0 and len(tekst) >= 4:
        waarden = [START_C] + [int(tekst[i:i + 2]) for i in range(0, len(tekst), 2)]
    else:
        if any(not 32 <= ord(c) <= 126 for c in tekst):
            raise ValueError("Code 128 kan alleen gewone tekens (ASCII) bevatten")
        waarden = [START_B] + [ord(c) - 32 for c in tekst]
    controle = (waarden[0] + sum(i * w for i, w in enumerate(waarden[1:], start=1))) % 103
    waarden += [controle, STOP]
    modules = []
    for w in waarden:
        for i, breedte in enumerate(CODE128[w]):
            modules += [1 if i % 2 == 0 else 0] * int(breedte)
    return modules


# ----------------------------------------------------------------------- EAN-13
EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
         "0110001", "0101111", "0111011", "0110111", "0001011"]
EAN_R = ["".join("1" if b == "0" else "0" for b in c) for c in EAN_L]
EAN_G = [c[::-1] for c in EAN_R]
EAN_PARITEIT = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
                "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13_geldig(nummer):
    if not (len(nummer) == 13 and nummer.isdigit()):
        return False
    som = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(nummer[:12]))
    return (10 - som % 10) % 10 == int(nummer[12])


def ean13_modules(nummer):
    bits = "101"
    for i, c in enumerate(nummer[1:7]):
        tabel = EAN_L if EAN_PARITEIT[int(nummer[0])][i] == "L" else EAN_G
        bits += tabel[int(c)]
    bits += "01010"
    bits += "".join(EAN_R[int(c)] for c in nummer[7:])
    bits += "101"
    return [int(b) for b in bits]


def barcode_svg(modules, onderschrift, module=3, hoogte=140, stilte=12):
    breedte = (len(modules) + 2 * stilte) * module
    balken, x = [], stilte * module
    i = 0
    while i < len(modules):  # aaneengesloten zwarte modules als één balk
        if modules[i]:
            j = i
            while j < len(modules) and modules[j]:
                j += 1
            balken.append(f'<rect x="{x + i * module}" y="10" width="{(j - i) * module}" height="{hoogte}"/>')
            i = j
        else:
            i += 1
    tekst = (onderschrift.replace("&", "&amp;").replace("<", "&lt;"))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {breedte} {hoogte + 44}" '
        f'width="{breedte}" height="{hoogte + 44}" shape-rendering="crispEdges">'
        f'<rect width="100%" height="100%" fill="#fff"/><g fill="#000">{"".join(balken)}</g>'
        f'<text x="{breedte / 2}" y="{hoogte + 36}" font-family="monospace" font-size="24" '
        f'text-anchor="middle" fill="#000">{tekst}</text></svg>'
    )


def qr_svg(inhoud):
    import segno
    buf = io.BytesIO()
    # make_qr: altijd een gewone QR-code; segno.make kiest bij korte inhoud een Micro QR,
    # en die kunnen veel kassascanners niet lezen.
    segno.make_qr(inhoud, error="m").save(buf, kind="svg", scale=10, border=4, dark="#000", light="#fff")
    return buf.getvalue().decode()


# ---------------------------------------------------------------------- opbouw
def geheim():
    pad = DATA / ".geheim"
    if not pad.exists():
        pad.write_text(secrets.token_hex(16))
    return pad.read_text().strip()


def bestandsnaam(sleutel, *delen):
    return hashlib.sha256("|".join((sleutel,) + delen).encode()).hexdigest()[:24]


def maak_barcode(naam, beschrijving):
    """Geeft (soort, svg, nummer) of een fout."""
    tekst = (beschrijving or "").strip()
    if tekst.lower().startswith("qr:"):
        inhoud = tekst[3:].strip()
        return "QR-code", qr_svg(inhoud), inhoud
    compact = re.sub(r"[\s.-]", "", tekst)
    nummer = compact if compact.isdigit() else tekst
    if ean13_geldig(nummer):
        return "EAN-13", barcode_svg(ean13_modules(nummer), nummer), nummer
    return "Code 128", barcode_svg(code128_modules(nummer), nummer), nummer


def maak_foto(pad, doel):
    from PIL import Image, ImageOps
    with Image.open(pad) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((1400, 1400))
        img.save(doel, "JPEG", quality=88)


# ----------------------------------------------------------------- offline app
# Een kleine webapp (PWA) met alle kaarten, die op het beginscherm van de telefoon gezet kan
# worden en via een service worker ook zonder verbinding werkt. Staat onder een moeilijk te
# raden map in /local/klantkaarten/, want /local is zonder inloggen bereikbaar.
APP_HTML = """<!doctype html>
<html lang="nl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Klantkaarten">
<meta name="theme-color" content="#1f6feb">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icoon-180.png">
<title>Klantkaarten</title>
<style>
  :root { color-scheme: light dark; --bg:#f2f3f5; --kaart:#fff; --tekst:#111; --zacht:#666; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111; --kaart:#1c1c1e; --tekst:#eee; --zacht:#999; } }
  body { margin:0; font-family:-apple-system,system-ui,sans-serif; background:var(--bg); color:var(--tekst);
         padding: env(safe-area-inset-top) 16px calc(24px + env(safe-area-inset-bottom)); }
  h1 { font-size:28px; margin:18px 4px 12px; }
  .lijst { display:grid; gap:10px; }
  button.kaart { all:unset; display:flex; justify-content:space-between; align-items:center; background:var(--kaart);
         border-radius:14px; padding:16px 18px; font-size:18px; font-weight:600; cursor:pointer; }
  button.kaart span { color:var(--zacht); font-size:14px; font-weight:400; }
  .groot { position:fixed; inset:0; background:#fff; color:#000; display:none; flex-direction:column;
         align-items:center; justify-content:center; padding:24px; box-sizing:border-box; }
  .groot.open { display:flex; }
  .groot h2 { margin:0 0 20px; font-size:24px; }
  .groot img { width:100%; max-width:640px; max-height:60vh; object-fit:contain; }
  .groot img.qr { max-width:320px; }
  .groot p { color:#555; font-size:14px; margin-top:24px; }
  .status { color:var(--zacht); font-size:13px; margin:18px 4px; }
</style></head>
<body>
<h1>Klantkaarten</h1>
<div class="lijst" id="lijst"></div>
<div class="status" id="status"></div>
<div class="groot" id="groot"><h2 id="g-naam"></h2><img id="g-beeld" alt=""><p>Tik om terug te gaan</p></div>
<script>
const KAARTEN = __KAARTEN__;
const BIJGEWERKT = "__BIJGEWERKT__";
const lijst = document.getElementById("lijst"), groot = document.getElementById("groot");
for (const k of KAARTEN) {
  const b = document.createElement("button"); b.className = "kaart";
  b.innerHTML = `${k.naam.replace(/</g,"&lt;")}<span>${k.soort || "foto"}</span>`;
  b.onclick = () => {
    document.getElementById("g-naam").textContent = k.naam;
    const img = document.getElementById("g-beeld"); img.src = k.beeld; img.className = k.soort === "QR-code" ? "qr" : "";
    groot.classList.add("open");
  };
  lijst.appendChild(b);
}
if (!KAARTEN.length) lijst.textContent = "Nog geen klantkaarten.";
groot.onclick = () => groot.classList.remove("open");
document.getElementById("status").textContent =
  "Bijgewerkt: " + new Date(BIJGEWERKT).toLocaleString("nl-NL", {dateStyle:"medium", timeStyle:"short"})
  + (navigator.onLine ? "" : " · offline");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
</script>
</body></html>
"""

APP_SW = """// Service worker: bewaart de app en alle kaartafbeeldingen op de telefoon.
const VERSIE = "__VERSIE__";
const BESTANDEN = __BESTANDEN__;
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSIE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const pagina = e.request.mode === "navigate" || url.pathname.endsWith("/index.html");
  if (pagina) {
    // Eerst online kijken (nieuwe kaarten), anders de bewaarde versie.
    e.respondWith(fetch(e.request).then((r) => {
      const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request, kopie)); return r;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then((r) => r || caches.match("index.html"))));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
"""


def maak_icoon(pad, grootte):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (grootte, grootte), "#1f6feb")
    d = ImageDraw.Draw(img)
    m = grootte // 6
    d.rounded_rectangle((m, grootte // 4, grootte - m, grootte * 3 // 4), radius=grootte // 14, fill="#ffffff")
    x, breedtes = m + grootte // 12, [1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 1, 3]
    for i, b in enumerate(breedtes):
        w = b * grootte // 90
        if i % 2 == 0:
            d.rectangle((x, grootte // 3, x + w, grootte * 2 // 3), fill="#111111")
        x += w + grootte // 90
    img.save(pad, "PNG")


def maak_app(sleutel, lijst, bijgewerkt):
    """Schrijft de offline app naar /config/www/klantkaarten/<geheime map>/ en geeft het pad terug."""
    map_ = UIT / ("app-" + bestandsnaam(sleutel, "app"))
    map_.mkdir(exist_ok=True)
    kaarten = [{"naam": k["naam"], "soort": k.get("soort"),
                "beeld": "../" + (k.get("barcode") or k.get("foto")).rsplit("/", 1)[-1]}
               for k in lijst if k.get("barcode") or k.get("foto")]
    versie = hashlib.sha256(json.dumps(kaarten, sort_keys=True).encode()).hexdigest()[:12]
    (map_ / "index.html").write_text(
        APP_HTML.replace("__KAARTEN__", json.dumps(kaarten, ensure_ascii=False).replace("</", "<\\/"))
                .replace("__BIJGEWERKT__", bijgewerkt))
    # Geen "./": Home Assistant geeft voor een map 403, dus altijd index.html.
    bestanden = ["index.html", "manifest.webmanifest", "icoon-180.png", "icoon-512.png"] + \
                [k["beeld"] for k in kaarten]
    (map_ / "sw.js").write_text(APP_SW.replace("__VERSIE__", "klantkaarten-" + versie)
                                .replace("__BESTANDEN__", json.dumps(bestanden)))
    (map_ / "manifest.webmanifest").write_text(json.dumps({
        "name": "Klantkaarten", "short_name": "Klantkaarten", "start_url": "index.html", "scope": "./",
        "display": "standalone", "background_color": "#f2f3f5", "theme_color": "#1f6feb",
        "icons": [{"src": "icoon-180.png", "sizes": "180x180", "type": "image/png"},
                  {"src": "icoon-512.png", "sizes": "512x512", "type": "image/png"}]}, ensure_ascii=False))
    for grootte in (180, 512):
        icoon = map_ / f"icoon-{grootte}.png"
        if not icoon.exists():
            maak_icoon(icoon, grootte)
    return f"/local/klantkaarten/{map_.name}/index.html"


def main():
    taken = json.loads(base64.b64decode(sys.argv[1])) if len(sys.argv) > 1 else []
    for map_ in (UIT, DATA, FOTOS):
        map_.mkdir(parents=True, exist_ok=True)
    sleutel = geheim()

    kaarten, gebruikt = {}, set()
    koppelingen = {}  # bestandsnaam (kleine letters) -> winkel

    for taak in taken:
        naam = (taak.get("summary") or "").strip()
        beschrijving = (taak.get("description") or "").strip()
        if not naam:
            continue
        kaart = kaarten.setdefault(naam.lower(), {"naam": naam})
        if beschrijving.lower().startswith("foto:"):
            koppelingen[beschrijving[5:].strip().lower()] = naam
            continue
        if not (taak.get("description") or "").strip():
            kaart["melding"] = "Nog geen kaartnummer: zet het in de beschrijving van de taak."
            continue
        try:
            soort, svg, nummer = maak_barcode(naam, taak["description"])
        except Exception as fout:  # pylint: disable=broad-except
            kaart["melding"] = f"Kan geen barcode maken: {fout}"
            continue
        bestand = bestandsnaam(sleutel, "code-v2", naam, taak["description"]) + ".svg"
        doel = UIT / bestand
        if not doel.exists():
            doel.write_text(svg)
        gebruikt.add(bestand)
        kaart.update({"soort": soort, "nummer": nummer, "barcode": f"/local/klantkaarten/{bestand}"})

    for foto in sorted(FOTOS.iterdir()):
        if foto.suffix.lower() not in FOTO_TYPES or foto.name.startswith("."):
            continue
        gekoppeld = koppelingen.get(foto.name.lower()) or koppelingen.get(foto.stem.lower())
        if gekoppeld:
            naam = gekoppeld
        elif AUTOMATISCHE_NAAM.fullmatch(foto.stem):
            naam = f"Nieuwe foto ({foto.name})"
        else:
            naam = foto.stem.strip()
        kaart = kaarten.setdefault(naam.lower(), {"naam": naam})
        if naam.startswith("Nieuwe foto"):
            kaart["melding"] = (f"Geef deze foto een naam: voeg in de lijst een kaart toe met de winkel "
                                f"als titel en als beschrijving: foto: {foto.name}")
        stat = foto.stat()
        bestand = bestandsnaam(sleutel, "foto", foto.name, str(stat.st_size), str(int(stat.st_mtime))) + ".jpg"
        doel = UIT / bestand
        try:
            if not doel.exists():
                maak_foto(foto, doel)
        except Exception:  # pylint: disable=broad-except
            kaart["melding"] = f"Foto {foto.name} kan niet worden gelezen; upload hem als JPG of PNG."
            continue
        gebruikt.add(bestand)
        kaart["foto"] = f"/local/klantkaarten/{bestand}"

    for oud in UIT.iterdir():  # verwijderde of gewijzigde kaarten opruimen
        if oud.is_file() and oud.name not in gebruikt:
            oud.unlink()

    lijst = sorted(kaarten.values(), key=lambda k: k["naam"].lower())
    bijgewerkt = datetime.now(timezone.utc).isoformat()
    app = maak_app(sleutel, lijst, bijgewerkt)
    (DATA / "index.json").write_text(json.dumps(
        {"aantal": len(lijst), "bijgewerkt": bijgewerkt, "app": app, "kaarten": lijst},
        ensure_ascii=False))
    print(f"{len(lijst)} klantkaarten")


if __name__ == "__main__":
    main()
