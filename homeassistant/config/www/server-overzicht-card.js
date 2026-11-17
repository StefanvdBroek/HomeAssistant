// Kaart "Server-overzicht": per server de status, CPU, geheugen, schijf en hoe lang hij aan staat.
// Breed scherm: een tabel. Smal scherm (telefoon): per server een blok met drie balkjes.
// Tikken op een regel opent de details van de status-entiteit; het pijltje opent de server zelf.
//
// Gebruik:
//   type: custom:server-overzicht-card
//   titel: Servers                       # optioneel
//   servers:
//     - naam: Proxmox
//       soort: Host                       # optioneel, kleine tekst onder de naam
//       icoon: mdi:server                 # optioneel
//       status: sensor.pve_status         # verplicht: online/running/on = in orde
//       cpu: sensor.pve_cpu_usage         # optioneel, in %
//       geheugen: sensor.pve_memory_usage_percentage   # optioneel, in %
//       schijf: sensor.storage_local_storage_usage_percentage  # optioneel, in %
//       schijf_gebruikt: sensor.x_disk_usage   # of: gebruikt + maximum, dan rekent de kaart het % uit
//       schijf_max: sensor.x_max_disk_usage
//       sinds: sensor.pve_uptime          # optioneel, tijdstempel; anders: laatste statuswijziging
//       url: https://192.168.2.23         # optioneel

// Alles wat in orde is heet "online" (Proxmox zegt "online" voor de host en "running" voor VM's/LXC's,
// Ping zegt "on", Uptime Kuma "up"); afwijkingen houden hun eigen woord.
const OK = ["on", "online", "running", "home", "up"];
const STATUS = { on: "online", online: "online", running: "online", up: "online", home: "online",
                 off: "offline", offline: "offline", down: "offline", stopped: "gestopt", paused: "gepauzeerd",
                 pending: "twijfel", maintenance: "onderhoud", unavailable: "onbekend", unknown: "onbekend" };
const GRENS = { cpu: [70, 90], geheugen: [80, 90], schijf: [70, 85] }; // oranje vanaf, rood vanaf

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const getal = (st) => (st && !["unknown", "unavailable", ""].includes(st.state) && !isNaN(parseFloat(st.state)))
  ? parseFloat(st.state) : null;

