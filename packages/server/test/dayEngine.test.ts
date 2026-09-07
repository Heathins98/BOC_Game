import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider } from "../src/testUtils/scriptedProviders.js";
import { castVote, concludeVote, currentBlockHolder, nominate, resolveDayExecutions, useSlayerPower } from "../src/engine/dayEngine.js";

function makeStandardFive() {
  return buildGrimoire([
    { id: "a", characterId: "empath" },
    { id: "b", characterId: "monk" },
    { id: "c", characterId: "butler" },
    { id: "d", characterId: "washerwoman" },
    { id: "imp", characterId: "imp" },
  ]);
}

describe("nominate", () => {
  it("allows the same nominator to nominate a different player afterwards", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const first = nominate(grimoire, "a", "b");
    if (first.kind !== "recorded") throw new Error("expected recorded");
    concludeVote(grimoire);
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
    const first = nominate(grimoire, "a", "b");
    if (first.kind !== "recorded") throw new Error("expected recorded");
    concludeVote(grimoire);
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
    const first = nominate(grimoire, "a", "b");
    if (first.kind !== "recorded") throw new Error("expected recorded");
    concludeVote(grimoire);
    const second = nominate(grimoire, "a", "b");
    expect(second).toEqual({ kind: "rejected", reason: "this exact nomination has already been made today" });
  });

  it("rejects a new nomination while one is already being discussed or voted on", () => {
    const grimoire = buildGrimoire([
      { id: "a", characterId: "empath" },
      { id: "b", characterId: "monk" },
      { id: "c", characterId: "butler" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.startDay(1);
    const first = nominate(grimoire, "a", "b");
    if (first.kind !== "recorded") throw new Error("expected recorded");

    const second = nominate(grimoire, "c", "imp");
    expect(second).toEqual({ kind: "rejected", reason: "a nomination is already being discussed or voted on" });

    concludeVote(grimoire);
    const third = nominate(grimoire, "c", "imp");
    expect(third.kind).toBe("recorded");
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
    if (nom1.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom1.nomination, "a");
    castVote(grimoire, nom1.nomination, "c");
    castVote(grimoire, nom1.nomination, "d");
    concludeVote(grimoire);

    const nom2 = nominate(grimoire, "c", "d");
    if (nom2.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom2.nomination, "a");
    castVote(grimoire, nom2.nomination, "b");
    castVote(grimoire, nom2.nomination, "c");
    concludeVote(grimoire);

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

  it("rejects a vote on a nomination whose clock has already concluded", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    concludeVote(grimoire);
    expect(castVote(grimoire, outcome.nomination, "c")).toBe(false);
  });
});

describe("Grimoire.votingOrderFor", () => {
  it("starts at the seat after the nominee and wraps all the way around, nominee last", () => {
    const grimoire = makeStandardFive();
    expect(grimoire.votingOrderFor("b")).toEqual(["c", "d", "imp", "a", "b"]);
  });

  it("includes dead players", () => {
    const grimoire = makeStandardFive();
    grimoire.markDead("c");
    expect(grimoire.votingOrderFor("b")).toEqual(["c", "d", "imp", "a", "b"]);
  });

  it("throws for an unknown player", () => {
    const grimoire = makeStandardFive();
    expect(() => grimoire.votingOrderFor("nobody")).toThrow();
  });
});

describe("Grimoire.hasVotingCapacity", () => {
  it("is true for a living player", () => {
    const grimoire = makeStandardFive();
    expect(grimoire.hasVotingCapacity("a")).toBe(true);
  });

  it("is true for a dead player with an unspent ghost vote", () => {
    const grimoire = makeStandardFive();
    grimoire.markDead("a");
    expect(grimoire.getPlayer("a").ghostVoteAvailable).toBe(true);
    expect(grimoire.hasVotingCapacity("a")).toBe(true);
  });

  it("is false for a dead player whose ghost vote is spent", () => {
    const grimoire = makeStandardFive();
    grimoire.markDead("a");
    grimoire.getPlayer("a").ghostVoteAvailable = false;
    expect(grimoire.hasVotingCapacity("a")).toBe(false);
  });
});

describe("concludeVote", () => {
  it("throws when there is no active nomination", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    expect(() => concludeVote(grimoire)).toThrow();
  });

  it("marks the nomination concluded, clears activeNomination, and reports vote/threshold/onBlock", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, outcome.nomination, "a");
    castVote(grimoire, outcome.nomination, "c");
    castVote(grimoire, outcome.nomination, "d");

    const conclusion = concludeVote(grimoire);
    expect(outcome.nomination.concluded).toBe(true);
    expect(grimoire.activeNomination).toBeNull();
    expect(conclusion).toEqual({
      nominatorId: "a",
      nomineeId: "b",
      voteCount: 3,
      threshold: 3,
      metThreshold: true,
      onBlock: true,
    });
  });

  it("reports onBlock: false when the vote doesn't meet threshold", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, outcome.nomination, "a");

    const conclusion = concludeVote(grimoire);
    expect(conclusion.metThreshold).toBe(false);
    expect(conclusion.onBlock).toBe(false);
  });
});

