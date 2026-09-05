import type { Alignment, CharacterId, PlayerId, PlayerState, Team } from "@boc/shared";
import { TROUBLE_BREWING } from "@boc/shared";
import { Grimoire } from "../engine/grimoire.js";

const GOOD_TEAMS: Team[] = ["townsfolk", "outsider"];

/**
 * Builds a Grimoire directly from a seat -> characterId list, bypassing
 * setup.ts's composition validation. Only for unit tests that want a small,
 * hand-picked cast rather than a full valid Trouble Brewing game.
 */
export function buildGrimoire(seating: { id: PlayerId; characterId: CharacterId }[]): Grimoire {
  const players: PlayerState[] = seating.map(({ id, characterId }, seat) => {
    const def = TROUBLE_BREWING.characters.find((c) => c.id === characterId);
    if (!def) throw new Error(`Unknown character id "${characterId}"`);
    const alignment: Alignment = GOOD_TEAMS.includes(def.team) ? "good" : "evil";
    return {
      id,
      name: id,
      seat,
      characterId,
      alignment,
      alive: true,
      ghostVoteAvailable: true,
      poisoned: false,
      drunk: false,
      protectedTonight: false,
      usedSlayerPower: false,
      hasBeenNominated: false,
      reminderTokens: [],
    };
  });
  return new Grimoire(players, TROUBLE_BREWING);
}
