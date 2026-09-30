import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * Overreach's first screen: the game's name and the ways into it. The #modal links
 * are routed by ModalRouter. G2 replaces this with the start-date and nation picker.
 * Its root keeps the id "page-play", which Navigation shows and hides.
 */
@customElement("overreach-title")
export class OverreachTitle extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    const button =
      "w-64 py-3 text-center text-lg tracking-wider uppercase rounded-md border border-amber-200/30 bg-black/40 text-amber-50/90 hover:bg-amber-200/10 hover:border-amber-200/60 transition-colors";
    return html`
      <div
        id="page-play"
        class="flex flex-col items-center justify-center gap-10 w-full min-h-[70vh] px-4"
      >
        <div class="text-center">
          <h1
            class="font-serif text-6xl sm:text-7xl tracking-[0.2em] uppercase text-amber-100 drop-shadow-lg"
          >
            Overreach
          </h1>
          <p class="mt-3 text-amber-50/70 tracking-widest">
            ${translateText("title_screen.tagline")}
          </p>
        </div>
        <nav class="flex flex-col gap-3">
          <a class=${button} href="#modal=single-player">
            ${translateText("title_screen.new_game")}
          </a>
          <a class=${button} href="#modal=single-player&tab=sandbox">
            ${translateText("title_screen.sandbox")}
          </a>
          <a class=${button} href="#modal=help">
            ${translateText("title_screen.help")}
          </a>
          <a class=${button} href="#modal=settings">
            ${translateText("title_screen.settings")}
          </a>
        </nav>
      </div>
    `;
  }
}