describe("currentBlockHolder", () => {
  it("is null when nothing has concluded yet", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    expect(currentBlockHolder(grimoire)).toBeNull();
  });

  it("is null when the only concluded nomination is below threshold", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, outcome.nomination, "a");
    concludeVote(grimoire);
    expect(currentBlockHolder(grimoire)).toBeNull();
  });

  it("returns the sole qualifying nomination", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);
    const outcome = nominate(grimoire, "a", "b");
    if (outcome.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, outcome.nomination, "a");
    castVote(grimoire, outcome.nomination, "c");
    castVote(grimoire, outcome.nomination, "d");
    concludeVote(grimoire);

    const holder = currentBlockHolder(grimoire);
    expect(holder?.voteCount).toBe(3);
    expect(holder?.nomination.nomineeId).toBe("b");
  });

  it("a strictly higher later nomination bumps the earlier holder off the block", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);

    const nom1 = nominate(grimoire, "a", "b");
    if (nom1.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom1.nomination, "a");
    castVote(grimoire, nom1.nomination, "c");
    castVote(grimoire, nom1.nomination, "d");
    concludeVote(grimoire);
    expect(currentBlockHolder(grimoire)?.nomination.nomineeId).toBe("b");

    const nom2 = nominate(grimoire, "c", "imp");
    if (nom2.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom2.nomination, "a");
    castVote(grimoire, nom2.nomination, "b");
    castVote(grimoire, nom2.nomination, "c");
    castVote(grimoire, nom2.nomination, "d");
    concludeVote(grimoire);

    const holder = currentBlockHolder(grimoire);
    expect(holder?.nomination.nomineeId).toBe("imp");
    // The earlier nomination is bumped off (no longer the holder) but stays recorded in history.
    expect(grimoire.nominationsToday).toHaveLength(2);
    expect(grimoire.nominationsToday[0]?.nomineeId).toBe("b");
    expect(grimoire.nominationsToday[0]?.votersInFavor.size).toBe(3);
  });

  it("a tied or lower later nomination leaves the current holder unchanged", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);

    const nom1 = nominate(grimoire, "a", "b");
    if (nom1.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom1.nomination, "a");
    castVote(grimoire, nom1.nomination, "c");
    castVote(grimoire, nom1.nomination, "d");
    concludeVote(grimoire);

    const nom2 = nominate(grimoire, "c", "imp");
    if (nom2.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom2.nomination, "a");
    concludeVote(grimoire); // only 1 vote - well below threshold

    expect(currentBlockHolder(grimoire)?.nomination.nomineeId).toBe("b");
  });

  it("is null when two concluded nominations tie for the day's highest", () => {
    const grimoire = makeStandardFive();
    grimoire.startDay(1);

    const nom1 = nominate(grimoire, "a", "b");
    if (nom1.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom1.nomination, "a");
    castVote(grimoire, nom1.nomination, "c");
    castVote(grimoire, nom1.nomination, "d");
    concludeVote(grimoire);
    expect(currentBlockHolder(grimoire)?.nomination.nomineeId).toBe("b");

    const nom2 = nominate(grimoire, "c", "imp");
    if (nom2.kind !== "recorded") throw new Error("expected recorded");
    castVote(grimoire, nom2.nomination, "a");
    castVote(grimoire, nom2.nomination, "b");
    castVote(grimoire, nom2.nomination, "c");
    concludeVote(grimoire); // ties nom1's 3 votes

    expect(currentBlockHolder(grimoire)).toBeNull();
  });
});

describe("useSlayerPower", () => {
  it("has no effect at all for a non-Slayer caller - no kill, no state mutation, even against the real Demon", async () => {
    const grimoire = buildGrimoire([
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const hit = await useSlayerPower(grimoire, "empath", "imp", new ScriptedDecisionProvider(grimoire));
    expect(hit).toBe(false);
    expect(grimoire.getPlayer("imp").alive).toBe(true);
    expect(grimoire.getPlayer("empath").usedSlayerPower).toBe(false);
  });

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
