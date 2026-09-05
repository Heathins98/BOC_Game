import type { Grimoire } from "./grimoire.js";

export interface WinResult {
  winner: "good" | "evil";
  reason: string;
}

/**
 * Should be called after any death resolves (execution, night kill, Slayer)
 * and again at the end of each day. Returns null if the game continues.
 */
export function checkWinConditions(grimoire: Grimoire): WinResult | null {
  const demonAlive = grimoire.allPlayers().some((p) => p.alive && grimoire.characterOf(p.id).team === "demon");
  if (!demonAlive) return { winner: "good", reason: "The Demon has died." };

  const livingCount = grimoire.livingPlayers().length;
  if (livingCount <= 2) return { winner: "evil", reason: "Only 2 players remain alive." };

  if (livingCount === 3 && !grimoire.executedPlayerId) {
    const mayorAlive = grimoire
      .allPlayers()
      .some((p) => p.alive && p.characterId === "mayor" && grimoire.isFunctioning(p.id));
    if (mayorAlive) {
      return { winner: "good", reason: "3 players remain alive, no execution occurred today, and the Mayor lives." };
    }
  }

  return null;
}

/** Saint's execution-deterrent: checked immediately after an execution resolves. */
export function checkSaintExecutionLoss(grimoire: Grimoire, executedPlayerId: string): WinResult | null {
  const player = grimoire.getPlayer(executedPlayerId);
  if (player.characterId === "saint" && grimoire.isFunctioning(executedPlayerId)) {
    return { winner: "evil", reason: "The Saint was executed." };
  }
  return null;
}
