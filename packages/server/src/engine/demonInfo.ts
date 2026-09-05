import type { CharacterId, PlayerId } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";

/** "Minion Info and Demon Info are only given on the first night if there are 7 or more players" (botc-trouble-brewing skill). */
export const MINIMUM_PLAYERS_FOR_DEMON_INFO = 7;

export interface DemonInfoResult {
  minionIds: PlayerId[];
  bluffCharacterIds: CharacterId[];
}

/**
 * First-night-only, 7+ players only: the Demon learns which players are their
 * Minions and 3 not-in-play good characters (chosen at setup - see setup.ts)
 * to use as bluffs.
 *
 * Deliberately does NOT implement the tabletop "Minion Info" step, which
 * would also tell every Minion who the Demon and their fellow Minions are.
 * In this tool, Minions are left in the dark by the engine - getting that
 * knowledge to them covertly, without the good team noticing, is left as
 * part of the Demon's own play rather than handed out automatically.
 */
export function applyDemonInfo(grimoire: Grimoire, privateResults: Map<PlayerId, unknown>): void {
  const allPlayers = grimoire.allPlayers();
  if (allPlayers.length < MINIMUM_PLAYERS_FOR_DEMON_INFO) return;

  const minionIds = allPlayers.filter((p) => grimoire.characterOf(p.id).team === "minion").map((p) => p.id);
  const demonIds = allPlayers.filter((p) => grimoire.characterOf(p.id).team === "demon").map((p) => p.id);

  for (const demonId of demonIds) {
    const result: DemonInfoResult = { minionIds, bluffCharacterIds: grimoire.demonBluffs };
    privateResults.set(demonId, result);
  }
}
