"""Haalt de laatste berichten van gamequarter.be op (de site heeft geen RSS-feed).

Leest de lijst "Laatste" op de homepage en print JSON voor de command_line-sensor
in packages/gamequarter.yaml: {"laatste": <titel>, "berichten": [{titel, soort, tijd, url, afbeelding}, ...]}.
Draait in de Home Assistant-container (bevat requests en BeautifulSoup).
"""
import json
import sys
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASIS = "https://www.gamequarter.be/"
AANTAL = 8
HEADERS = {"User-Agent": "Mozilla/5.0 (HomeAssistant; dashboard)"}


def titel_uit_artikel(url):
    """Sommige titels laadt de homepage pas later; haal ze dan uit het artikel zelf."""
    try:
        pagina = BeautifulSoup(requests.get(url, headers=HEADERS, timeout=10).text, "html.parser")
        meta = pagina.select_one('meta[property="og:title"]')
        if meta and meta.get("content"):
            return meta["content"].split(" | ")[0].strip()
    except requests.RequestException:
        pass
    slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
    return slug.replace("-", " ").capitalize()


def afbeelding(img):
    if not img or not img.get("src"):
        return None
    src = img["src"]
    if src.startswith("/_next/image"):  # Next.js-proxy: de echte url staat in ?url=
        src = parse_qs(urlparse(src).query).get("url", [src])[0]
    return urljoin(BASIS, src)


def main():
    html = requests.get(BASIS, headers=HEADERS, timeout=15).text
    soup = BeautifulSoup(html, "html.parser")
    berichten = []
    for a in soup.select("a:has(> time.feed-time)")[:AANTAL]:
        url = urljoin(BASIS, a["href"])
        titel_el = a.select_one("span.flex-1")
        soort_el = a.select_one(".gq-badge")
        titel = titel_el.get_text(strip=True) if titel_el else ""
        berichten.append({
            "titel": titel or titel_uit_artikel(url),
            "soort": soort_el.get_text(strip=True) if soort_el else "",
            "tijd": a.select_one("time.feed-time")["datetime"],
            "url": url,
            "afbeelding": afbeelding(a.select_one("img")),
        })
    if not berichten:
        sys.exit("geen berichten gevonden; is de opbouw van de site veranderd?")
    print(json.dumps({"laatste": berichten[0]["titel"][:250], "berichten": berichten}, ensure_ascii=False))


if __name__ == "__main__":
    main()
