import type { GameStartInfo } from "../../core/Schemas";
import {
  compressSnapshot,
  decompressSnapshot,
  readSnapshotHeader,
} from "../../core/snapshot/GameSnapshot";
import { ClientEnv } from "../ClientEnv";
import type { GameView } from "../view";

// Saved games (MASTERPLAN.md G2): a core snapshot (see src/core/snapshot) of the running game, gzipped, in
// IndexedDB next to what the client needs to start it again. Loading starts a new game whose worker
// resumes from the snapshot, so nothing is rebuilt mid-game.

export interface SaveRecord {
  id: string; // `${gameID}:manual` or `${gameID}:auto`
  savedAt: number; // ms since 1970
  tick: number;
  nation: string;
  playerName: string;
  info: GameStartInfo;
  bytes: Uint8Array; // the gzipped snapshot
}
export type SaveSummary = Omit<SaveRecord, "bytes">;

const DB = "overreach";
const STORE = "saves";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = f(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// The game being played, for saving it: set when it starts.
let current: { info: GameStartInfo; playerName: string } | null = null;

export function setCurrentGame(info: GameStartInfo, playerName: string): void {
  current = { info, playerName };
}

/** Saves the running game under `kind`, replacing that kind's last save of it. False if nothing to save. */
export async function saveGame(
  game: GameView,
  kind: "manual" | "auto",
): Promise<boolean> {
  if (current === null) return false;
  const raw = await game.worker.snapshot(ClientEnv.gitCommit());
  const bytes = await compressSnapshot(raw);
  const record: SaveRecord = {
    id: `${current.info.gameID}:${kind}`,
    savedAt: Date.now(),
    tick: readSnapshotHeader(raw).tick,
    nation: game.myPlayer()?.displayName() ?? "",
    playerName: current.playerName,
    info: current.info,
    bytes,
  };
  await run("readwrite", (s) => s.put(record));
  return true;
}

/** Every save, newest first (without the snapshots themselves). */
export async function listSaves(): Promise<SaveSummary[]> {
  try {
    const all = await run(
      "readonly",
      (s) => s.getAll() as IDBRequest<SaveRecord[]>,
    );
    return all
      .map(({ bytes: _bytes, ...rest }) => rest)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return []; // no IndexedDB (a private window): nothing saved
  }
}

export async function deleteSave(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

/** Starts a new game from a save; Main's join-lobby handler does the rest. */
export async function loadGame(id: string): Promise<boolean> {
  const record = await run(
    "readonly",
    (s) => s.get(id) as IDBRequest<SaveRecord | undefined>,
  );
  if (record === undefined) return false;
  const raw = await decompressSnapshot(record.bytes);
  document.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail: {
        gameID: record.info.gameID,
        gameStartInfo: record.info,
        source: "singleplayer",
        playerName: record.playerName,
        snapshot: raw,
        snapshotTick: readSnapshotHeader(raw).tick,
      },
    }),
  );
  return true;
}
