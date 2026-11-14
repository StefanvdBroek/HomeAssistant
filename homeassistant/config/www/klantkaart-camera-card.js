// Kaart "Klantkaart fotograferen" voor het dashboard Klantkaarten.
// Naam van de winkel invullen, op de knop tikken: de camera van de telefoon gaat direct open
// en de foto wordt opgeslagen via /api/klantkaarten/upload (custom_components/klantkaarten).
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
        <div class="titel"><ha-icon icon="mdi:camera"></ha-icon><span>Klantkaart fotograferen</span></div>
        <input type="text" id="naam" placeholder="Naam van de winkel, bijv. IKEA Family" autocomplete="off" enterkeyhint="done">
        <button id="knop">📷 Foto maken</button>
        <input type="file" id="foto" accept="image/*" capture="environment" hidden>
        <div class="status" id="status"></div>
      </ha-card>`;
    this._naam = root.getElementById("naam");
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
      this._melding(`✓ ${json.naam} opgeslagen. De kaart verschijnt zo hieronder.`, "ok");
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
window.customCards.push({ type: "klantkaart-camera-card", name: "Klantkaart fotograferen",
  description: "Maak met de camera een foto van een klantkaart." });
