import { describe, expect, it } from "vitest";
import { Rng } from "@boc/shared";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider, ScriptedPlayerChoiceProvider } from "../src/testUtils/scriptedProviders.js";
import { runNight } from "../src/engine/nightEngine.js";
import { applyDeath } from "../src/engine/killResolution.js";
import { TROUBLE_BREWING_NIGHT_HANDLERS } from "../src/engine/characters/troubleBrewing/index.js";
import type { NightActionHandler } from "../src/engine/nightAction.js";

/** Wraps every registered handler so the test can observe exactly which ones actually ran, in order. */
function loggingHandlers(): { handlers: Partial<Record<string, NightActionHandler>>; log: string[] } {
  const log: string[] = [];
  const handlers: Partial<Record<string, NightActionHandler>> = {};
  for (const [characterId, handler] of Object.entries(TROUBLE_BREWING_NIGHT_HANDLERS)) {
    handlers[characterId] = async (ctx) => {
      log.push(characterId);
      return handler!(ctx);
    };
  }
  return { handlers, log };
}

describe("first night order", () => {
  it("runs in-play characters in the documented order, ending with Spy", async () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "washerwoman", characterId: "washerwoman" },
      { id: "librarian", characterId: "librarian" },
      { id: "investigator", characterId: "investigator" },
      { id: "chef", characterId: "chef" },
      { id: "empath", characterId: "empath" },
      { id: "fortune-teller", characterId: "fortune-teller" },
      { id: "butler", characterId: "butler" },
      { id: "spy", characterId: "spy" },
      { id: "imp", characterId: "imp" },
    ]);
    const { handlers, log } = loggingHandlers();
    await runNight({
      grimoire,
      nightNumber: 1,
      rng: new Rng(1),
      decisionProvider: new ScriptedDecisionProvider(grimoire),
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
      handlers,
    });

    expect(log).toEqual([
      "poisoner",
      "washerwoman",
      "librarian",
      "investigator",
      "chef",
      "empath",
      "fortune-teller",
      "butler",
      "spy",
    ]);
  });

  it("still runs the Spy even if they died earlier that day", async () => {
    const grimoire = buildGrimoire([
      { id: "spy", characterId: "spy" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("spy").alive = false;

    const { handlers, log } = loggingHandlers();
    await runNight({
      grimoire,
      nightNumber: 1,
      rng: new Rng(1),
      decisionProvider: new ScriptedDecisionProvider(grimoire),
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
      handlers,
    });

    expect(log).toContain("spy");
  });
});

describe("other night order", () => {
  it("skips Ravenkeeper/Scarlet Woman/Undertaker when their conditions aren't met", async () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "monk", characterId: "monk" },
      { id: "sw", characterId: "scarlet-woman" },
      { id: "imp", characterId: "imp" },
      { id: "rk", characterId: "ravenkeeper" },
      { id: "empath", characterId: "empath" },
      { id: "fortune-teller", characterId: "fortune-teller" },
      { id: "ut", characterId: "undertaker" },
      { id: "butler", characterId: "butler" },
    ]);
    const { handlers, log } = loggingHandlers();
    // The default player-choice resolver targets the first candidate in seat order (the
    // Poisoner) for every prompt, including the Imp's - so the Ravenkeeper (a different
    // player) does not die tonight and their condition stays unmet.
    await runNight({
      grimoire,
      nightNumber: 2,
      rng: new Rng(1),
      decisionProvider: new ScriptedDecisionProvider(grimoire),
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
      handlers,
    });

    expect(grimoire.getPlayer("rk").alive).toBe(true);
    expect(log).toEqual(["poisoner", "monk", "imp", "empath", "fortune-teller", "butler"]);
  });
});

describe("Ravenkeeper/Undertaker conditions", () => {
  it("fire when a night death / today's execution actually happened", async () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "monk", characterId: "monk" },
      { id: "imp", characterId: "imp" },
      { id: "rk", characterId: "ravenkeeper" },
      { id: "empath", characterId: "empath" },
      { id: "fortune-teller", characterId: "fortune-teller" },
      { id: "ut", characterId: "undertaker" },
      { id: "butler", characterId: "butler" },
      { id: "victim", characterId: "saint" },
    ]);
    grimoire.startDay(1);
    applyDeath(grimoire, "victim", "execution"); // sets executedPlayerId, satisfying Undertaker's condition

    const { handlers, log } = loggingHandlers();
    await runNight({
      grimoire,
      nightNumber: 2,
      rng: new Rng(1),
      decisionProvider: new ScriptedDecisionProvider(grimoire),
      playerChoiceProvider: new ScriptedPlayerChoiceProvider((prompt) => (prompt.characterId === "imp" ? ["rk"] : undefined)),
      handlers,
    });

    expect(log).toEqual(["poisoner", "monk", "imp", "ravenkeeper", "empath", "fortune-teller", "undertaker", "butler"]);
  });
});

describe("runNight onResult callback", () => {
  it("delivers a private result the instant it's recorded, not batched until the whole night order finishes", async () => {
    // Regression test: Ravenkeeper (and every other info character) used to have their
    // result withheld in the returned Map until runNight() fully resolved, so a player
    // woken early in the order wouldn't see their info until the rest of the night -
    // including slower players later in the order - finished too.
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "monk", characterId: "monk" },
      { id: "imp", characterId: "imp" },
      { id: "rk", characterId: "ravenkeeper" },
      { id: "empath", characterId: "empath" },
      { id: "fortune-teller", characterId: "fortune-teller" },
      { id: "ut", characterId: "undertaker" },
      { id: "butler", characterId: "butler" },
      { id: "victim", characterId: "saint" },
    ]);
    grimoire.startDay(1);
    applyDeath(grimoire, "victim", "execution");

    const events: string[] = [];
    const handlers: Partial<Record<string, NightActionHandler>> = {};
    for (const [characterId, handler] of Object.entries(TROUBLE_BREWING_NIGHT_HANDLERS)) {
      handlers[characterId] = async (ctx) => {
        events.push(`start:${characterId}`);
        return handler!(ctx);
      };
    }

    await runNight({
      grimoire,
      nightNumber: 2,
      rng: new Rng(1),
      decisionProvider: new ScriptedDecisionProvider(grimoire),
      playerChoiceProvider: new ScriptedPlayerChoiceProvider((prompt) => (prompt.characterId === "imp" ? ["rk"] : undefined)),
      handlers,
      onResult: (playerId) => events.push(`result:${playerId}`),
    });

    const ravenkeeperResult = events.indexOf("result:rk");
    const empathStart = events.indexOf("start:empath");
    expect(ravenkeeperResult).toBeGreaterThanOrEqual(0);
    expect(ravenkeeperResult).toBeLessThan(empathStart);
  });
});
