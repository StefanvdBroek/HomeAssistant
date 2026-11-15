// Kaart "Airco-schema": tijdsblokken per airco (dagen, begin, eind, modus, temperatuur, ventilator).
// Leest sensor.airco_schema en gebruikt de acties van custom_components/airco_schema.
//
// Gebruik:
//   type: custom:airco-schema-card
//   airco: woonkamer          # naam zoals in configuration.yaml onder airco_schema:
//   titel: Schema woonkamer   # optioneel

const DAGEN = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const MODI = { heat: "Verwarmen", cool: "Koelen", auto: "Automatisch", dry: "Drogen", fan_only: "Ventilator" };
const MET_TEMP = ["heat", "cool", "auto"];
const VENTILATOR = { auto: "Automatisch", low: "Laag", low_mid: "Laag-midden", medium: "Midden",
                     mid_high: "Midden-hoog", high: "Hoog" };

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Datums in lokale tijd; weekdag 0 = maandag (zoals in Home Assistant).
const isoDatum = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekdag = (d) => (d.getDay() + 6) % 7;
const kortDatum = (d) => `${DAGEN[weekdag(d)].toLowerCase()} ${d.getDate()}-${d.getMonth() + 1}`;
const vanIso = (s) => { const [j, m, d] = s.split("-").map(Number); return new Date(j, m - 1, d); };

// Eerstvolgende datums (vanaf vandaag) waarop een dag uit 'dagen' valt.
function volgendeDatums(dagen, aantal) {
  const uit = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 21 && uit.length < aantal; i++, d.setDate(d.getDate() + 1)) {
    if (dagen.includes(weekdag(d))) uit.push(new Date(d));
  }
  return uit;
}
// ISO-weeknummer (zoals in de agenda; week begint op maandag).
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // donderdag van die week
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
// Zelfde regel als in de integratie: om de week = alleen in de even of de oneven weeknummers.
const dezeWeek = (r, d) => r.interval !== 2 || !r.weken || ((isoWeek(d) % 2 === 0) === (r.weken === "even"));
// Eerstvolgende keer dat het blok begint (vandaag telt alleen als de begintijd nog moet komen).
function volgendeKeer(r) {
  const nu = new Date(); const d = new Date(); d.setHours(0, 0, 0, 0);
  const [u, m] = r.begin.split(":").map(Number);
  for (let i = 0; i < 21; i++, d.setDate(d.getDate() + 1)) {
    const start = new Date(d); start.setHours(u, m, 0, 0);
    if (start > nu && r.dagen.includes(weekdag(d)) && dezeWeek(r, d)) return new Date(d);
  }
  return null;
}

function dagenTekst(dagen) {
  const s = [...dagen].sort().join(",");
  if (s === "0,1,2,3,4,5,6") return "Elke dag";
  if (s === "0,1,2,3,4") return "Werkdagen";
  if (s === "5,6") return "Weekend";
  return dagen.map((d) => DAGEN[d]).join(" ");
}

class AircoSchemaCard extends HTMLElement {
  setConfig(config) {
    if (!config.airco) throw new Error("Geef 'airco' op, bijvoorbeeld: woonkamer");
    this._config = config;
    this._bewerk = null;      // blok dat in het formulier staat (nieuw of bestaand)
    this._verwijder = null;   // id van het blok waarvoor de vraag "zeker weten?" openstaat
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states["sensor.airco_schema"];
    const a = st && st.attributes.aircos && st.attributes.aircos[this._config.airco];
    const klimaat = a && hass.states[a.klimaat];
    const sleutel = JSON.stringify([a, klimaat && klimaat.attributes.fan_modes]);
    if (sleutel === this._sleutel) return;
    this._sleutel = sleutel;
    this._airco = a;
    this._klimaat = klimaat;
    if (!this._bewerk) this._teken(); // niet midden in het invullen opnieuw tekenen
  }

