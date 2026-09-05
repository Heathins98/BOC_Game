import type { CharacterId, PlayerId } from "./types.js";

export interface ChoosePlayersPrompt {
  characterId: CharacterId;
  /** The acting player being prompted. */
  playerId: PlayerId;
  /** How many distinct targets this prompt requires. */
  count: number;
  /** Legal targets (e.g. already excludes the acting player for Monk/Butler). */
  candidates: PlayerId[];
}

/**
 * The player-facing counterpart to StorytellerDecisionProvider: every ability
 * whose text contains "choose" by the player (Poisoner, Monk, Fortune Teller,
 * Butler, Ravenkeeper-on-death, Imp) is resolved by asking here instead of
 * touching game state directly. In production this is fulfilled by the
 * network layer relaying a `night:prompt` event and awaiting `night:submitChoice`;
 * this pass's test doubles (packages/server/src/testUtils) stand in for that.
 */
export interface PlayerChoiceProvider {
  requestPlayerChoice(prompt: ChoosePlayersPrompt): Promise<PlayerId[]>;
}
