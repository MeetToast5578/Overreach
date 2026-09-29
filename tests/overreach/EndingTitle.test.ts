import { describe, expect, test, vi } from "vitest";

// translateText returns the key with its params, so the test reads which
// title was picked.
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, p?: Record<string, string>) =>
    `${key}(${p?.name ?? ""})`,
}));

import { endingTitle } from "../../src/client/overreach/EndingTitle";
import {
  provinceLayer,
  startProvinceLayer,
} from "../../src/client/overreach/ProvinceLayer";
import type { GameView } from "../../src/client/view";

const france = { isPlayer: () => true, displayName: () => "France" };
const game = (me: unknown) =>
  ({
    playerBySmallID: (id: number) => (id === 7 ? france : null),
    myPlayer: () => me,
  }) as unknown as GameView;

describe("endingTitle", () => {
  test("names the ending, and says 'you' to the winner", () => {
    startProvinceLayer(10, 10);
    expect(endingTitle(game(null))).toBeNull();
    provinceLayer!.ending = { kind: "domination", winner: 7 };
    expect(endingTitle(game(null))).toBe("ending.domination(France)");
    expect(endingTitle(game(france))).toBe("ending.domination_you(France)");
    provinceLayer!.ending = { kind: "winter", winner: 0 };
    expect(endingTitle(game(france))).toBe("ending.winter()");
  });
});
