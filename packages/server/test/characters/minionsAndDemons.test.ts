import { describe, expect, it } from "vitest";
import { Rng, type SpyGrimoireResult } from "@boc/shared";
import { buildGrimoire } from "../../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider, ScriptedPlayerChoiceProvider } from "../../src/testUtils/scriptedProviders.js";
import { poisonerHandler, spyHandler } from "../../src/engine/characters/troubleBrewing/minions.js";
import { impHandler } from "../../src/engine/characters/troubleBrewing/demons.js";
import type { NightActionContext } from "../../src/engine/nightAction.js";

function context(overrides: Partial<NightActionContext> & Pick<NightActionContext, "grimoire" | "playerId">): NightActionContext {
  return {
    rng: new Rng(1),
    decisionProvider: new ScriptedDecisionProvider(overrides.grimoire),
    playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
    privateResults: new Map(),
    ...overrides,
  };
}

describe("Poisoner", () => {
  it("poisons the chosen target", async () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({ grimoire, playerId: "poisoner", playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]) });
    await poisonerHandler(ctx);
    expect(grimoire.getPlayer("empath").poisoned).toBe(true);
  });
});

describe("Spy", () => {
  it("shows the true board when healthy", async () => {
    const grimoire = buildGrimoire([
      { id: "spy", characterId: "spy" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
      { id: "monk", characterId: "monk" },
    ]);
    const ctx = context({ grimoire, playerId: "spy" });
    await spyHandler(ctx);
    const result = ctx.privateResults.get("spy") as SpyGrimoireResult;

    expect(result.kind).toBe("grimoire");
    expect(result.redHerringId).toBe(grimoire.redHerringId);
    expect(result.players.map((p) => p.characterId).sort()).toEqual(["empath", "imp", "monk", "spy"]);
    for (const row of result.players) {
      expect(row.characterId).toBe(grimoire.getPlayer(row.id).characterId);
      expect(row.alignment).toBe(grimoire.getPlayer(row.id).alignment);
    }
  });

  it("shows a fabricated, fully-deranged board when poisoned - same cast, nobody keeps their true character", async () => {
    const grimoire = buildGrimoire([
      { id: "spy", characterId: "spy" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
      { id: "monk", characterId: "monk" },
    ]);
    grimoire.getPlayer("spy").poisoned = true;
    const ctx = context({ grimoire, playerId: "spy" });
    await spyHandler(ctx);
    const result = ctx.privateResults.get("spy") as SpyGrimoireResult;

    expect(result.kind).toBe("grimoire");
    // Same set of in-play characters - just reassigned, nothing invented.
    expect(result.players.map((p) => p.characterId).sort()).toEqual(["empath", "imp", "monk", "spy"]);
    // Every player shows as a different character than their true one.
    for (const row of result.players) {
      expect(row.characterId).not.toBe(grimoire.getPlayer(row.id).characterId);
    }
  });

  it("still shows the true board for a dead-but-healthy Spy", async () => {
    const grimoire = buildGrimoire([
      { id: "spy", characterId: "spy" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("spy").alive = false;
    const ctx = context({ grimoire, playerId: "spy" });
    await spyHandler(ctx);
    const result = ctx.privateResults.get("spy") as SpyGrimoireResult;

    const spyRow = result.players.find((p) => p.id === "spy");
    expect(spyRow?.characterId).toBe("spy");
    expect(spyRow?.alive).toBe(false);
  });
});

describe("Imp", () => {
  it("kills a chosen non-self target via the demon-kill pipeline", async () => {
    const grimoire = buildGrimoire([
      { id: "imp", characterId: "imp" },
      { id: "empath", characterId: "empath" },
    ]);
    const ctx = context({ grimoire, playerId: "imp", playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]) });
    await impHandler(ctx);
    expect(grimoire.getPlayer("empath").alive).toBe(false);
    expect(grimoire.getPlayer("imp").alive).toBe(true);
  });

  it("dies and promotes a living Minion to Imp on self-kill", async () => {
    const grimoire = buildGrimoire([
      { id: "imp", characterId: "imp" },
      { id: "poisoner", characterId: "poisoner" },
      { id: "empath", characterId: "empath" },
    ]);
    const ctx = context({
      grimoire,
      playerId: "imp",
      playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["imp"]),
      decisionProvider: new ScriptedDecisionProvider(grimoire, { choosePromotedMinion: async (candidates) => candidates[0]! }),
    });
    await impHandler(ctx);
    expect(grimoire.getPlayer("imp").alive).toBe(false);
    expect(grimoire.getPlayer("poisoner").characterId).toBe("imp");
  });

  it("does not kill when poisoned", async () => {
    const grimoire = buildGrimoire([
      { id: "imp", characterId: "imp" },
      { id: "empath", characterId: "empath" },
    ]);
    grimoire.getPlayer("imp").poisoned = true;
    const ctx = context({ grimoire, playerId: "imp", playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]) });
    await impHandler(ctx);
    expect(grimoire.getPlayer("empath").alive).toBe(true);
  });
});
