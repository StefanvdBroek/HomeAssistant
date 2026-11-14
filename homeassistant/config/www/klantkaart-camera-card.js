// Kaart "Klantkaart toevoegen" voor het dashboard Klantkaarten.
// Winkel invullen en dan:
//  - kaartnummer invullen + "Opslaan": wordt een barcode (komt in de lijst todo.klantkaarten), of
//  - "Foto maken": de camera van de telefoon gaat direct open; de foto gaat naar
//    /api/klantkaarten/upload (custom_components/klantkaarten), die de barcode/QR-code eruit leest.
//
// Gebruik:  type: custom:klantkaart-camera-card

class KlantkaartCameraCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        .titel { font-size: 16px; font-weight: 500; margin-bottom: 12px; display: flex; gap: 8px; align-items: center; }
        input[type=text] {
          width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 12px;
          border-radius: 10px; border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff); color: var(--primary-text-color, #000);
        }
        .veld { margin-top: 10px; }
        .knoppen { display: flex; gap: 10px; }
        .knoppen button { flex: 1; }
        button.tweede { background: var(--secondary-background-color, #eee); color: var(--primary-text-color, #000); }
        button {
          margin-top: 12px; width: 100%; font: inherit; font-size: 16px; font-weight: 500; padding: 14px;
          border: none; border-radius: 10px; cursor: pointer;
          background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff);
        }
        button[disabled] { opacity: .6; cursor: default; }
        .status { margin-top: 10px; min-height: 1.2em; font-size: 14px; color: var(--secondary-text-color); }
        .status.fout { color: var(--error-color, #db4437); }
        .status.ok { color: var(--success-color, #43a047); }
      </style>
      <ha-card>
        <div class="titel"><ha-icon icon="mdi:card-plus"></ha-icon><span>Klantkaart toevoegen</span></div>
        <input type="text" id="naam" placeholder="Winkel, bijv. Albert Heijn" autocomplete="off" enterkeyhint="next">
        <input type="text" id="nummer" class="veld" placeholder="Kaartnummer (of laat leeg en maak een foto)"
               autocomplete="off" inputmode="text" enterkeyhint="done">
        <div class="knoppen">
          <button id="opslaan">💾 Opslaan</button>
          <button id="knop" class="tweede">📷 Foto maken</button>
        </div>
        <input type="file" id="foto" accept="image/*" capture="environment" hidden>
        <div class="status" id="status"></div>
      </ha-card>`;
    this._naam = root.getElementById("naam");
    this._nummer = root.getElementById("nummer");
    this._opslaan = root.getElementById("opslaan");
    this._opslaan.addEventListener("click", () => this._bewaarNummer());
    this._nummer.addEventListener("keydown", (e) => { if (e.key === "Enter") this._bewaarNummer(); });
    this._knop = root.getElementById("knop");
    this._foto = root.getElementById("foto");
    this._status = root.getElementById("status");
    this._knop.addEventListener("click", () => this._start());
    this._foto.addEventListener("change", () => this._upload());
  }

  set hass(hass) { this._hass = hass; }

  _melding(tekst, soort = "") {
    this._status.textContent = tekst;
    this._status.className = "status " + soort;
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
      this._melding(`✓ ${naam} opgeslagen. De kaart verschijnt zo hieronder.`, "ok");
      this._naam.value = ""; this._nummer.value = "";
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
    this._melding("Bezig met opslaan…");
    try {
      const antwoord = await this._hass.fetchWithAuth("/api/klantkaarten/upload", { method: "POST", body: data });
      const json = await antwoord.json().catch(() => ({}));
      if (!antwoord.ok) throw new Error(json.message || `fout ${antwoord.status}`);
      if (json.gelezen) {
        this._melding(`✓ ${json.soort === "QR-code" ? "QR-code" : "Barcode"} van ${json.naam} gelezen. De kaart verschijnt zo hieronder.`, "ok");
      } else {
        this._melding(`Geen barcode gevonden op de foto; de foto van ${json.naam} is bewaard. Tip: fotografeer de barcode recht en van dichtbij, of vul het nummer in.`, "fout");
      }
      this._naam.value = "";
    } catch (fout) {
      this._melding(`Opslaan mislukt: ${fout.message}`, "fout");
    } finally {
      this._knop.disabled = false;
    }
  }

  getCardSize() { return 3; }
  getGridOptions() { return { columns: 12, rows: "auto", min_rows: 3 }; }
}

customElements.define("klantkaart-camera-card", KlantkaartCameraCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "klantkaart-camera-card", name: "Klantkaart toevoegen",
  description: "Klantkaart toevoegen met een kaartnummer of een foto van de camera." });
