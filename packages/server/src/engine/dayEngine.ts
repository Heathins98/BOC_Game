import type { PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Grimoire, NominationRecord } from "./grimoire.js";
import { applyDeath } from "./killResolution.js";
import { registersAs } from "./detection.js";

export type NominationOutcome =
  | { kind: "recorded"; nomination: NominationRecord }
  | { kind: "virgin-triggered"; executedNominatorId: PlayerId }
  | { kind: "rejected"; reason: string };

/**
 * Registers a nomination, applying the Virgin's trigger inline: if the nominee
 * is a functioning, never-before-nominated Virgin and the nominator is a
 * Townsfolk, the nominator is executed immediately and no vote is held for
 * this nomination.
 *
 * Deliberately looser than tabletop rules: there is no per-day cap on how many
 * times a player may nominate, nor on how many times a player may be
 * nominated - only an identical (nominator, nominee) pair is blocked from
 * repeating within the same day, so a fresh attempt by someone else (or a
 * different target from the same nominator) is always allowed.
 */
export function nominate(grimoire: Grimoire, nominatorId: PlayerId, nomineeId: PlayerId): NominationOutcome {
  const nominator = grimoire.getPlayer(nominatorId);
  const nominee = grimoire.getPlayer(nomineeId);

  if (!nominator.alive) return { kind: "rejected", reason: "nominator is not alive" };
  if (grimoire.nominationsToday.some((n) => n.nominatorId === nominatorId && n.nomineeId === nomineeId)) {
    return { kind: "rejected", reason: "this exact nomination has already been made today" };
  }

  const isFirstNominationOfVirgin = nominee.characterId === "virgin" && !nominee.hasBeenNominated;
  if (nominee.characterId === "virgin") nominee.hasBeenNominated = true;

  if (isFirstNominationOfVirgin && grimoire.isFunctioning(nomineeId) && grimoire.characterOf(nominatorId).team === "townsfolk") {
    applyDeath(grimoire, nominatorId, "execution");
    return { kind: "virgin-triggered", executedNominatorId: nominatorId };
  }

  const nomination: NominationRecord = { nominatorId, nomineeId, votersInFavor: new Set() };
  grimoire.nominationsToday.push(nomination);
  return { kind: "recorded", nomination };
}

/**
 * Records `voterId` voting in favor of `nomination`. Returns whether the vote
 * was accepted. Rejects a functioning Butler's vote unless their chosen
 * master has already voted in favor of this same nomination - callers should
 * therefore submit votes in seating order, as the physical game does.
 */
export function castVote(grimoire: Grimoire, nomination: NominationRecord, voterId: PlayerId): boolean {
  const voter = grimoire.getPlayer(voterId);

  if (!voter.alive) {
    if (!voter.ghostVoteAvailable) return false;
    voter.ghostVoteAvailable = false;
  }

  if (voter.characterId === "butler" && grimoire.isFunctioning(voterId) && voter.butlerMasterId) {
    if (!nomination.votersInFavor.has(voter.butlerMasterId)) return false;
  }

  nomination.votersInFavor.add(voterId);
  return true;
}

export interface ExecutionResult {
  executedPlayerId: PlayerId | null;
}

/** Resolves all of today's nominations: at most one execution, the strict highest vote total that meets threshold. */
export function resolveDayExecutions(grimoire: Grimoire): ExecutionResult {
  const livingCount = grimoire.livingPlayers().length;
  const threshold = Math.ceil(livingCount / 2);

  const qualifying = grimoire.nominationsToday
    .map((n) => ({ nomination: n, votes: n.votersInFavor.size }))
    .filter((n) => n.votes >= threshold);

  if (qualifying.length === 0) return { executedPlayerId: null };

  const maxVotes = Math.max(...qualifying.map((n) => n.votes));
  const topNominations = qualifying.filter((n) => n.votes === maxVotes);
  if (topNominations.length !== 1) return { executedPlayerId: null }; // tie for highest: nobody executed

  const winner = topNominations[0] as (typeof topNominations)[number];
  applyDeath(grimoire, winner.nomination.nomineeId, "execution");
  return { executedPlayerId: winner.nomination.nomineeId };
}

/**
 * Slayer's once-per-game public day power. Consumes the charge whether or not
 * it hits - a poisoned/drunk Slayer still "uses" their shot but it never kills.
 */
export async function useSlayerPower(
  grimoire: Grimoire,
  slayerId: PlayerId,
  targetId: PlayerId,
  decisionProvider: StorytellerDecisionProvider,
): Promise<boolean> {
  const slayer = grimoire.getPlayer(slayerId);
  if (!slayer.alive || slayer.usedSlayerPower) return false;
  slayer.usedSlayerPower = true;

  if (!grimoire.isFunctioning(slayerId)) return false;

  const isDemon = await registersAs(grimoire, targetId, "demon", decisionProvider);
  if (!isDemon) return false;

  applyDeath(grimoire, targetId, "slayer");
  return true;
}