  _teken() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const a = this._airco;
    if (!a) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:16px">Airco-schema niet gevonden (${esc(this._config.airco)}).</ha-card>`;
      return;
    }
    const titel = this._config.titel || "Schema";
    const regels = a.regels || [];
    this.shadowRoot.innerHTML = `
      <style>${STIJL}</style>
      <ha-card>
        <div class="kop">
          <span class="titel">${esc(titel)}</span>
          <label class="schakel"><input type="checkbox" id="aan" ${a.aan ? "checked" : ""}><span>${a.aan ? "Aan" : "Uit"}</span></label>
        </div>
        ${regels.length ? "" : `<div class="leeg">Nog geen tijdsblokken.</div>`}
        ${regels.map((r) => `
          <div class="blok ${a.aan ? "" : "grijs"}">
            <div class="info">
              <div class="tijd">${r.eind ? `${esc(r.begin)} – ${esc(r.eind)}` : `vanaf ${esc(r.begin)}`} <span class="dagen">${esc(dagenTekst(r.dagen))}${r.interval === 2 ? `, om de week (${r.weken === "oneven" ? "oneven" : "even"} weken)` : ""}</span></div>
              <div class="details">${esc(MODI[r.modus] || r.modus)}${MET_TEMP.includes(r.modus) && r.temperatuur ? ` · ${r.temperatuur} °C` : ""}${r.ventilator ? ` · ventilator ${esc((VENTILATOR[r.ventilator] || r.ventilator).toLowerCase())}` : ""}${r.eind ? "" : " · gaat niet vanzelf uit"}${r.interval === 2 && volgendeKeer(r) ? ` · volgende keer ${kortDatum(volgendeKeer(r))}` : ""}</div>
            </div>
            <button class="icoon" data-bewerk="${esc(r.id)}" aria-label="Wijzigen"><ha-icon icon="mdi:pencil"></ha-icon></button>
            <button class="icoon weg" data-weg="${esc(r.id)}" aria-label="Verwijderen"><ha-icon icon="mdi:delete"></ha-icon></button>
          </div>
          ${this._verwijder === r.id ? `
          <div class="zeker">
            Weet je zeker dat je het blok <b>${esc(r.begin)}${r.eind ? " – " + esc(r.eind) : ""} (${esc(dagenTekst(r.dagen))})</b> wilt verwijderen?
            <div class="rij"><button class="nee" id="nee">Annuleren</button><button class="ja" id="ja">Verwijderen</button></div>
          </div>` : ""}`).join("")}
        ${this._bewerk ? this._formulier() : `<button class="toevoegen" id="nieuw"><ha-icon icon="mdi:plus"></ha-icon> Tijdsblok toevoegen</button>`}
      </ha-card>`;
    this._koppel();
  }

  _formulier() {
    const b = this._bewerk;
    const fan = (this._klimaat && this._klimaat.attributes.fan_modes) || [];
    const attr = (this._klimaat && this._klimaat.attributes) || {};
    return `
      <div class="formulier">
        <div class="label">Dagen</div>
        <div class="dagen-kies">${DAGEN.map((d, i) => `<button class="dag ${b.dagen.includes(i) ? "aan" : ""}" data-dag="${i}">${d}</button>`).join("")}</div>
        <div class="snel">
          <button data-snel="0,1,2,3,4">Werkdagen</button><button data-snel="5,6">Weekend</button><button data-snel="0,1,2,3,4,5,6">Elke dag</button>
        </div>
        <div class="twee">
          <label>Begin<input type="time" id="begin" value="${esc(b.begin)}"></label>
          <label>Eind <small>(leeg = niet uit)</small><input type="time" id="eind" value="${esc(b.eind || "")}"></label>
        </div>
        <label class="vinkje"><input type="checkbox" id="omdeweek" ${b.interval === 2 ? "checked" : ""}> Om de week</label>
        <label id="weken-label" ${b.interval === 2 ? "" : "hidden"}>Welke weken<select id="weken">${this._wekenOpties(b)}</select></label>
        <label>Modus<select id="modus">${Object.entries(MODI).map(([k, v]) => `<option value="${k}" ${b.modus === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <div class="twee">
          <label id="temp-label">Temperatuur (°C)<input type="number" id="temperatuur" inputmode="decimal"
             min="${attr.min_temp || 16}" max="${attr.max_temp || 30}" step="${attr.target_temp_step || 0.5}" value="${esc(b.temperatuur ?? 21)}"></label>
          <label>Ventilator<select id="ventilator">${fan.map((f) => `<option value="${f}" ${b.ventilator === f ? "selected" : ""}>${VENTILATOR[f] || f}</option>`).join("")}</select></label>
        </div>
        <div class="melding" id="melding"></div>
        <div class="rij">
          <button class="nee" id="annuleer">Annuleren</button>
          <button class="ja opslaan" id="opslaan">Opslaan</button>
        </div>
      </div>`;
  }

  _koppel() {
    const r = this.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const a = this._airco;
    $("aan").addEventListener("change", (e) =>
      this._actie("aan_uit", { aan: e.target.checked }));
    r.querySelectorAll("[data-bewerk]").forEach((knop) => knop.addEventListener("click", () => {
      const blok = a.regels.find((x) => x.id === knop.dataset.bewerk);
      this._bewerk = { ...blok, dagen: [...blok.dagen] };
      this._verwijder = null;
      this._teken();
    }));
    r.querySelectorAll("[data-weg]").forEach((knop) => knop.addEventListener("click", () => {
      this._verwijder = knop.dataset.weg; this._teken();
    }));
    if ($("nee")) $("nee").addEventListener("click", () => { this._verwijder = null; this._teken(); });
    if ($("ja")) $("ja").addEventListener("click", async () => {
      const id = this._verwijder; this._verwijder = null;
      await this._actie("blok_verwijderen", { id });
    });
    if ($("nieuw")) $("nieuw").addEventListener("click", () => {
      const fan = (this._klimaat && this._klimaat.attributes.fan_modes) || [];
      this._bewerk = { dagen: [0, 1, 2, 3, 4], begin: "07:00", eind: "09:00", modus: "heat",
                       temperatuur: 21, ventilator: fan.includes("auto") ? "auto" : fan[0] };
      this._verwijder = null;
      this._teken();
    });
    if (!this._bewerk) return;

    // formulier
    const b = this._bewerk;
    const bewaarVelden = () => {
      b.begin = $("begin").value; b.eind = $("eind").value; b.modus = $("modus").value;
      if ($("weken")) b.weken = $("weken").value;
      b.temperatuur = parseFloat($("temperatuur").value); b.ventilator = $("ventilator").value;
    };
    const tempZichtbaar = () => { $("temp-label").style.visibility = MET_TEMP.includes($("modus").value) ? "visible" : "hidden"; };
    tempZichtbaar();
    $("modus").addEventListener("change", tempZichtbaar);
    $("omdeweek").addEventListener("change", () => {
      bewaarVelden(); b.interval = $("omdeweek").checked ? 2 : 1; this._teken();
    });
    r.querySelectorAll("[data-dag]").forEach((knop) => knop.addEventListener("click", () => {
      const d = +knop.dataset.dag;
      b.dagen = b.dagen.includes(d) ? b.dagen.filter((x) => x !== d) : [...b.dagen, d];
      knop.classList.toggle("aan");
      if (b.interval === 2) { bewaarVelden(); this._teken(); } // keuze "eerste keer" hangt van de dagen af
    }));
    r.querySelectorAll("[data-snel]").forEach((knop) => knop.addEventListener("click", () => {
      bewaarVelden(); b.dagen = knop.dataset.snel.split(",").map(Number); this._teken();
    }));
    $("annuleer").addEventListener("click", () => { this._bewerk = null; this._teken(); });
    $("opslaan").addEventListener("click", async () => {
      bewaarVelden();
      const fout = !b.dagen.length ? "Kies minstens één dag."
        : !b.begin ? "Vul een begintijd in."
        : b.eind && b.begin === b.eind ? "Begin- en eindtijd mogen niet gelijk zijn."
        : b.interval === 2 && !b.weken ? "Kies even of oneven weken." : "";
      if (fout) { $("melding").textContent = fout; return; }
      const gegevens = { dagen: b.dagen, begin: b.begin, eind: b.eind || null, modus: b.modus,
                         interval: b.interval === 2 ? 2 : 1, weken: b.interval === 2 ? b.weken : null,
                         ventilator: b.ventilator || null,
                         temperatuur: MET_TEMP.includes(b.modus) && !isNaN(b.temperatuur) ? b.temperatuur : null };
      if (b.id) gegevens.id = b.id;
      $("opslaan").disabled = true;
      const gelukt = await this._actie("blok_opslaan", gegevens, $("melding"));
      if (gelukt) { this._bewerk = null; this._teken(); } else { $("opslaan").disabled = false; }
    });
  }

  // Keuze bij om de week: even of oneven weeknummers, met de eerstvolgende datum erbij.
  _wekenOpties(b) {
    // Zelfde berekening als "volgende keer" in de lijst (vandaag telt alleen als de begintijd nog komt).
    const eerste = (even) => b.dagen.length && b.begin
      ? volgendeKeer({ dagen: b.dagen, begin: b.begin, interval: 2, weken: even ? "even" : "oneven" }) : null;
    const deze = isoWeek(new Date());
    if (!b.weken) b.weken = deze % 2 === 0 ? "even" : "oneven";
    return ["even", "oneven"].map((w) => {
      const d = eerste(w === "even");
      const voorbeeld = d ? ` – eerst ${kortDatum(d)} (week ${isoWeek(d)})` : "";
      return `<option value="${w}" ${b.weken === w ? "selected" : ""}>${w === "even" ? "Even" : "Oneven"} weken${voorbeeld}</option>`;
    }).join("");
  }

  async _actie(naam, gegevens, meldingVeld) {
    try {
      await this._hass.callService("airco_schema", naam, { airco: this._config.airco, ...gegevens });
      return true;
    } catch (fout) {
      const tekst = `Mislukt: ${fout.message || fout}`;
      if (meldingVeld) meldingVeld.textContent = tekst; else alert(tekst);
      return false;
    }
  }

  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, rows: "auto" }; }
}

const STIJL = `
  ha-card { padding: 16px; }
  .kop { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .titel { font-size: 18px; font-weight: 600; }
  .schakel { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--secondary-text-color); cursor: pointer; }
  .schakel input { width: 20px; height: 20px; accent-color: var(--primary-color); }
  .leeg { color: var(--secondary-text-color); padding: 8px 0; }
  .blok { display: flex; align-items: center; gap: 4px; padding: 10px 0; border-top: 1px solid var(--divider-color, #ddd); }
  .blok.grijs { opacity: .5; }
  .info { flex: 1; min-width: 0; }
  .tijd { font-size: 16px; font-weight: 600; }
  .dagen { font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; font-size: 14px; }
  .details { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
  button.icoon { background: none; border: none; padding: 8px; border-radius: 50%; cursor: pointer; color: var(--secondary-text-color); --mdc-icon-size: 22px; }
  button.icoon.weg { color: var(--error-color, #db4437); }
  .zeker { padding: 12px; border-radius: 10px; background: var(--secondary-background-color, #f3f3f3); margin-bottom: 8px; font-size: 14px; }
  .rij { display: flex; gap: 10px; margin-top: 10px; }
  .rij button { flex: 1; font: inherit; font-size: 15px; padding: 11px; border-radius: 10px; cursor: pointer; border: none; }
  .ja { background: var(--error-color, #db4437); color: #fff; }
  .ja.opslaan { background: var(--primary-color, #03a9f4); }
  .nee { background: transparent; border: 1px solid var(--divider-color, #ccc) !important; color: var(--primary-text-color); }
  .toevoegen { margin-top: 10px; width: 100%; font: inherit; font-size: 15px; font-weight: 500; padding: 12px; border-radius: 10px; cursor: pointer;
               background: transparent; color: var(--primary-color); border: 2px dashed var(--primary-color); display: flex; align-items: center; justify-content: center; gap: 6px; }
  .formulier { border-top: 1px solid var(--divider-color, #ddd); padding-top: 12px; margin-top: 4px; }
  .label, label { font-size: 13px; color: var(--secondary-text-color); display: block; }
  label { margin-top: 10px; }
  .dagen-kies { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 6px; }
  .dag { font: inherit; font-size: 14px; padding: 9px 0; border-radius: 8px; cursor: pointer; border: 1px solid var(--divider-color, #ccc);
         background: transparent; color: var(--primary-text-color); }
  .dag.aan { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .snel { display: flex; gap: 6px; margin-top: 6px; }
  .snel button { flex: 1; font: inherit; font-size: 13px; padding: 6px; border-radius: 8px; cursor: pointer; border: none;
                 background: var(--secondary-background-color, #eee); color: var(--primary-text-color); }
  .twee { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  input, select { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 10px; margin-top: 4px; border-radius: 8px;
                  border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  label.vinkje { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--primary-text-color); margin-top: 12px; }
  label.vinkje input { width: 20px; height: 20px; margin: 0; accent-color: var(--primary-color); }
  label[hidden] { display: none; }
  small { font-size: 11px; }
  .melding { color: var(--error-color, #db4437); font-size: 14px; min-height: 1em; margin-top: 8px; }
`;

customElements.define("airco-schema-card", AircoSchemaCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "airco-schema-card", name: "Airco-schema",
  description: "Tijdsblokken per airco: dagen, begin, eind, modus, temperatuur en ventilator." });
