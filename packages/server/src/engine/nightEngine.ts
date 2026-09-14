import type { PlayerChoiceProvider, PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Rng } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";
import type { NightActionHandler } from "./nightAction.js";
import { TROUBLE_BREWING_NIGHT_HANDLERS } from "./characters/troubleBrewing/index.js";
import { applyDemonInfo } from "./demonInfo.js";

const HANDLERS_BY_SCRIPT: Record<string, Partial<Record<string, NightActionHandler>>> = {
  "trouble-brewing": TROUBLE_BREWING_NIGHT_HANDLERS,
};

export interface RunNightOptions {
  grimoire: Grimoire;
  nightNumber: number;
  rng: Rng;
  decisionProvider: StorytellerDecisionProvider;
  playerChoiceProvider: PlayerChoiceProvider;
  /** Overrides the script's registered handlers - a seam for tests that need to observe every invocation. */
  handlers?: Partial<Record<string, NightActionHandler>>;
  /** Called the instant a private result is recorded, rather than making callers wait for the whole night order to finish before they can see any of it. */
  onResult?: ((playerId: PlayerId, result: unknown) => void) | undefined;
}

/**
 * Walks the script's first-night or other-night order (whichever `nightNumber`
 * calls for), invoking each in-play, condition-satisfied character's handler
 * in turn. Dusk/Dawn are deliberately not modeled here - they carry no state
 * change the engine needs to track. Demon Info *is* modeled (see
 * applyDemonInfo) since it's a private result a player needs to receive, just
 * not tied to any one character's own night-order slot. Minion Info is
 * deliberately not implemented at all - see applyDemonInfo's docstring.
 */
export async function runNight({
  grimoire,
  nightNumber,
  rng,
  decisionProvider,
  playerChoiceProvider,
  handlers: handlerOverrides,
  onResult,
}: RunNightOptions): Promise<Map<PlayerId, unknown>> {
  grimoire.startNight(nightNumber);
  const order = nightNumber === 1 ? grimoire.script.firstNightOrder : grimoire.script.otherNightOrder;
  const handlers = handlerOverrides ?? HANDLERS_BY_SCRIPT[grimoire.script.id];
  if (!handlers) throw new Error(`No night handlers registered for script "${grimoire.script.id}"`);

  const privateResults = new Map<PlayerId, unknown>();

  if (nightNumber === 1) {
    applyDemonInfo(grimoire, privateResults);
    for (const [playerId, result] of privateResults) onResult?.(playerId, result);
  }

  for (const slot of order) {
    const playerId = grimoire.findByCharacter(slot.characterId);
    if (!playerId) continue; // character not in play this game

    if (slot.condition === "diedTonight") {
      if (!grimoire.diedTonight.has(playerId)) continue;
    } else if (slot.condition === "becameDemonToday") {
      if (grimoire.newlyDemonPlayerId !== playerId) continue;
    } else if (slot.condition === "executionOccurredToday") {
      if (!grimoire.executedPlayerId) continue;
    } else if (slot.condition === "actsWhileDead") {
      // no gating - this character's slot always fires, living or dead
    } else if (!grimoire.getPlayer(playerId).alive) {
      continue; // dead characters don't act unless their slot's condition says otherwise
    }

    const handler = handlers[slot.characterId];
    if (!handler) continue; // in-play but has no state-mutating night action

    const hadResultBefore = privateResults.has(playerId);
    await handler({ grimoire, playerId, rng, decisionProvider, playerChoiceProvider, privateResults });
    if (!hadResultBefore && privateResults.has(playerId)) {
      onResult?.(playerId, privateResults.get(playerId));
    }
  }

  return privateResults;
}
