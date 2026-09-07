import type { PlayerChoiceProvider, PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Rng } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";

export interface NightActionContext {
  grimoire: Grimoire;
  /** The player holding the acting character this step. */
  playerId: PlayerId;
  /** The game's seeded RNG - use this (never Math.random()) for any handler-level randomness, to preserve --seed reproducibility. */
  rng: Rng;
  decisionProvider: StorytellerDecisionProvider;
  playerChoiceProvider: PlayerChoiceProvider;
  /** Where private results (info reveals) get recorded for later inspection - tests read this directly. */
  privateResults: Map<PlayerId, unknown>;
}

export type NightActionHandler = (context: NightActionContext) => Promise<void>;
