import { describe, expect, it } from "vitest";
import type { InfoClueResult } from "@boc/shared";
import { buildGrimoire } from "../../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider, ScriptedPlayerChoiceProvider } from "../../src/testUtils/scriptedProviders.js";
import {
  chefHandler,
  empathHandler,
  fortuneTellerHandler,
  investigatorHandler,
  librarianHandler,
  monkHandler,
  ravenkeeperHandler,
  undertakerHandler,
  washerwomanHandler,
} from "../../src/engine/characters/troubleBrewing/townsfolk.js";
import type { NightActionContext } from "../../src/engine/nightAction.js";

function context(
  overrides: Partial<NightActionContext> & Pick<NightActionContext, "grimoire" | "playerId">,
): NightActionContext {
  return {
    decisionProvider: new ScriptedDecisionProvider(overrides.grimoire),
    playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
    privateResults: new Map(),
    ...overrides,
  };
}

describe("Washerwoman", () => {
  it("shows a true Townsfolk + decoy pair when healthy", async () => {
    const grimoire = buildGrimoire([
      { id: "ww", characterId: "washerwoman" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
      { id: "poisoner", characterId: "poisoner" },
    ]);
    const ctx = context({ grimoire, playerId: "ww" });
    await washerwomanHandler(ctx);
    const result = ctx.privateResults.get("ww") as InfoClueResult;
    expect(result).toEqual({ kind: "pair", shownCharacterId: "empath", players: ["empath", expect.any(String)] });
  });

  it("never reveals itself as the true Townsfolk", async () => {
    const grimoire = buildGrimoire([
      { id: "ww", characterId: "washerwoman" },
      { id: "imp", characterId: "imp" },
      { id: "poisoner", characterId: "poisoner" },
    ]);
    // No other Townsfolk in play besides the Washerwoman herself.
    const ctx = context({ grimoire, playerId: "ww" });
    await washerwomanHandler(ctx);
    expect(ctx.privateResults.get("ww")).toEqual({ kind: "none" });
  });

  it("fabricates a result when poisoned", async () => {
    const grimoire = buildGrimoire([
      { id: "ww", characterId: "washerwoman" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("ww").poisoned = true;
    const ctx = context({
      grimoire,
      playerId: "ww",
      decisionProvider: new ScriptedDecisionProvider(grimoire, {
        fabricateInfoClue: async () => ({ kind: "pair", shownCharacterId: "chef", players: ["imp", "empath"] }),
      }),
    });
    await washerwomanHandler(ctx);
    expect(ctx.privateResults.get("ww")).toEqual({ kind: "pair", shownCharacterId: "chef", players: ["imp", "empath"] });
  });
});

describe("Librarian", () => {
  it("reports zero Outsiders in play", async () => {
    const grimoire = buildGrimoire([
      { id: "lib", characterId: "librarian" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({ grimoire, playerId: "lib" });
    await librarianHandler(ctx);
    expect(ctx.privateResults.get("lib")).toEqual({ kind: "none" });
  });

  it("shows the Drunk's fake Townsfolk identity, not 'drunk'", async () => {
    const grimoire = buildGrimoire([
      { id: "lib", characterId: "librarian" },
      { id: "drunky", characterId: "drunk" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("drunky").drunkShowsAsCharacterId = "chef";
    const ctx = context({ grimoire, playerId: "lib" });
    await librarianHandler(ctx);
    const result = ctx.privateResults.get("lib") as InfoClueResult;
    expect(result).toMatchObject({ kind: "pair", shownCharacterId: "chef" });
  });
});

describe("Investigator", () => {
  it("shows a true Minion + decoy pair", async () => {
    const grimoire = buildGrimoire([
      { id: "inv", characterId: "investigator" },
      { id: "poisoner", characterId: "poisoner" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({ grimoire, playerId: "inv" });
    await investigatorHandler(ctx);
    expect(ctx.privateResults.get("inv")).toMatchObject({ kind: "pair", shownCharacterId: "poisoner" });
  });
});

describe("Chef", () => {
  it("counts adjacent evil pairs around the circle, including wraparound", async () => {
    // Seating: chef, poisoner(evil), imp(evil), empath(good), spy(evil) -> pairs: (poisoner,imp) and (spy,chef)? chef is good.
    // Adjacent evil pairs here: (poisoner,imp) and (imp, empath)=no, (spy, chef)=no since chef good. Wraps: (spy -> chef) no.
    const grimoire = buildGrimoire([
      { id: "chef", characterId: "chef" },
      { id: "poisoner", characterId: "poisoner" },
      { id: "imp", characterId: "imp" },
      { id: "empath", characterId: "empath" },
      { id: "spy", characterId: "spy" },
    ]);
    const ctx = context({ grimoire, playerId: "chef" });
    await chefHandler(ctx);
    expect(ctx.privateResults.get("chef")).toBe(1);
  });

  it("counts a misregistering Recluse as evil when the Storyteller says so", async () => {
    const grimoire = buildGrimoire([
      { id: "chef", characterId: "chef" },
      { id: "recluse", characterId: "recluse" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({
      grimoire,
      playerId: "chef",
      decisionProvider: new ScriptedDecisionProvider(grimoire, { resolveMisregistration: async () => true }),
    });
    await chefHandler(ctx);
    // recluse-imp adjacent (both count as evil) and imp-chef adjacent (chef good) -> 1 pair
    expect(ctx.privateResults.get("chef")).toBe(1);
  });
});

describe("Empath", () => {
  it("counts evil among the two nearest living neighbors, skipping the dead", async () => {
    const grimoire = buildGrimoire([
      { id: "empath", characterId: "empath" },
      { id: "deadTownsfolk", characterId: "monk" },
      { id: "imp", characterId: "imp" },
      { id: "poisoner", characterId: "poisoner" },
    ]);
    grimoire.getPlayer("deadTownsfolk").alive = false;
    const ctx = context({ grimoire, playerId: "empath" });
    await empathHandler(ctx);
    // Living neighbors of empath (skipping deadTownsfolk) are poisoner and imp - both evil.
    expect(ctx.privateResults.get("empath")).toBe(2);
  });

  it("fabricates a number when drunk", async () => {
    const grimoire = buildGrimoire([
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
      { id: "poisoner", characterId: "poisoner" },
    ]);
    grimoire.getPlayer("empath").drunk = true;
    const ctx = context({
      grimoire,
      playerId: "empath",
      decisionProvider: new ScriptedDecisionProvider(grimoire, { fabricateNumber: async () => 0 }),
    });
    await empathHandler(ctx);
    expect(ctx.privateResults.get("empath")).toBe(0);
  });
});

describe("Fortune Teller", () => {
  it("detects the real Demon", async () => {
    const grimoire = buildGrimoire([
      { id: "ft", characterId: "fortune-teller" },
      { id: "imp", characterId: "imp" },
      { id: "empath", characterId: "empath" },
    ]);
    const ctx = context({
      grimoire,
      playerId: "ft",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["imp", "empath"]),
    });
    await fortuneTellerHandler(ctx);
    expect(ctx.privateResults.get("ft")).toBe(true);
  });

  it("detects the Red Herring even though they're good and the other target isn't the Demon", async () => {
    const grimoire = buildGrimoire([
      { id: "ft", characterId: "fortune-teller" },
      { id: "empath", characterId: "empath" },
      { id: "monk", characterId: "monk" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.redHerringId = "empath";
    const ctx = context({
      grimoire,
      playerId: "ft",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath", "monk"]),
    });
    await fortuneTellerHandler(ctx);
    expect(ctx.privateResults.get("ft")).toBe(true);
  });

  it("fabricates a result when poisoned, regardless of the true targets", async () => {
    const grimoire = buildGrimoire([
      { id: "ft", characterId: "fortune-teller" },
      { id: "imp", characterId: "imp" },
      { id: "empath", characterId: "empath" },
    ]);
    grimoire.getPlayer("ft").poisoned = true;
    const ctx = context({
      grimoire,
      playerId: "ft",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["imp", "empath"]),
      decisionProvider: new ScriptedDecisionProvider(grimoire, { fabricateBoolean: async () => false }),
    });
    await fortuneTellerHandler(ctx);
    expect(ctx.privateResults.get("ft")).toBe(false);
  });
});

describe("Undertaker", () => {
  it("shows the executed player's true character", async () => {
    const grimoire = buildGrimoire([
      { id: "undertaker", characterId: "undertaker" },
      { id: "saint", characterId: "saint" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.executedPlayerId = "saint";
    const ctx = context({ grimoire, playerId: "undertaker" });
    await undertakerHandler(ctx);
    expect(ctx.privateResults.get("undertaker")).toBe("saint");
  });
});

describe("Monk", () => {
  it("marks the chosen player protected for the night", async () => {
    const grimoire = buildGrimoire([
      { id: "monk", characterId: "monk" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({
      grimoire,
      playerId: "monk",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]),
    });
    await monkHandler(ctx);
    expect(grimoire.getPlayer("empath").protectedTonight).toBe(true);
  });

  it("silently fails to protect when poisoned", async () => {
    const grimoire = buildGrimoire([
      { id: "monk", characterId: "monk" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("monk").poisoned = true;
    const ctx = context({
      grimoire,
      playerId: "monk",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]),
    });
    await monkHandler(ctx);
    expect(grimoire.getPlayer("empath").protectedTonight).toBe(false);
  });
});

describe("Ravenkeeper", () => {
  it("learns the chosen player's true character when triggered by a night death", async () => {
    const grimoire = buildGrimoire([
      { id: "rk", characterId: "ravenkeeper" },
      { id: "saint", characterId: "saint" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startNight(2);
    grimoire.markDead("rk");
    const ctx = context({
      grimoire,
      playerId: "rk",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["saint"]),
    });
    await ravenkeeperHandler(ctx);
    expect(ctx.privateResults.get("rk")).toBe("saint");
  });
});
