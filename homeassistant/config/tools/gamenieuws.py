"""Haalt het laatste internationale gamenieuws op uit een paar grote RSS-feeds.

Voegt de feeds samen, sorteert op tijd en print JSON voor de command_line-sensor
in packages/gamenieuws.yaml: {"laatste": <titel>, "berichten": [{titel, bron, tijd, url, afbeelding}, ...]}.
Draait in de Home Assistant-container (bevat feedparser).
"""
import calendar
import json
import sys
from datetime import datetime, timezone

import feedparser

FEEDS = {
    "IGN": "https://feeds.feedburner.com/ign/all",
    "Eurogamer": "https://www.eurogamer.net/feed",
    "GameSpot": "https://www.gamespot.com/feeds/news/",
    "PC Gamer": "https://www.pcgamer.com/rss/",
}
AANTAL = 10
PER_BRON = 5  # zodat niet één site de hele lijst vult
AGENT = "Mozilla/5.0 (HomeAssistant; dashboard)"


def afbeelding(e):
    for veld in ("media_thumbnail", "media_content"):
        if e.get(veld) and e[veld][0].get("url"):
            return e[veld][0]["url"]
    for link in e.get("links", []):
        if link.get("type", "").startswith("image") and link.get("href"):
            return link["href"]
    return None


def main():
    berichten = []
    for bron, url in FEEDS.items():
        feed = feedparser.parse(url, agent=AGENT)
        for e in feed.entries[:PER_BRON]:
            tijd = e.get("published_parsed") or e.get("updated_parsed")
            if not tijd or not e.get("title") or not e.get("link"):
                continue
            berichten.append({
                "titel": e.title.strip(),
                "bron": bron,
                "tijd": datetime.fromtimestamp(calendar.timegm(tijd), timezone.utc).isoformat(),
                "url": e.link,
                "afbeelding": afbeelding(e),
            })
    if not berichten:
        sys.exit("geen berichten gevonden in de feeds")
    berichten.sort(key=lambda b: b["tijd"], reverse=True)
    berichten = berichten[:AANTAL]
    print(json.dumps({"laatste": berichten[0]["titel"][:250], "berichten": berichten}, ensure_ascii=False))


if __name__ == "__main__":
    main()
