import { EventBus } from "../core/EventBus";
import {
  GameInfo,
  GameRecord,
  GameStartInfo,
  PublicGameInfo,
} from "../core/Schemas";
import { toWireGameStartInfo } from "../core/Util";
import { UserSettings } from "../core/game/UserSettings";
import { joinLobby, type JoinLobbyResult } from "./ClientGameRunner";
import { GameStartingModal } from "./GameStartingModal";
import { HelpModal } from "./HelpModal";
import { showInGameConfirm } from "./InGameModal";
import "./LangSelector";
import { modalRouter } from "./ModalRouter";
import { initNavigation } from "./Navigation";
import { capturePagePin } from "./PagePin";
import { fallbackPlayerName } from "./PlayerName";
import "./SinglePlayerModal";
import { SinglePlayerModal } from "./SinglePlayerModal";
import "./UserSettingModal";
import {
  flushReloadToast,
  homeHref,
  incrementGamesPlayed,
  translateText,
} from "./Utils";
import "./components/Footer";
import "./components/MainLayout";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import "./overreach/Title";
import "./overreach/overreach.css";
import { initAudioMixer } from "./sound/AudioMixer";
import { startMenuMusic } from "./sound/MenuMusic";
import "./styles.css";
import "./styles/core/typography.css";
import "./styles/core/variables.css";
import "./styles/layout/container.css";
import "./styles/layout/header.css";
import "./styles/modal/chat.css";
import {
  installCtrlWheelZoomBlocker,
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "./utilities/DisableSafariPinchZoom";

declare global {
  interface Window {
    currentPageId?: string;
    showPage?: (pageId: string) => void;
  }

  interface DocumentEventMap {
    "join-lobby": CustomEvent<JoinLobbyEvent>;
    "join-changed": CustomEvent;
    "leave-lobby": CustomEvent;
    "game-starting": CustomEvent;
    "menu-restored": CustomEvent;
  }
}

export interface JoinLobbyEvent {
  // Multiplayer games only have gameID, gameConfig is not known until game starts.
  gameID: string;
  // GameConfig only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
  source?: "public" | "private" | "host" | "matchmaking" | "singleplayer";
  publicLobbyInfo?: GameInfo | PublicGameInfo;
  // Watch without playing.
  spectator?: boolean;
  // Overreach: play under this name, with no clan tag (a scenario nation's).
  playerName?: string;
}

class Client {
  private lobbyHandle: JoinLobbyResult | null = null;
  private eventBus: EventBus = new EventBus();
  private currentUrl: string | null = null;
  private userSettings: UserSettings = new UserSettings();
  private mostRecentJoinEvent = 0;
  private menuTornDown = false;

  initialize(): void {
    capturePagePin();
    flushReloadToast();

    // One mixer for the page: the menu theme here and the SoundManager a game
    // creates later both route through it, so the volume sliders reach both.
    startMenuMusic(initAudioMixer(this.userSettings));

    modalRouter.register("settings", {
      tag: "user-setting",
      pageId: "page-settings",
    });
    modalRouter.register("help", { tag: "help-modal", pageId: "page-help" });
    modalRouter.register("language", {
      tag: "language-modal",
      pageId: "page-language",
    });
    modalRouter.register("single-player", {
      tag: "single-player-modal",
      pageId: "page-single-player",
    });
    modalRouter.register("troubleshooting", {
      tag: "troubleshooting-modal",
      pageId: "page-troubleshooting",
    });

    window.addEventListener("beforeunload", () => {
      this.lobbyHandle?.stop(true);
    });

    document.addEventListener("join-lobby", (event) => {
      void this.handleJoinLobby(event);
    });
    document.addEventListener("leave-lobby", () => this.handleLeaveLobby());

    const hlpModal = document.querySelector("help-modal") as HelpModal;
    document.getElementById("help-button")?.addEventListener("click", () => {
      if (hlpModal instanceof HelpModal) hlpModal.open();
    });
    // Tutorial entry points (help page): a default solo game with the guide on.
    document.addEventListener("start-tutorial", () => {
      if (hlpModal?.isOpen()) hlpModal.close();
      void (
        document.querySelector("single-player-modal") as SinglePlayerModal
      )?.startTutorial();
    });

    const leaveGame = () => {
      window.location.href = homeHref();
    };

    const onPopState = () => {
      if (this.currentUrl !== null && this.lobbyHandle !== null) {
        if (!this.lobbyHandle.stop()) {
          // We can't block navigation on an async confirmation, so restore the
          // history entry immediately and only leave once the player confirms.
          history.pushState(null, "", this.currentUrl);
          showInGameConfirm(translateText("help_modal.exit_confirmation")).then(
            (isConfirmed) => {
              if (isConfirmed) leaveGame();
            },
          );
          return;
        }
        leaveGame();
      } else {
        onHashUpdate();
      }
    };

    const onHashUpdate = () => {
      // Router-managed hash changes (#modal=...) open or close their modal.
      if (!modalRouter.isHashRouted()) {
        if (window.location.hash.startsWith("#refresh")) leaveGame();
        return;
      }
      modalRouter.routeFromHash();
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashUpdate);
    window.addEventListener("join-changed", () => {
      if (this.lobbyHandle !== null) this.handleLeaveLobby();
      this.handleUrl();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.handleUrl());
    } else {
      this.handleUrl();
    }
  }

  private handleUrl() {
    if (modalRouter.routeFromHash()) return;
    if (window.location.hash.startsWith("#refresh")) {
      window.location.href = homeHref();
    }
  }

  private async handleJoinLobby(event: CustomEvent<JoinLobbyEvent>) {
    const lobby = event.detail;
    this.mostRecentJoinEvent = event.timeStamp;
    console.log(`joining lobby ${lobby.gameID}`);

    if (this.lobbyHandle !== null) {
      this.lobbyHandle.stop(true);
    }

    const newLobbyHandle = joinLobby(this.eventBus, {
      gameID: lobby.gameID,
      cosmetics: {},
      turnstileToken: null,
      playerName: lobby.playerName ?? fallbackPlayerName().name,
      playerClanTag: null,
      playerRole: null,
      gameStartInfo:
        lobby.gameStartInfo ??
        // Replays simulate from the archived record; re-apply the server's
        // wire blanking or team games desync (see toWireGameStartInfo).
        (lobby.gameRecord
          ? toWireGameStartInfo(lobby.gameRecord.info)
          : undefined),
      gameRecord: lobby.gameRecord,
      spectator: lobby.spectator,
    });

    if (this.mostRecentJoinEvent !== event.timeStamp) {
      newLobbyHandle.stop(true);
      console.warn("Join requested, but was superseded");
      return;
    }
    this.lobbyHandle = newLobbyHandle;

    this.lobbyHandle.prestart.then(() => {
      document.dispatchEvent(new CustomEvent("game-starting"));
      [
        "single-player-modal",
        "game-starting-modal",
        "help-modal",
        "user-setting",
        // The in-game instance is addressed by id: querySelector("user-setting")
        // above only ever reaches the page's inline one.
        "#game-settings",
        "troubleshooting-modal",
        "language-modal",
        "lang-selector",
      ].forEach((tag) => {
        const modal = document.querySelector(tag) as HTMLElement & {
          close?: () => void;
          isModalOpen?: boolean;
        };
        if (modal?.close) {
          modal.close();
        } else if (modal && "isModalOpen" in modal) {
          modal.isModalOpen = false;
        }
      });
      this.menuTornDown = true;

      const startingModal = document.querySelector("game-starting-modal");
      if (startingModal instanceof GameStartingModal) startingModal.show();
    });

    this.lobbyHandle.join.then(() => {
      incrementGamesPlayed();
      document.body.classList.add("in-game");

      // Ensure there's a homepage entry in history before adding the game entry.
      if (window.location.hash === "" || window.location.hash === "#") {
        history.replaceState(null, "", window.location.origin + "#refresh");
      }
      history.pushState(null, "", `/game/${lobby.gameID}?live`);
      // Store current URL for popstate confirmation
      this.currentUrl = window.location.href;
    });
  }

  private handleLeaveLobby() {
    this.mostRecentJoinEvent = performance.now();
    if (this.lobbyHandle === null) return;
    this.lobbyHandle.stop(true);
    this.lobbyHandle = null;
    this.currentUrl = null;
    history.replaceState(null, "", "/");
    document.body.classList.remove("in-game");
    if (this.menuTornDown) {
      this.menuTornDown = false;
      // The counterpart to "game-starting": MenuMusic re-arms on it.
      document.dispatchEvent(new CustomEvent("menu-restored"));
    }
  }
}

// Initialize the client when the DOM is loaded
const bootstrap = () => {
  // Prevent Safari's page-level pinch-zoom, which ignores `user-scalable=no`
  // on iOS and can softlock the HUD. See issue #2330.
  installSafariPinchZoomBlocker();

  // Same for double-tap "smart zoom", which `touch-action: manipulation`
  // alone does not reliably stop on iOS. See issue #4609.
  installDoubleTapZoomBlocker();

  // Chrome and Firefox report a trackpad pinch as ctrl+wheel, which only the
  // map canvas cancels — so pinching over a HUD panel zoomed the page instead
  // of the map. See issue #5098.
  installCtrlWheelZoomBlocker();

  new Client().initialize();
  initNavigation();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
