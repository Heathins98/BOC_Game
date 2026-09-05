import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider, ScriptedPlayerChoiceProvider } from "../../src/testUtils/scriptedProviders.js";
import { butlerHandler } from "../../src/engine/characters/troubleBrewing/outsiders.js";
import type { NightActionContext } from "../../src/engine/nightAction.js";

function context(overrides: Partial<NightActionContext> & Pick<NightActionContext, "grimoire" | "playerId">): NightActionContext {
  return {
    decisionProvider: new ScriptedDecisionProvider(overrides.grimoire),
    playerChoiceProvider: new ScriptedPlayerChoiceProvider(),
    privateResults: new Map(),
    ...overrides,
  };
}

describe("Butler", () => {
  it("records the chosen master when functioning", async () => {
    const grimoire = buildGrimoire([
      { id: "butler", characterId: "butler" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const ctx = context({ grimoire, playerId: "butler", playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]) });
    await butlerHandler(ctx);
    expect(grimoire.getPlayer("butler").butlerMasterId).toBe("empath");
  });

  it("has no real master when poisoned, even though a choice is still made", async () => {
    const grimoire = buildGrimoire([
      { id: "butler", characterId: "butler" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("butler").poisoned = true;
    const ctx = context({ grimoire, playerId: "butler", playerChoiceProvider: new ScriptedPlayerChoiceProvider(() => ["empath"]) });
    await butlerHandler(ctx);
    expect(grimoire.getPlayer("butler").butlerMasterId).toBeUndefined();
  });
});
