import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { applyDeath } from "../src/engine/killResolution.js";
import { checkSaintExecutionLoss, checkWinConditions } from "../src/engine/winConditions.js";

describe("checkWinConditions", () => {
  it("Good wins when the Demon has died", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    applyDeath(grimoire, "imp", "execution");
    expect(checkWinConditions(grimoire)?.winner).toBe("good");
  });

  it("Evil wins when only 2 players remain alive", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "imp", characterId: "imp" },
    ]);
    applyDeath(grimoire, "a", "execution");
    expect(checkWinConditions(grimoire)?.winner).toBe("evil");
  });

  it("nobody has won yet with 3+ alive and a living Demon", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    expect(checkWinConditions(grimoire)).toBeNull();
  });

  it("Good wins via the Mayor with 3 alive and no execution today", () => {
    const grimoire = buildGrimoire([
      { id: "mayor", characterId: "mayor" },
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const result = checkWinConditions(grimoire);
    expect(result?.winner).toBe("good");
  });

  it("does not trigger the Mayor's win when the Mayor is poisoned", () => {
    const grimoire = buildGrimoire([
      { id: "mayor", characterId: "mayor" },
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("mayor").poisoned = true;
    grimoire.startDay(1);
    expect(checkWinConditions(grimoire)).toBeNull();
  });
});

describe("checkSaintExecutionLoss", () => {
  it("Evil wins when the Saint is executed", () => {
    const grimoire = buildGrimoire([
      { id: "saint", characterId: "saint" },
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    applyDeath(grimoire, "saint", "execution");
    expect(checkSaintExecutionLoss(grimoire, "saint")?.winner).toBe("evil");
  });

  it("no effect when a poisoned Saint is executed", () => {
    const grimoire = buildGrimoire([
      { id: "saint", characterId: "saint" },
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("saint").poisoned = true;
    applyDeath(grimoire, "saint", "execution");
    expect(checkSaintExecutionLoss(grimoire, "saint")).toBeNull();
  });
});
