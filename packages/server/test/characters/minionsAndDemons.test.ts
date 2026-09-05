import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider, ScriptedPlayerChoiceProvider } from "../../src/testUtils/scriptedProviders.js";
import { poisonerHandler } from "../../src/engine/characters/troubleBrewing/minions.js";
import { impHandler } from "../../src/engine/characters/troubleBrewing/demons.js";
import type { NightActionContext } from "../../src/engine/nightAction.js";

function context(overrides: Partial<NightActionContext> & Pick<NightActionContext, "grimoire" | "playerId">): NightActionContext {
  return {
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
