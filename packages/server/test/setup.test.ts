import { describe, expect, it } from "vitest";
import type { StorytellerDecisionProvider } from "@boc/shared";
import { Rng, TROUBLE_BREWING } from "@boc/shared";
import { dealGame, randomComposition, validateComposition } from "../src/engine/setup.js";

/** dealGame only ever calls chooseRedHerring - every other method here is unreachable during setup. */
const stubDecisionProvider: StorytellerDecisionProvider = {
  chooseRedHerring: async (candidates) => candidates[0]!,
  chooseInfoClue: async () => ({ kind: "none" }),
  fabricateInfoClue: async () => ({ kind: "none" }),
  fabricateCharacter: async () => "washerwoman",
  fabricateNumber: async () => 0,
  fabricateBoolean: async () => false,
  resolveMisregistration: async () => false,
  choosePromotedMinion: async (candidates) => candidates[0]!,
  wantsMayorRedirect: async () => null,
};

describe("validateComposition", () => {
  it("accepts a composition matching the setup table", () => {
    expect(() =>
      validateComposition(TROUBLE_BREWING, 5, ["washerwoman", "empath", "chef", "poisoner", "imp"]),
    ).not.toThrow();
  });

  it("rejects a composition with the wrong team counts", () => {
    // 5 players expect 3 Townsfolk/0 Outsiders/1 Minion/1 Demon; this has an Outsider (Butler)
    // crowding out a Townsfolk slot without a Baron in play to justify it.
    expect(() => validateComposition(TROUBLE_BREWING, 5, ["washerwoman", "butler", "chef", "poisoner", "imp"])).toThrow();
  });

  it("accounts for the Baron's +2 Outsider / -2 Townsfolk modifier", () => {
    // 7 players normally: 5 townsfolk, 0 outsiders, 1 minion, 1 demon.
    // With the Baron: 3 townsfolk, 2 outsiders, 1 minion (the Baron itself), 1 demon.
    expect(() =>
      validateComposition(TROUBLE_BREWING, 7, ["washerwoman", "librarian", "chef", "butler", "recluse", "baron", "imp"]),
    ).not.toThrow();
  });
});

describe("randomComposition", () => {
  it("always produces a valid, correctly-sized composition", () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const playerCount of [5, 7, 10, 13, 15]) {
        const rng = new Rng(seed * 100 + playerCount);
        const composition = randomComposition(TROUBLE_BREWING, playerCount, rng);
        expect(() => validateComposition(TROUBLE_BREWING, playerCount, composition)).not.toThrow();
        expect(new Set(composition).size).toBe(playerCount);
      }
    }
  });
});

describe("dealGame", () => {
  it("assigns the Drunk a fake Townsfolk identity not otherwise in play", async () => {
    const players = [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }, { id: "p4", name: "P4" }, { id: "p5", name: "P5" }, { id: "p6", name: "P6" }];
    const characterIds = ["washerwoman", "librarian", "chef", "drunk", "poisoner", "imp"];
    const rng = new Rng(42);
    const grimoire = await dealGame(players, TROUBLE_BREWING, characterIds, stubDecisionProvider, rng);
    const drunkPlayer = grimoire.allPlayers().find((p) => p.characterId === "drunk");
    expect(drunkPlayer?.drunk).toBe(true);
    expect(drunkPlayer?.drunkShowsAsCharacterId).toBeDefined();
    expect(characterIds).not.toContain(drunkPlayer?.drunkShowsAsCharacterId);
  });

  it("picks a Red Herring only when the Fortune Teller is in play", async () => {
    const players = [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }, { id: "p4", name: "P4" }, { id: "p5", name: "P5" }];
    const characterIds = ["washerwoman", "librarian", "chef", "poisoner", "imp"];
    const rng = new Rng(7);
    const grimoire = await dealGame(players, TROUBLE_BREWING, characterIds, stubDecisionProvider, rng);
    expect(grimoire.redHerringId).toBeNull();
  });

  it("picks 3 not-in-play good characters as Demon bluffs", async () => {
    const players = [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }, { id: "p4", name: "P4" }, { id: "p5", name: "P5" }];
    const characterIds = ["washerwoman", "librarian", "chef", "poisoner", "imp"];
    const rng = new Rng(7);
    const grimoire = await dealGame(players, TROUBLE_BREWING, characterIds, stubDecisionProvider, rng);

    expect(grimoire.demonBluffs).toHaveLength(3);
    expect(new Set(grimoire.demonBluffs).size).toBe(3); // all distinct
    for (const bluffId of grimoire.demonBluffs) {
      expect(characterIds).not.toContain(bluffId);
      const def = TROUBLE_BREWING.characters.find((c) => c.id === bluffId);
      expect(def?.team === "townsfolk" || def?.team === "outsider").toBe(true);
    }
  });
});
