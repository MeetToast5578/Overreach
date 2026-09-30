import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { startYear } from "../../core/overreach/Calendar";
import { translateText } from "../Utils";
import { dateText } from "./DateText";
import { deleteSave, listSaves, loadGame, type SaveSummary } from "./Saves";

/**
 * Overreach's first screen: the game's name and the ways into it, and the games you saved. The
 * #modal links are routed by ModalRouter. G2 replaces the new-game link with the start-date and
 * nation picker. Its root keeps the id "page-play", which Navigation shows and hides.
 */
@customElement("overreach-title")
export class OverreachTitle extends LitElement {
  @state() private saves: SaveSummary[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  private async refresh() {
    this.saves = await listSaves();
  }

  private async forget(id: string) {
    await deleteSave(id);
    await this.refresh();
  }

  private savedGame(s: SaveSummary) {
    const start = startYear(s.info.config);
    const when = start === null ? "" : dateText(start, s.tick).text;
    const kind = translateText(
      `gsg.${s.id.endsWith(":auto") ? "autosave" : "manual_save"}`,
    );
    return html`<div
      class="flex items-center gap-2 rounded border border-amber-200/20 bg-black/40 px-3 py-1.5 text-sm text-amber-50/90 hover:bg-amber-200/10"
    >
      <button class="flex-1 text-left" @click=${() => loadGame(s.id)}>
        <span class="ov-title">${s.nation || s.playerName}</span>
        <span class="text-white/60"> · ${when} · ${kind}</span>
      </button>
      <button
        class="px-1 text-white/40 hover:text-white"
        title=${translateText("gsg.delete_save")}
        @click=${() => this.forget(s.id)}
      >
        ✕
      </button>
    </div>`;
  }

  render() {
    const button =
      "w-64 py-3 text-center text-lg tracking-wider uppercase rounded-md border border-amber-200/30 bg-black/40 text-amber-50/90 hover:bg-amber-200/10 hover:border-amber-200/60 transition-colors";
    const latest = this.saves[0];
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
          ${latest
            ? html`<button class=${button} @click=${() => loadGame(latest.id)}>
                ${translateText("title_screen.continue")}
              </button>`
            : nothing}
          <a class=${button} href="#modal=new-game">
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
        ${this.saves.length > 0
          ? html`<div class="flex w-full max-w-lg flex-col gap-1.5">
              <div class="ov-title text-sm uppercase tracking-widest">
                ${translateText("title_screen.saved_games")}
              </div>
              ${this.saves.slice(0, 6).map((s) => this.savedGame(s))}
            </div>`
          : nothing}
      </div>
    `;
  }
}
