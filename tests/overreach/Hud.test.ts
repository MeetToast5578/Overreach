import { describe, expect, test } from "vitest";
import {
  alertsFor,
  coalitionAgainst,
  ShowEventAlertEvent,
} from "../../src/client/overreach/Alerts";
import { troopCapParts } from "../../src/client/overreach/TopBar";

describe("the alerts row", () => {
  const name2 = (id: number) => ["nobody", "France", "Prussia"][id] ?? "?";
  const name = (id: number) => name2(id);

  test("nothing to say is no alerts", () => {
    expect(
      alertsFor({
        formable: [],
        event: null,
        coalition: [],
        name,
        form: () => {},
        showEvent: () => {},
        showCoalition: () => {},
      }),
    ).toEqual([]);
  });

  test("a formable is the crown, and forming is one click", () => {
    // translateText returns the key itself in tests (no language is loaded), so
    // these check which text is asked for; the names go in as parameters.
    const formed: string[] = [];
    const alerts = alertsFor({
      formable: [{ id: "germany", name: "Germany" }],
      event: null,
      coalition: [],
      name,
      form: (id) => formed.push(id),
      showEvent: () => {},
      showCoalition: () => {},
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("formable");
    expect(alerts[0].label).toBe("alerts.formable");
    expect(alerts[0].title).toBe("alerts.formable_tip");
    alerts[0].act?.();
    expect(formed).toEqual(["germany"]);
  });

  test("a waiting event names the event's own title", () => {
    const shown: number[] = [];
    const alerts = alertsFor({
      formable: [],
      event: "opium_war",
      coalition: [],
      name,
      form: () => {},
      showEvent: () => shown.push(1),
      showCoalition: () => {},
    });
    expect(alerts.map((a) => a.key)).toEqual(["event"]);
    expect(alerts[0].title).toBe("event.opium_war_title");
    alerts[0].act?.();
    expect(shown).toEqual([1]);
  });

  test("a coalition looks each member's name up and points at the first", () => {
    const shown: number[] = [];
    const asked: number[] = [];
    const alerts = alertsFor({
      formable: [],
      event: null,
      coalition: [1, 2],
      name: (id) => (asked.push(id), name2(id)),
      form: () => {},
      showEvent: () => {},
      showCoalition: (id) => shown.push(id),
    });
    expect(alerts.map((a) => a.key)).toEqual(["coalition"]);
    expect(asked).toEqual([1, 2]);
    expect(alerts[0].title).toBe("alerts.coalition_tip");
    alerts[0].act?.();
    expect(shown).toEqual([1]);
  });

  test("everything at once keeps a stable order: form, event, coalition", () => {
    const alerts = alertsFor({
      formable: [{ id: "italy", name: "Italy" }],
      event: "meiji_restoration",
      coalition: [2],
      name,
      form: () => {},
      showEvent: () => {},
      showCoalition: () => {},
    });
    expect(alerts.map((a) => a.key)).toEqual([
      "formable",
      "event",
      "coalition",
    ]);
  });

  test("the coalition against you is the one aimed at you", () => {
    const coalitions: [number, number[]][] = [
      [3, [1, 2]],
      [2, [1]],
    ];
    expect(coalitionAgainst(coalitions, 2)).toEqual([1]);
    expect(coalitionAgainst(coalitions, 9)).toEqual([]);
  });

  test("the event alert is an event the story panel listens for", () => {
    expect(new ShowEventAlertEvent().type).toBe("overreach-show-event");
  });
});

describe("the troop cap's breakdown", () => {
  test("land and cities add up to the cap the game reports", () => {
    // 2 x (land^0.6 x 1000 + 50,000) + levels x 8,000, as Config.maxTroops builds it.
    const tiles = 16304;
    const levels = 3;
    const increase = 8000;
    const cap = 2 * (Math.pow(tiles, 0.6) * 1000 + 50000) + levels * increase;
    const parts = troopCapParts(tiles, levels, increase, cap);
    expect(parts.land + parts.cities + parts.other).toBe(Math.round(cap));
    expect(parts.cities).toBe(24000);
    expect(parts.other).toBe(0);
  });

  test("a cap that isn't land and cities alone shows the rest as settings", () => {
    const parts = troopCapParts(100, 0, 8000, 999_999);
    expect(parts.other).toBe(999_999 - parts.land - parts.cities);
  });
});