// "6 uur", "42 min", "3 dagen", "net"
function duur(vanaf) {
  const s = (Date.now() - vanaf.getTime()) / 1000;
  if (!isFinite(s) || s < 0) return "–";
  if (s < 60) return "net";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} uur`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "1 dag" : `${d} dagen`;
}

// ---------------------------------------------------------------------------------------------
// Inklappen: tik op de kop. De keuze wordt per kaart onthouden in het Home Assistant-profiel van
// de gebruiker (frontend/set_user_data: hetzelfde op al je apparaten) en in de browser
// (localStorage: meteen goed bij het openen, ook zonder verbinding). Sleutel per kaart: 'sleutel'
// uit de configuratie, anders de titel.
const OPSLAG = "server_dashboard_ingeklapt";
const leesLokaal = () => { try { return JSON.parse(localStorage.getItem(OPSLAG) || "{}") || {}; } catch (e) { return {}; } };
const schrijfLokaal = (v) => { try { localStorage.setItem(OPSLAG, JSON.stringify(v)); } catch (e) { /* privé-venster e.d. */ } };

class InklapKaart extends HTMLElement {
  get _inklapId() { return this._config.sleutel || this._config.titel || this.localName; }

  get _ingeklapt() {
    if (this._inklap === undefined) this._inklap = !!leesLokaal()[this._inklapId];
    return this._inklap;
  }

  // Eén keer per kaart: de keuze uit het profiel ophalen (kan afwijken als hij op een ander apparaat is gezet).
  _laadProfiel() {
    if (this._profielGeladen || !this._hass?.callWS) return;
    this._profielGeladen = true;
    this._hass.callWS({ type: "frontend/get_user_data", key: OPSLAG }).then((r) => {
      const v = r?.value;
      if (!v || typeof v !== "object" || !(this._inklapId in v)) return;
      schrijfLokaal({ ...leesLokaal(), ...v });
      if (!!v[this._inklapId] !== this._ingeklapt) { this._inklap = !!v[this._inklapId]; this._teken(); }
    }).catch(() => {});
  }

  async _wissel() {
    this._inklap = !this._ingeklapt;
    schrijfLokaal({ ...leesLokaal(), [this._inklapId]: this._inklap });
    this._teken();
    if (!this._hass?.callWS) return;
    try { // lezen en dan schrijven, zodat de keuze van de andere kaart blijft staan
      const r = await this._hass.callWS({ type: "frontend/get_user_data", key: OPSLAG });
      const v = (r?.value && typeof r.value === "object") ? r.value : {};
      await this._hass.callWS({ type: "frontend/set_user_data", key: OPSLAG, value: { ...v, [this._inklapId]: this._inklap } });
    } catch (e) { /* alleen lokaal onthouden */ }
  }

  _kop(titel, extra, samen) {
    const dicht = this._ingeklapt;
    return `
      <div class="kop klikbaar" role="button" tabindex="0" aria-expanded="${!dicht}" title="${dicht ? "Uitklappen" : "Inklappen"}">
        <span class="titel-kaart"><ha-icon class="pijl ${dicht ? "dicht" : ""}" icon="mdi:chevron-down"></ha-icon>${titel}${extra || ""}</span>
        ${samen}
      </div>`;
  }

  _koppelKop() {
    const kop = this.shadowRoot.querySelector(".kop.klikbaar");
    if (!kop) return;
    kop.addEventListener("click", (e) => { if (!e.target.closest("a")) this._wissel(); });
    kop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._wissel(); } });
  }
}

class ServerOverzichtCard extends InklapKaart {
  setConfig(config) {
    if (!Array.isArray(config.servers) || !config.servers.length) throw new Error("Geef een lijst 'servers' op");
    for (const s of config.servers) if (!s.naam || !s.status) throw new Error("Elke server heeft 'naam' en 'status' nodig");
    this._config = config;
    this._sleutel = null;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    // Alleen opnieuw tekenen als een van onze entiteiten verandert (of elke minuut, voor "aan sinds").
    const ids = this._config.servers.flatMap((s) =>
      [s.status, s.cpu, s.geheugen, s.schijf, s.schijf_gebruikt, s.schijf_max, s.sinds].filter(Boolean));
    const sleutel = JSON.stringify([ids.map((i) => hass.states[i]?.state), Math.floor(Date.now() / 60000)]);
    this._laadProfiel();
    if (sleutel === this._sleutel) return;
    this._sleutel = sleutel;
    this._teken();
  }

  _procent(s) {
    const st = this._hass.states;
    if (s.schijf) return getal(st[s.schijf]);
    if (s.schijf_gebruikt && s.schijf_max) {
      const g = getal(st[s.schijf_gebruikt]); const m = getal(st[s.schijf_max]);
      return g !== null && m ? (g / m) * 100 : null;
    }
    return null;
  }

  _balk(soort, waarde) {
    if (waarde === null) return `<div class="meter leeg"><span class="lbl">${soort === "cpu" ? "CPU" : soort === "geheugen" ? "RAM" : "Schijf"}</span><span class="pct">–</span></div>`;
    const [oranje, rood] = GRENS[soort];
    const kleur = waarde >= rood ? "rood" : waarde >= oranje ? "oranje" : "groen";
    const w = Math.max(2, Math.min(100, waarde));
    return `
      <div class="meter" title="${soort}: ${waarde.toFixed(1)}%">
        <span class="lbl">${soort === "cpu" ? "CPU" : soort === "geheugen" ? "RAM" : "Schijf"}</span>
        <div class="spoor"><div class="vul ${kleur}" style="width:${w}%"></div></div>
        <span class="pct">${Math.round(waarde)}%</span>
      </div>`;
  }

  _teken() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const st = this._hass.states;
    const rijen = this._config.servers.map((s, i) => {
      const status = st[s.status];
      const toestand = status ? status.state : "unavailable";
      const ok = OK.includes(toestand);
      let sinds = "–";
      const ts = s.sinds && st[s.sinds] && Date.parse(st[s.sinds].state);
      if (ts) sinds = duur(new Date(ts));
      else if (status) sinds = duur(new Date(status.last_changed));
      return `
        <div class="rij ${ok ? "" : "fout"}" data-i="${i}" role="button" tabindex="0">
          <div class="naam">
            <ha-icon class="ico" icon="${esc(s.icoon || "mdi:server")}"></ha-icon>
            <div class="tekst">
              <div class="titel">${esc(s.naam)}</div>
              ${s.soort ? `<div class="soort">${esc(s.soort)}</div>` : ""}
            </div>
            ${s.url ? `<a class="open" href="${esc(s.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(s.naam)}"><ha-icon icon="mdi:open-in-new"></ha-icon></a>` : ""}
          </div>
          <div class="status"><span class="pil ${ok ? "ok" : "nok"}"><span class="bol"></span>${esc(STATUS[toestand] || toestand)}</span></div>
          ${s.cpu || s.geheugen || s.schijf || s.schijf_gebruikt ? `
          <div class="meters">
            ${this._balk("cpu", s.cpu ? getal(st[s.cpu]) : null)}
            ${this._balk("geheugen", s.geheugen ? getal(st[s.geheugen]) : null)}
            ${this._balk("schijf", this._procent(s))}
          </div>` : `<div class="meters geen">alleen bereikbaarheid</div>`}
          <div class="sinds" title="${ts ? "aan sinds" : "in deze status sinds"}"><span class="kl">${ts && ok ? "aan" : "sinds"}</span> ${esc(sinds)}</div>
        </div>`;
    }).join("");
    const aantalOk = this._config.servers.filter((s) => OK.includes(st[s.status]?.state)).length;

    this.shadowRoot.innerHTML = `
      <style>${STIJL}</style>
      <ha-card class="${this._ingeklapt ? "ingeklapt" : ""}">
        ${this._kop(esc(this._config.titel || "Servers"), "",
          `<span class="samen ${aantalOk === this._config.servers.length ? "ok" : "nok"}">${aantalOk} van ${this._config.servers.length} in orde</span>`)}
        ${this._ingeklapt ? "" : `
        <div class="tabel">
          <div class="rij kopregel"><div>Server</div><div>Status</div><div class="meters"><span>CPU</span><span>Geheugen</span><span>Schijf</span></div><div class="sinds">Aan sinds</div></div>
          ${rijen}
        </div>`}
      </ha-card>`;
    this._koppelKop();

    this.shadowRoot.querySelectorAll(".rij[data-i]").forEach((el) => {
      const open = (e) => {
        if (e.target.closest("a")) return; // het pijltje opent de server zelf
        const s = this._config.servers[Number(el.dataset.i)];
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: s.status }, bubbles: true, composed: true }));
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
    });
  }

  getCardSize() { return 2 + this._config.servers.length; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

const STIJL = `
  ha-card { display: block; padding: 16px 16px 8px; container-type: inline-size; }
  .kop { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px; }
  .titel-kaart { font-size: 18px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
  .kop.klikbaar { cursor: pointer; user-select: none; border-radius: 8px; margin: -4px -6px 8px; padding: 4px 6px; }
  .kop.klikbaar:hover { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
  .kop.klikbaar:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  ha-card.ingeklapt { padding-bottom: 12px; }
  ha-card.ingeklapt .kop.klikbaar { margin-bottom: -4px; }
  .pijl { --mdc-icon-size: 22px; color: var(--secondary-text-color); transition: transform .2s ease; flex: none; }
  .pijl.dicht { transform: rotate(-90deg); }
  .samen { font-size: 13px; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .samen.ok { color: var(--success-color, #43a047); background: color-mix(in srgb, var(--success-color, #43a047) 14%, transparent); }
  .samen.nok { color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); }

  /* Breed: tabel met vaste kolommen */
  .rij { display: grid; grid-template-columns: minmax(170px, 1.4fr) 110px minmax(260px, 3fr) 90px; align-items: center;
         gap: 12px; padding: 10px 6px; border-top: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; cursor: pointer; }
  .rij[data-i]:hover { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
  .rij.fout { background: color-mix(in srgb, var(--error-color, #db4437) 7%, transparent); }
  .kopregel { cursor: default; border-top: none; padding-top: 0; padding-bottom: 6px; font-size: 12px; text-transform: uppercase;
              letter-spacing: .04em; color: var(--secondary-text-color); }
  .kopregel .meters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .naam { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ico { --mdc-icon-size: 22px; color: var(--state-icon-color, var(--secondary-text-color)); flex: none; }
  .tekst { min-width: 0; }
  .titel { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .soort { font-size: 12px; color: var(--secondary-text-color); }
  .open { color: var(--secondary-text-color); --mdc-icon-size: 16px; display: flex; padding: 4px; border-radius: 50%; }
  .open:hover { color: var(--primary-color); }
  .pil { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; padding: 3px 10px; border-radius: 999px; }
  .pil.ok { color: var(--success-color, #43a047); background: color-mix(in srgb, var(--success-color, #43a047) 14%, transparent); }
  .pil.nok { color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); }
  .bol { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .meters { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .meters.geen { display: block; font-size: 13px; color: var(--secondary-text-color); }
  .meter { display: grid; grid-template-columns: 1fr 38px; align-items: center; gap: 6px; }
  .meter .lbl { display: none; font-size: 12px; color: var(--secondary-text-color); }
  .spoor { height: 8px; border-radius: 4px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
  .vul { height: 100%; border-radius: 4px; }
  .vul.groen { background: var(--success-color, #43a047); }
  .vul.oranje { background: var(--warning-color, #ffa600); }
  .vul.rood { background: var(--error-color, #db4437); }
  .pct { font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }
  .meter.leeg { grid-template-columns: 1fr; }
  .meter.leeg .pct { text-align: left; color: var(--secondary-text-color); }
  .sinds { font-size: 13px; text-align: right; color: var(--primary-text-color); white-space: nowrap; }
  .sinds .kl { display: none; color: var(--secondary-text-color); }

  /* Smal (telefoon): per server een blok; naam + status boven, balkjes eronder */
  @container (max-width: 640px) {
    .kopregel { display: none; }
    .rij { grid-template-columns: 1fr auto; grid-template-areas: "naam status" "meters meters" "sinds sinds"; gap: 8px 10px; padding: 12px 4px; }
    .naam { grid-area: naam; }
    .status { grid-area: status; }
    .meters { grid-area: meters; gap: 10px; }
    .sinds { grid-area: sinds; text-align: left; font-size: 12px; color: var(--secondary-text-color); }
    .sinds .kl { display: inline; }
    .meter { grid-template-columns: 1fr auto; grid-template-areas: "lbl pct" "spoor spoor"; gap: 3px 4px; }
    .meter .lbl { display: block; grid-area: lbl; }
    .meter .pct { grid-area: pct; font-size: 12px; }
    .meter .spoor { grid-area: spoor; }
    .meter.leeg { grid-template-areas: "lbl pct"; }
  }
`;

// ---------------------------------------------------------------------------------------------
// Kaart "Bewaking": de monitors van Uptime Kuma (integratie uptime_kuma) in dezelfde stijl.
//
//   type: custom:uptime-overzicht-card
//   titel: Bewaking                       # optioneel
//   url: http://uptime-kuma.home          # optioneel, pijltje in de kop
//   monitors:
//     - naam: Home Assistant
//       id: home_assistance               # voorvoegsel van de sensoren: sensor.<id>_status enz.
//       icoon: mdi:home-assistant         # optioneel

const ms = (st) => { const v = getal(st); return v === null ? "–" : `${Math.round(v)} ms`; };
const uptime = (st) => {
  const v = getal(st);
  if (v === null) return `<span class="grijs">–</span>`;
  const k = v >= 99.9 ? "ok" : v >= 99 ? "oranje-t" : "nok-t";
  return `<span class="${k}">${v >= 99.95 ? "100" : v.toFixed(v >= 99 ? 2 : 1)}%</span>`;
};
const cert = (st) => {
  const v = getal(st);
  if (v === null) return `<span class="grijs">–</span>`;
  const k = v < 7 ? "nok-t" : v < 21 ? "oranje-t" : "";
  return `<span class="${k}">${Math.round(v)} d</span>`;
};

class UptimeOverzichtCard extends InklapKaart {
  setConfig(config) {
    if (!Array.isArray(config.monitors) || !config.monitors.length) throw new Error("Geef een lijst 'monitors' op");
    for (const m of config.monitors) if (!m.naam || !m.id) throw new Error("Elke monitor heeft 'naam' en 'id' nodig");
    this._config = config;
    this._sleutel = null;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const vals = this._config.monitors.flatMap((m) => ["status", "response_time", "uptime_1_day", "uptime_30_days", "certificate_expiry"]
      .map((s) => hass.states[`sensor.${m.id}_${s}`]?.state));
    const sleutel = JSON.stringify([vals, Math.floor(Date.now() / 60000)]);
    this._laadProfiel();
    if (sleutel === this._sleutel) return;
    this._sleutel = sleutel;
    this._teken();
  }

  _teken() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const st = this._hass.states;
    const s = (m, x) => st[`sensor.${m.id}_${x}`];
    const rijen = this._config.monitors.map((m, i) => {
      const status = s(m, "status");
      const toestand = status ? status.state : "unavailable";
      const ok = OK.includes(toestand);
      const url = s(m, "monitored_url")?.state;
      return `
        <div class="rij ${ok ? "" : "fout"}" data-i="${i}" role="button" tabindex="0">
          <div class="naam">
            <ha-icon class="ico" icon="${esc(m.icoon || "mdi:radar")}"></ha-icon>
            <div class="tekst">
              <div class="titel">${esc(m.naam)}</div>
              ${url && !["unknown", "unavailable"].includes(url) ? `<div class="soort">${esc(url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}</div>` : ""}
            </div>
          </div>
          <div class="status"><span class="pil ${ok ? "ok" : "nok"}"><span class="bol"></span>${esc(STATUS[toestand] || toestand)}</span></div>
          <div class="cijfers">
            <div><span class="kl">Reactie</span>${ms(s(m, "response_time"))}</div>
            <div><span class="kl">24 uur</span>${uptime(s(m, "uptime_1_day"))}</div>
            <div><span class="kl">30 dagen</span>${uptime(s(m, "uptime_30_days"))}</div>
            <div><span class="kl">Certificaat</span>${cert(s(m, "certificate_expiry"))}</div>
          </div>
        </div>`;
    }).join("");
    const aantalOk = this._config.monitors.filter((m) => OK.includes(s(m, "status")?.state)).length;
    const n = this._config.monitors.length;

    this.shadowRoot.innerHTML = `
      <style>${STIJL}${STIJL_BEWAKING}</style>
      <ha-card class="${this._ingeklapt ? "ingeklapt" : ""}">
        ${this._kop(esc(this._config.titel || "Bewaking"),
          this._config.url ? `<a class="open" href="${esc(this._config.url)}" target="_blank" rel="noopener" aria-label="Open Uptime Kuma"><ha-icon icon="mdi:open-in-new"></ha-icon></a>` : "",
          `<span class="samen ${aantalOk === n ? "ok" : "nok"}">${aantalOk} van ${n} up</span>`)}
        ${this._ingeklapt ? "" : `
        <div class="tabel bewaking">
          <div class="rij kopregel"><div>Monitor</div><div>Status</div>
            <div class="cijfers"><div>Reactie</div><div>24 uur</div><div>30 dagen</div><div>Certificaat</div></div></div>
          ${rijen}
        </div>`}
      </ha-card>`;
    this._koppelKop();

    this.shadowRoot.querySelectorAll(".rij[data-i]").forEach((el) => {
      const open = () => {
        const m = this._config.monitors[Number(el.dataset.i)];
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: `sensor.${m.id}_status` }, bubbles: true, composed: true }));
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });
  }

  getCardSize() { return 2 + this._config.monitors.length; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

const STIJL_BEWAKING = `
  .titel-kaart { display: inline-flex; align-items: center; gap: 4px; }
  .bewaking .rij { grid-template-columns: minmax(170px, 1.4fr) 110px minmax(300px, 3fr); }
  .cijfers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; font-size: 14px;
             text-align: right; font-variant-numeric: tabular-nums; }
  .kopregel .cijfers { font-size: 12px; }
  .cijfers .kl { display: none; }
  .ok { color: var(--success-color, #43a047); }
  .oranje-t { color: var(--warning-color, #ffa600); font-weight: 600; }
  .nok-t { color: var(--error-color, #db4437); font-weight: 600; }
  .grijs { color: var(--secondary-text-color); }
  @container (max-width: 640px) {
    .bewaking .rij { grid-template-columns: 1fr auto; grid-template-areas: "naam status" "cijfers cijfers"; }
    .cijfers { grid-area: cijfers; gap: 8px; text-align: left; font-size: 14px; }
    .cijfers > div { display: flex; flex-direction: column; }
    .cijfers .kl { display: block; font-size: 12px; color: var(--secondary-text-color); }
  }
`;

// ---------------------------------------------------------------------------------------------
// Kaart "Mini-pc totaal": CPU, geheugen en schijf van de hele pc (de Proxmox-host) als gestapelde
// balk, met per gast hoeveel hij gebruikt. Wat overblijft van het hostgebruik is "Proxmox zelf".
//
//   type: custom:pc-totaal-card
//   titel: Mini-pc totaal
//   host:
//     naam: Proxmox zelf                  # het restdeel van het gebruik
//     cpu: sensor.pve_cpu_usage           # % van alle cores
//     kernen: sensor.pve_max_cpu
//     geheugen: sensor.pve_memory_usage   # GiB in gebruik
//     geheugen_totaal: sensor.pve_max_memory_usage
//     schijf: sensor.storage_local_used_storage      # GiB van de host zelf (systeem + back-ups)
//     schijf_totaal: [sensor.storage_local_total_storage, sensor.storage_local_lvm_total_storage]
//   gasten:
//     - naam: Home Assistant
//       cpu: sensor.homeassistant_cpu_usage   # % van de eigen cores
//       kernen: sensor.homeassistant_max_cpu
//       geheugen: sensor.homeassistant_memory_usage   # GiB
//       schijf: sensor.home_assistant_schijf_op_host  # GiB

const KLEUREN = ["#4c8bf5", "#9c6ade", "#f0a030", "#26a69a", "#ec6a8c", "#7cb342"];
const HOST_KLEUR = "#8d96a0";
const nl = (v, d = 1) => v.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });

class PcTotaalCard extends InklapKaart {
  setConfig(config) {
    if (!config.host || !config.host.cpu || !config.host.geheugen || !config.host.geheugen_totaal)
      throw new Error("Geef 'host' op met minstens cpu, geheugen en geheugen_totaal");
    this._config = { ...config, gasten: config.gasten || [] };
    this._sleutel = null;
    if (this._hass) this.hass = this._hass;
  }

  _ids() {
    const h = this._config.host;
    const totaal = [].concat(h.schijf_totaal || []);
    return [h.cpu, h.kernen, h.geheugen, h.geheugen_totaal, h.schijf, ...totaal,
      ...this._config.gasten.flatMap((g) => [g.cpu, g.kernen, g.geheugen, g.schijf])].filter(Boolean);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const sleutel = JSON.stringify(this._ids().map((i) => hass.states[i]?.state));
    this._laadProfiel();
    if (sleutel === this._sleutel) return;
    this._sleutel = sleutel;
    this._teken();
  }

  _v(id) { return id ? getal(this._hass.states[id]) : null; }

  // Eén regel: titel + totaal, gestapelde balk, legenda. delen: [{naam, waarde, kleur}] in dezelfde eenheid als totaal.
  _regel(titel, samenvatting, delen, totaal, eenheid, d) {
    if (!totaal) return `<div class="pc-regel"><div class="pc-kop"><span class="pc-titel">${titel}</span><span class="pc-som">–</span></div></div>`;
    const gebruikt = delen.reduce((a, x) => a + x.waarde, 0);
    const vrij = Math.max(0, totaal - gebruikt);
    const pct = (x) => Math.max(0, (x / totaal) * 100);
    const zw = gebruikt / totaal * 100;
    const kleurTotaal = zw >= 90 ? "nok-t" : zw >= 75 ? "oranje-t" : "";
    return `
      <div class="pc-regel">
        <div class="pc-kop"><span class="pc-titel">${titel}</span><span class="pc-som"><b class="${kleurTotaal}">${Math.round(zw)}%</b> ${samenvatting}</span></div>
        <div class="stapel" role="img" aria-label="${titel}: ${Math.round(zw)}% in gebruik">
          ${delen.filter((x) => x.waarde > 0).map((x) =>
            `<div class="deel" style="width:${pct(x.waarde)}%;background:${x.kleur}" title="${esc(x.naam)}: ${nl(x.waarde, d)} ${eenheid}"></div>`).join("")}
        </div>
        <div class="legenda">
          ${delen.map((x) => `<span class="lg"><span class="stip" style="background:${x.kleur}"></span>${esc(x.naam)} <b>${nl(x.waarde, d)} ${eenheid}</b></span>`).join("")}
          <span class="lg"><span class="stip vrij"></span>Vrij <b>${nl(vrij, d)} ${eenheid}</b></span>
        </div>
      </div>`;
  }

  _teken() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const h = this._config.host;
    const gasten = this._config.gasten.map((g, i) => ({ ...g, kleur: g.kleur || KLEUREN[i % KLEUREN.length] }));
    const hostNaam = h.naam || "Proxmox zelf";

    // CPU in "cores bezet": gast-% × eigen cores; host-% × alle cores. Rest = host zelf.
    const kernen = this._v(h.kernen) || 1;
    const cpuDelen = gasten.map((g) => ({ naam: g.naam, kleur: g.kleur,
      waarde: ((this._v(g.cpu) || 0) / 100) * (this._v(g.kernen) || 1) }));
    const cpuHost = ((this._v(h.cpu) || 0) / 100) * kernen;
    cpuDelen.push({ naam: hostNaam, kleur: HOST_KLEUR, waarde: Math.max(0, cpuHost - cpuDelen.reduce((a, x) => a + x.waarde, 0)) });

    const memDelen = gasten.map((g) => ({ naam: g.naam, kleur: g.kleur, waarde: this._v(g.geheugen) || 0 }));
    const memHost = this._v(h.geheugen) || 0;
    memDelen.push({ naam: hostNaam, kleur: HOST_KLEUR, waarde: Math.max(0, memHost - memDelen.reduce((a, x) => a + x.waarde, 0)) });
    const memTotaal = this._v(h.geheugen_totaal);

    const schijfTotaal = [].concat(h.schijf_totaal || []).reduce((a, id) => a + (this._v(id) || 0), 0);
    const schijfDelen = gasten.filter((g) => g.schijf).map((g) => ({ naam: g.naam, kleur: g.kleur, waarde: this._v(g.schijf) || 0 }));
    if (h.schijf) schijfDelen.push({ naam: `${hostNaam} + back-ups`, kleur: HOST_KLEUR, waarde: this._v(h.schijf) || 0 });

    // Samenvatting voor de kop (ook zichtbaar als de kaart is ingeklapt).
    const memPct = memTotaal ? (memHost / memTotaal) * 100 : 0;
    const schijfGebruikt = schijfDelen.reduce((a, x) => a + x.waarde, 0);
    const schijfPct = schijfTotaal ? (schijfGebruikt / schijfTotaal) * 100 : 0;
    const cpuPct = this._v(h.cpu) || 0;
    const zwaar = Math.max(cpuPct, memPct, schijfPct);
    const samen = `<span class="samen ${zwaar >= 90 ? "nok" : "ok"}">CPU ${Math.round(cpuPct)}% · RAM ${Math.round(memPct)}% · schijf ${Math.round(schijfPct)}%</span>`;

    this.shadowRoot.innerHTML = `
      <style>${STIJL}${STIJL_BEWAKING}${STIJL_PC}</style>
      <ha-card class="${this._ingeklapt ? "ingeklapt" : ""}">
        ${this._kop(esc(this._config.titel || "Mini-pc totaal"), "", samen)}
        ${this._ingeklapt ? "" : `
        <div class="pc">
          ${this._regel("CPU", `van ${kernen} cores`,
            cpuDelen.map((x) => ({ ...x, waarde: (x.waarde / kernen) * 100 })), 100, "%", 1)}
          ${this._regel("Geheugen", memTotaal ? `van ${nl(memTotaal)} GiB` : "", memDelen, memTotaal, "GiB", 1)}
          ${this._regel("Schijf", schijfTotaal ? `van ${nl(schijfTotaal, 0)} GiB` : "", schijfDelen, schijfTotaal, "GiB", 1)}
        </div>`}
      </ha-card>`;
    this._koppelKop();
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

const STIJL_PC = `
  .pc { display: grid; gap: 18px; padding: 4px 0 8px; }
  .pc-kop { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .pc-titel { font-weight: 600; font-size: 15px; }
  .pc-som { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; }
  .pc-som b { color: var(--primary-text-color); font-size: 15px; margin-right: 2px; }
  .stapel { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--divider-color, rgba(127,127,127,.2)); }
  .deel { height: 100%; min-width: 2px; }
  .deel + .deel { box-shadow: inset 2px 0 0 var(--card-background-color, #fff); }
  .legenda { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-size: 13px; color: var(--secondary-text-color); }
  .legenda b { color: var(--primary-text-color); font-weight: 500; font-variant-numeric: tabular-nums; }
  .lg { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .stip { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .stip.vrij { background: var(--divider-color, rgba(127,127,127,.3)); }
`;

customElements.define("server-overzicht-card", ServerOverzichtCard);
customElements.define("pc-totaal-card", PcTotaalCard);
customElements.define("uptime-overzicht-card", UptimeOverzichtCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "server-overzicht-card", name: "Server-overzicht",
  description: "Status, CPU, geheugen, schijf en uptime van je servers in één tabel." });
window.customCards.push({ type: "pc-totaal-card", name: "Mini-pc totaal",
  description: "CPU, geheugen en schijf van de hele pc, met per server hoeveel hij gebruikt." });
window.customCards.push({ type: "uptime-overzicht-card", name: "Bewaking (Uptime Kuma)",
  description: "Monitors van Uptime Kuma: status, reactietijd, uptime en certificaat." });
