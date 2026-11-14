// Kaart "Klantkaart toevoegen" voor het dashboard Klantkaarten.
// Toont alleen een ronde +-knop rechtsonder in beeld; die opent een paneel met:
//  - winkel + kaartnummer + "Opslaan": wordt een barcode (komt in de lijst todo.klantkaarten), of
//  - winkel + "Foto maken": de camera van de telefoon gaat direct open; de foto gaat naar
//    /api/klantkaarten/upload (custom_components/klantkaarten), die de barcode/QR-code eruit leest.
//
// De knop en het paneel hangen aan document.body (zodat "rechtsonder" altijd het scherm is en niet
// de kaart), en verdwijnen weer als het dashboard wordt verlaten.
//
// Gebruik:  type: custom:klantkaart-camera-card

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
          <div class="kop"><span>Klantkaart toevoegen</span><button class="sluit" id="sluit" aria-label="Sluiten">×</button></div>
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
    document.body.appendChild(this._laag);
  }

  disconnectedCallback() {
    // Dashboard verlaten: knop en paneel weghalen.
    if (this._laag) { this._laag.remove(); this._laag = null; }
  }

  _open() {
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
    if (!nummer) { this._melding("Vul het kaartnummer in, of tik op Foto maken.", "fout"); this._nummer.focus(); return; }
    this._opslaan.disabled = true;
    this._melding("Bezig met opslaan…");
    try {
      await this._hass.callService("todo", "add_item", { item: naam, description: nummer },
                                   { entity_id: "todo.klantkaarten" });
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

customElements.define("klantkaart-camera-card", KlantkaartCameraCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "klantkaart-camera-card", name: "Klantkaart toevoegen",
  description: "Ronde +-knop rechtsonder om een klantkaart toe te voegen (nummer of camerafoto)." });
