// Kaart "Klantkaart toevoegen" voor het dashboard Klantkaarten.
// Toont alleen een ronde +-knop rechtsonder in beeld; die opent een paneel met:
//  - winkel + kaartnummer + "Opslaan": wordt een barcode (komt in de lijst todo.klantkaarten), of
//  - winkel + "Foto maken": de camera van de telefoon gaat direct open; de foto gaat naar
//    /api/klantkaarten/upload (custom_components/klantkaarten), die de barcode/QR-code eruit leest.
//
// De knop en het paneel hangen aan document.body (zodat "rechtsonder" altijd het scherm is en niet
// de kaart), en verdwijnen weer als het dashboard wordt verlaten.
//
// Het potloodje in de lijst (klantkaarten-lijst-card, onderaan dit bestand) opent hetzelfde paneel
// in bewerkmodus via het window-event "klantkaart-bewerken".
//
// Gebruik:  type: custom:klantkaart-camera-card   en   type: custom:klantkaarten-lijst-card

const STIJL = `
  .plus {
    position: fixed; right: calc(20px + env(safe-area-inset-right)); bottom: calc(20px + env(safe-area-inset-bottom));
    width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer; z-index: 5;
    background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff);
    font-size: 34px; line-height: 60px; text-align: center; padding: 0;
    box-shadow: 0 4px 14px rgba(0,0,0,.3);
  }
  .achtergrond { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 6; display: none; }
  .paneel {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 7; display: none;
    max-width: 560px; margin: 0 auto; box-sizing: border-box;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom));
    border-radius: 18px 18px 0 0; background: var(--card-background-color, #fff); color: var(--primary-text-color, #000);
    font-family: var(--ha-font-family-body, Roboto, sans-serif);
    box-shadow: 0 -6px 24px rgba(0,0,0,.25);
  }
  .open .achtergrond, .open .paneel { display: block; }
  .open .plus { display: none; }
  .kop { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .kop span { font-size: 18px; font-weight: 600; }
  .sluit { background: none; border: none; font-size: 26px; cursor: pointer; color: var(--secondary-text-color, #666); padding: 0 4px; }
  input[type=text] {
    width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 12px; margin-top: 10px;
    border-radius: 10px; border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff); color: var(--primary-text-color, #000);
  }
  .knoppen { display: flex; gap: 10px; margin-top: 14px; }
  .knoppen button {
    flex: 1; font: inherit; font-size: 16px; font-weight: 500; padding: 14px; border: none; border-radius: 10px; cursor: pointer;
    background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff);
  }
  .knoppen button.tweede { background: transparent; color: var(--primary-color, #03a9f4); border: 2px solid var(--primary-color, #03a9f4); }
  button[disabled] { opacity: .6; cursor: default; }
  .status { margin-top: 12px; min-height: 1.2em; font-size: 14px; color: var(--secondary-text-color); }
  .status.fout { color: var(--error-color, #db4437); }
  .status.ok { color: var(--success-color, #43a047); }
`;

class KlantkaartCameraCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this.style.display = "none"; // de kaart zelf neemt geen ruimte in op het dashboard
  }

  set hass(hass) { this._hass = hass; }

  connectedCallback() {
    if (this._laag) return;
    // Losse laag op document.body met de +-knop en het paneel.
    this._laag = document.createElement("div");
    this._laag.setAttribute("data-klantkaart-toevoegen", "");
    const root = this._laag.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STIJL}</style>
      <div id="houder">
        <button class="plus" id="plus" title="Klantkaart toevoegen" aria-label="Klantkaart toevoegen">+</button>
        <div class="achtergrond" id="achtergrond"></div>
        <div class="paneel" role="dialog" aria-label="Klantkaart toevoegen">
          <div class="kop"><span id="titel">Klantkaart toevoegen</span><button class="sluit" id="sluit" aria-label="Sluiten">×</button></div>
          <input type="text" id="naam" placeholder="Winkel, bijv. Albert Heijn" autocomplete="off" enterkeyhint="next">
          <input type="text" id="nummer" placeholder="Kaartnummer (of laat leeg en maak een foto)" autocomplete="off" enterkeyhint="done">
          <div class="knoppen">
            <button id="opslaan">💾 Opslaan</button>
            <button id="knop" class="tweede">📷 Foto maken</button>
          </div>
          <input type="file" id="foto" accept="image/*" capture="environment" hidden>
          <div class="status" id="status"></div>
        </div>
      </div>`;
    const $ = (id) => root.getElementById(id);
    this._houder = $("houder");
    this._naam = $("naam"); this._nummer = $("nummer"); this._opslaan = $("opslaan");
    this._knop = $("knop"); this._foto = $("foto"); this._status = $("status");
    $("plus").addEventListener("click", () => this._open());
    $("sluit").addEventListener("click", () => this._sluit());
    $("achtergrond").addEventListener("click", () => this._sluit());
    this._opslaan.addEventListener("click", () => this._bewaarNummer());
    this._nummer.addEventListener("keydown", (e) => { if (e.key === "Enter") this._bewaarNummer(); });
    this._knop.addEventListener("click", () => this._start());
    this._foto.addEventListener("change", () => this._upload());
    this._titel = $("titel");
    this._bewerkHandler = (e) => this._open(e.detail);
    window.addEventListener("klantkaart-bewerken", this._bewerkHandler);
    document.body.appendChild(this._laag);
  }

  disconnectedCallback() {
    // Dashboard verlaten: knop en paneel weghalen.
    if (this._laag) { this._laag.remove(); this._laag = null; }
    window.removeEventListener("klantkaart-bewerken", this._bewerkHandler);
  }

  _open(kaart) {
    // kaart = {naam, nummer} bij bewerken (potloodje), anders leeg (plusje).
    this._bewerk = kaart && kaart.naam ? kaart : null;
    this._titel.textContent = this._bewerk ? "Klantkaart wijzigen" : "Klantkaart toevoegen";
    this._naam.value = this._bewerk ? this._bewerk.naam : "";
    this._nummer.value = this._bewerk && this._bewerk.nummer ? this._bewerk.nummer : "";
    this._nummer.placeholder = this._bewerk && !this._bewerk.nummer
      ? "Kaartnummer (leeg laten = foto houden)" : "Kaartnummer (of laat leeg en maak een foto)";
    this._knop.textContent = this._bewerk ? "📷 Nieuwe foto" : "📷 Foto maken";
    this._melding("");
    this._houder.classList.add("open");
    setTimeout(() => this._naam.focus(), 50);
  }

  _sluit() { this._houder.classList.remove("open"); }

  _melding(tekst, soort = "") {
    this._status.textContent = tekst;
    this._status.className = "status " + soort;
  }

  _klaar(tekst) {
    this._melding(tekst, "ok");
    this._naam.value = ""; this._nummer.value = "";
    setTimeout(() => this._sluit(), 1500);
  }

  async _bewaarNummer() {
    const naam = this._naam.value.trim();
    const nummer = this._nummer.value.trim();
    if (!naam) { this._melding("Vul eerst de naam van de winkel in.", "fout"); this._naam.focus(); return; }
    if (!nummer && !this._bewerk) { this._melding("Vul het kaartnummer in, of tik op Foto maken.", "fout"); this._nummer.focus(); return; }
    this._opslaan.disabled = true;
    this._melding("Bezig met opslaan…");
    try {
      if (this._bewerk) {
        await this._hass.callService("klantkaarten", "wijzigen",
                                     { naam: this._bewerk.naam, nieuwe_naam: naam, nummer });
      } else {
        await this._hass.callService("todo", "add_item", { item: naam, description: nummer },
                                     { entity_id: "todo.klantkaarten" });
      }
      await this._hass.callService("script", "klantkaarten_bijwerken", {});
      this._klaar(`✓ ${naam} opgeslagen.`);
    } catch (fout) {
      this._melding(`Opslaan mislukt: ${fout.message || fout}`, "fout");
    } finally {
      this._opslaan.disabled = false;
    }
  }

  _start() {
    if (!this._naam.value.trim()) {
      this._melding("Vul eerst de naam van de winkel in.", "fout");
      this._naam.focus();
      return;
    }
    this._foto.value = "";
    this._foto.click();
  }

  async _upload() {
    const bestand = this._foto.files && this._foto.files[0];
    if (!bestand) return;
    const naam = this._naam.value.trim();
    const data = new FormData();
    data.append("naam", naam);
    data.append("foto", bestand, bestand.name || "foto.jpg");
    this._knop.disabled = true;
    this._melding("Barcode zoeken…");
    try {
      const antwoord = await this._hass.fetchWithAuth("/api/klantkaarten/upload", { method: "POST", body: data });
      const json = await antwoord.json().catch(() => ({}));
      if (!antwoord.ok) throw new Error(json.message || `fout ${antwoord.status}`);
      if (this._bewerk && this._bewerk.naam.toLowerCase() !== json.naam.toLowerCase()) {
        await this._hass.callService("klantkaarten", "verwijderen", { naam: this._bewerk.naam });
      }
      if (json.gelezen) {
        this._klaar(`✓ ${json.soort === "QR-code" ? "QR-code" : "Barcode"} van ${json.naam} gelezen.`);
      } else {
        this._melding(`Geen barcode gevonden op de foto; de foto van ${json.naam} is bewaard. ` +
          "Tip: fotografeer de barcode recht en van dichtbij, of vul het nummer in.", "fout");
        this._naam.value = ""; this._nummer.value = "";
      }
    } catch (fout) {
      this._melding(`Opslaan mislukt: ${fout.message}`, "fout");
    } finally {
      this._knop.disabled = false;
    }
  }

  getCardSize() { return 0; }
  getGridOptions() { return { columns: 12, rows: "auto" }; }
}

// ----------------------------------------------------------------- lijstkaart
// Alle klantkaarten (uit sensor.klantkaarten) met per kaart een potloodje en een prullenbak.
class KlantkaartenLijstCard extends HTMLElement {
  setConfig(config) { this._config = config || {}; }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states["sensor.klantkaarten"];
    const kaarten = (st && st.attributes.kaarten) || [];
    const sleutel = JSON.stringify(kaarten);
    if (sleutel === this._sleutel) return; // alleen opnieuw tekenen als er iets veranderd is
    this._sleutel = sleutel;
    this._kaarten = kaarten;
    this._teken();
  }

  _teken() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const kaarten = this._kaarten;
    this.shadowRoot.innerHTML = `
      <style>
        .kaart { padding: 16px; margin-bottom: 12px; }
        .kop { display: flex; align-items: center; gap: 4px; }
        .kop h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .kop h2 ha-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); transition: transform .15s; }
        .ingeklapt .kop h2 ha-icon { transform: rotate(-90deg); }
        .ingeklapt .inhoud { display: none; }
        .kop button { background: none; border: none; cursor: pointer; padding: 8px; border-radius: 50%;
                      color: var(--secondary-text-color); --mdc-icon-size: 22px; }
        .kop button.weg { color: var(--error-color, #db4437); }
        img { display: block; width: 100%; margin-top: 12px; border-radius: 8px; background: #fff; }
        img.qr { width: 60%; margin-left: auto; margin-right: auto; }
        .soort { font-size: 13px; color: var(--secondary-text-color); margin-top: 8px; }
        .melding { font-size: 14px; color: var(--warning-color, #d97706); margin-top: 8px; }
        .zeker { margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--secondary-background-color, #f3f3f3); }
        .zeker p { margin: 0 0 10px; }
        .zeker .rij { display: flex; gap: 10px; }
        .zeker button { flex: 1; font: inherit; font-size: 15px; padding: 10px; border-radius: 8px; cursor: pointer; border: none; }
        .zeker .ja { background: var(--error-color, #db4437); color: #fff; }
        .zeker .nee { background: transparent; border: 1px solid var(--divider-color, #ccc); color: var(--primary-text-color); }
        .leeg { padding: 16px; color: var(--secondary-text-color); }
      </style>
      ${kaarten.length ? kaarten.map((k, i) => `
        <ha-card class="kaart ${this._isOpen(k.naam) ? "" : "ingeklapt"}" id="kaart-${i}">
          <div class="kop">
            <h2 class="titel" data-i="${i}" role="button" aria-expanded="${this._isOpen(k.naam)}"><ha-icon icon="mdi:chevron-down"></ha-icon>${esc(k.naam)}</h2>
            <button class="bewerk" data-i="${i}" title="Wijzigen" aria-label="${esc(k.naam)} wijzigen"><ha-icon icon="mdi:pencil"></ha-icon></button>
            <button class="weg" data-i="${i}" title="Verwijderen" aria-label="${esc(k.naam)} verwijderen"><ha-icon icon="mdi:delete"></ha-icon></button>
          </div>
          <div class="zeker" id="zeker-${i}" hidden>
            <p>Weet je zeker dat je <b>${esc(k.naam)}</b> wilt verwijderen?</p>
            <div class="rij"><button class="nee" data-i="${i}">Annuleren</button><button class="ja" data-i="${i}">Verwijderen</button></div>
          </div>
          <div class="inhoud">
          ${k.barcode ? `<img src="${esc(k.barcode)}" alt="${esc(k.naam)}" class="${k.soort === "QR-code" ? "qr" : ""}">` : ""}
          ${k.foto ? `<img src="${esc(k.foto)}" alt="${esc(k.naam)}">` : ""}
          ${k.melding ? `<div class="melding">⚠️ ${esc(k.melding)}</div>` : ""}
          ${k.soort ? `<div class="soort">${esc(k.soort)}</div>` : ""}
          </div>
        </ha-card>`).join("") : `<ha-card class="leeg">Nog geen klantkaarten. Tik rechtsonder op <b>+</b> om er een toe te voegen.</ha-card>`}`;
    const root = this.shadowRoot;
    root.querySelectorAll("h2.titel").forEach((h) => h.addEventListener("click", () => {
      const naam = kaarten[h.dataset.i].naam;
      const open = !this._isOpen(naam);
      this._zetOpen(naam, open);
      root.getElementById(`kaart-${h.dataset.i}`).classList.toggle("ingeklapt", !open);
      h.setAttribute("aria-expanded", open);
    }));
    root.querySelectorAll("button.bewerk").forEach((b) => b.addEventListener("click", () => {
      const k = kaarten[b.dataset.i];
      window.dispatchEvent(new CustomEvent("klantkaart-bewerken", { detail: { naam: k.naam, nummer: k.nummer || "" } }));
    }));
    root.querySelectorAll("button.weg").forEach((b) => b.addEventListener("click", () => {
      root.getElementById(`zeker-${b.dataset.i}`).hidden = false;
    }));
    root.querySelectorAll(".zeker .nee").forEach((b) => b.addEventListener("click", () => {
      root.getElementById(`zeker-${b.dataset.i}`).hidden = true;
    }));
    root.querySelectorAll(".zeker .ja").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Bezig…";
      try {
        await this._hass.callService("klantkaarten", "verwijderen", { naam: kaarten[b.dataset.i].naam });
      } catch (fout) {
        b.disabled = false; b.textContent = "Verwijderen";
        alert(`Verwijderen mislukt: ${fout.message || fout}`);
      }
    }));
  }

  // Welke kaarten open staan, per apparaat onthouden (standaard ingeklapt).
  _openLijst() {
    if (!this._open) {
      try { this._open = new Set(JSON.parse(localStorage.getItem("klantkaarten-open") || "[]")); }
      catch (e) { this._open = new Set(); }
    }
    return this._open;
  }
  _isOpen(naam) { return this._openLijst().has(naam.toLowerCase()); }
  _zetOpen(naam, open) {
    const lijst = this._openLijst();
    open ? lijst.add(naam.toLowerCase()) : lijst.delete(naam.toLowerCase());
    try { localStorage.setItem("klantkaarten-open", JSON.stringify([...lijst])); } catch (e) { /* privémodus */ }
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, rows: "auto" }; }
}

customElements.define("klantkaarten-lijst-card", KlantkaartenLijstCard);
customElements.define("klantkaart-camera-card", KlantkaartCameraCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "klantkaart-camera-card", name: "Klantkaart toevoegen",
  description: "Ronde +-knop rechtsonder om een klantkaart toe te voegen (nummer of camerafoto)." });
window.customCards.push({ type: "klantkaarten-lijst-card", name: "Klantkaarten",
  description: "Alle klantkaarten met potloodje (wijzigen) en prullenbak (verwijderen)." });
