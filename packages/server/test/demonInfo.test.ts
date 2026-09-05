import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { applyDemonInfo, type DemonInfoResult } from "../src/engine/demonInfo.js";

describe("applyDemonInfo", () => {
  it("tells the Demon their Minions and the 3 bluff characters chosen at setup, with 7+ players", () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "spy", characterId: "spy" },
      { id: "imp", characterId: "imp" },
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "d", characterId: "washerwoman" },
    ]);
    grimoire.demonBluffs = ["chef", "virgin", "soldier"];

    const privateResults = new Map<string, unknown>();
    applyDemonInfo(grimoire, privateResults);

    const impInfo = privateResults.get("imp") as DemonInfoResult;
    expect(impInfo.minionIds.sort()).toEqual(["poisoner", "spy"]);
    expect(impInfo.bluffCharacterIds).toEqual(["chef", "virgin", "soldier"]);
  });

  it("does not give the Minions any information - they're left in the dark by the engine", () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "spy", characterId: "spy" },
      { id: "imp", characterId: "imp" },
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "d", characterId: "washerwoman" },
    ]);

    const privateResults = new Map<string, unknown>();
    applyDemonInfo(grimoire, privateResults);

    expect(privateResults.has("poisoner")).toBe(false);
    expect(privateResults.has("spy")).toBe(false);
  });

  it("gives no Demon info below 7 players", () => {
    const grimoire = buildGrimoire([
      { id: "poisoner", characterId: "poisoner" },
      { id: "imp", characterId: "imp" },
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
    ]);

    const privateResults = new Map<string, unknown>();
    applyDemonInfo(grimoire, privateResults);

    expect(privateResults.size).toBe(0);
  });
});
