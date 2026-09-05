import type { PlayerChoiceProvider, PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";

export interface NightActionContext {
  grimoire: Grimoire;
  /** The player holding the acting character this step. */
  playerId: PlayerId;
  decisionProvider: StorytellerDecisionProvider;
  playerChoiceProvider: PlayerChoiceProvider;
  /** Where private results (info reveals) get recorded for later inspection - tests read this directly. */
  privateResults: Map<PlayerId, unknown>;
}

export type NightActionHandler = (context: NightActionContext) => Promise<void>;
