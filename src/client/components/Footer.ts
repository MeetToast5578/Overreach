import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentGameVersion } from "../GameVersion";

// AGPL-3.0: the game shows a link to its source once anyone else can play it.
const SOURCE_URL = "https://github.com/MeetToast5578/Overreach";
const OPENFRONT_URL = "https://github.com/openfrontio/OpenFrontIO";

@customElement("page-footer")
export class Footer extends LitElement {
  // Per instance, not at module scope: currentGameVersion reads
  // BOOTSTRAP_CONFIG, which the server injects into the page and which is not
  // guaranteed to exist at the moment this module is first imported.
  private readonly gameVersion = currentGameVersion();

  createRenderRoot() {
    return this;
  }

  render() {
    const link = "hover:text-white transition-colors";
    return html`
      <footer
        class="[.in-game_&]:hidden bg-zinc-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-1 py-3 text-white/50 w-full border-t border-white/10 shrink-0 relative z-50"
      >
        <div class="footer-version text-xs text-center px-4">
          ${this.gameVersion}
        </div>
        <div
          class="text-xs flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4"
        >
          <span data-i18n="main.copyright"></span>
          <a
            class=${link}
            href=${OPENFRONT_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-i18n="main.built_on"
          ></a>
          <a
            class=${link}
            href=${SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-i18n="main.source"
          ></a>
        </div>

        <!-- Single instance: translateText() resolves the active language via
             document.querySelector("lang-selector"), so a second one would
             shadow it. -->
        <lang-selector
          class="absolute right-4 top-1/2 -translate-y-1/2"
        ></lang-selector>
      </footer>
    `;
  }
}
