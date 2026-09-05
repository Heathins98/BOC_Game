import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider } from "../src/testUtils/scriptedProviders.js";
import { castVote, nominate, resolveDayExecutions, useSlayerPower } from "../src/engine/dayEngine.js";

describe("nominate", () => {
  it("allows the same nominator to nominate a different player afterwards", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    nominate(grimoire, "a", "b");
    const second = nominate(grimoire, "a", "c");
    expect(second.kind).toBe("recorded");
  });

  it("allows a different nominator to re-nominate someone already nominated today", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    nominate(grimoire, "a", "b");
    const second = nominate(grimoire, "c", "b");
    expect(second.kind).toBe("recorded");
  });

  it("rejects an identical (nominator, nominee) pair repeated in the same day", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    nominate(grimoire, "a", "b");
    const second = nominate(grimoire, "a", "b");
    expect(second.kind).toBe("rejected");
  });

  it("triggers the Virgin: nominator executed immediately, no vote recorded", () => {
    const grimoire = buildGrimoire([
      { id: "virgin", characterId: "virgin" },
      { id: "a", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "virgin");
    expect(outcome).toEqual({ kind: "virgin-triggered", executedNominatorId: "a" });
    expect(grimoire.getPlayer("a").alive).toBe(false);
    expect(grimoire.nominationsToday).toHaveLength(0);
  });

  it("does not trigger the Virgin a second time", () => {
    const grimoire = buildGrimoire([
      { id: "virgin", characterId: "virgin" },
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    nominate(grimoire, "a", "virgin");
    grimoire.startDay(2);
    const outcome = nominate(grimoire, "b", "virgin");
    expect(outcome.kind).toBe("recorded");
    expect(grimoire.getPlayer("b").alive).toBe(true);
  });

  it("does not trigger the Virgin when the nominator is not a Townsfolk", () => {
    const grimoire = buildGrimoire([
      { id: "virgin", characterId: "virgin" },
      { id: "poisoner", characterId: "poisoner" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "poisoner", "virgin");
    expect(outcome.kind).toBe("recorded");
    expect(grimoire.getPlayer("poisoner").alive).toBe(true);
  });
});

describe("castVote + resolveDayExecutions", () => {
  it("executes the nomination that meets threshold with strictly the most votes", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "d", characterId: "washerwoman" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, outcome.nomination, "a");
    castVote(grimoire, outcome.nomination, "c");
    castVote(grimoire, outcome.nomination, "d");
    const result = resolveDayExecutions(grimoire);
    expect(result.executedPlayerId).toBe("b");
    expect(grimoire.getPlayer("b").alive).toBe(false);
  });

  it("executes nobody on a tie for the highest vote total", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "d", characterId: "washerwoman" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const nom1 = nominate(grimoire, "a", "b");
    const nom2 = nominate(grimoire, "c", "d");
    if (nom1.kind !== "recorded" || nom2.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom1.nomination, "a");
    castVote(grimoire, nom1.nomination, "c");
    castVote(grimoire, nom1.nomination, "d");
    castVote(grimoire, nom2.nomination, "a");
    castVote(grimoire, nom2.nomination, "b");
    castVote(grimoire, nom2.nomination, "c");
    const result = resolveDayExecutions(grimoire);
    expect(result.executedPlayerId).toBeNull();
  });

  it("rejects a ghost vote once it has already been spent", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    grimoire.getPlayer("a").alive = false;
    grimoire.getPlayer("a").ghostVoteAvailable = true;
    const nom1 = nominate(grimoire, "b", "imp");
    if (nom1.kind !== "recorded") throw new Error("expected recorded");
    expect(castVote(grimoire, nom1.nomination, "a")).toBe(true);
    expect(grimoire.getPlayer("a").ghostVoteAvailable).toBe(false);

    grimoire.startDay(2);
    const nom2 = nominate(grimoire, "c", "b");
    if (nom2.kind !== "recorded") throw new Error("expected recorded");
    expect(castVote(grimoire, nom2.nomination, "a")).toBe(false);
  });

  it("a Butler's in-favor vote only counts if their master already voted in favor", () => {
    const grimoire = buildGrimoire([
      { id: "butler", characterId: "butler" },
      { id: "master", characterId: "empath" },
      { id: "other", characterId: "monk" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("butler").butlerMasterId = "master";
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "other", "imp");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");

    expect(castVote(grimoire, outcome.nomination, "butler")).toBe(false);
    expect(castVote(grimoire, outcome.nomination, "master")).toBe(true);
    expect(castVote(grimoire, outcome.nomination, "butler")).toBe(true);
  });
});

describe("useSlayerPower", () => {
  it("kills the Demon and consumes the once-per-game charge", async () => {
    const grimoire = buildGrimoire([
      { id: "slayer", characterId: "slayer" },
      { id: "imp", characterId: "imp" },
    ]);
    const hit = await useSlayerPower(grimoire, "slayer", "imp", new ScriptedDecisionProvider(grimoire));
    expect(hit).toBe(true);
    expect(grimoire.getPlayer("imp").alive).toBe(false);
    expect(grimoire.getPlayer("slayer").usedSlayerPower).toBe(true);
  });

  it("does nothing on a non-Demon target and still consumes the charge", async () => {
    const grimoire = buildGrimoire([
      { id: "slayer", characterId: "slayer" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const hit = await useSlayerPower(grimoire, "slayer", "empath", new ScriptedDecisionProvider(grimoire));
    expect(hit).toBe(false);
    expect(grimoire.getPlayer("empath").alive).toBe(true);
    expect(grimoire.getPlayer("slayer").usedSlayerPower).toBe(true);
  });

  it("cannot be used twice", async () => {
    const grimoire = buildGrimoire([
      { id: "slayer", characterId: "slayer" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("slayer").usedSlayerPower = true;
    const hit = await useSlayerPower(grimoire, "slayer", "imp", new ScriptedDecisionProvider(grimoire));
    expect(hit).toBe(false);
    expect(grimoire.getPlayer("imp").alive).toBe(true);
  });
});
