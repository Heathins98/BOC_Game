import type { PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";

export type KillCause =
  | "demon-night-kill"
  | "execution"
  | "slayer"
  | "imp-self-kill"
  | "mayor-redirect";

/**
 * Single choke point every death routes through. Handles the Scarlet Woman's
 * automatic promotion (skipped for imp-self-kill, which the Imp's own handler
 * already resolves via choosePromotedMinion) so that logic lives in one place
 * instead of being duplicated at every call site.
 */
export function applyDeath(grimoire: Grimoire, playerId: PlayerId, cause: KillCause): void {
  const player = grimoire.getPlayer(playerId);
  if (!player.alive) return;

  const dyingTeam = grimoire.characterOf(playerId).team;
  grimoire.markDead(playerId);

  if (cause === "execution") {
    grimoire.executedPlayerId = playerId;
  }

  if (dyingTeam === "demon" && cause !== "imp-self-kill") {
    const scarletWomanId = grimoire.findByCharacter("scarlet-woman");
    if (scarletWomanId) {
      const scarletWoman = grimoire.getPlayer(scarletWomanId);
      if (scarletWoman.alive && grimoire.livingPlayers().length >= 5) {
        scarletWoman.characterId = player.characterId;
        grimoire.newlyDemonPlayerId = scarletWomanId;
      }
    }
  }
}

/**
 * Resolves a kill attributed to the Demon's nightly ability, applying the Monk's
 * protection, the Soldier's immunity, and the Mayor's maybe-redirect in that
 * order. Returns the id of whoever actually died, or null if the kill was
 * fully blocked.
 */
export async function resolveDemonNightKill(
  grimoire: Grimoire,
  targetId: PlayerId,
  decisionProvider: StorytellerDecisionProvider,
): Promise<PlayerId | null> {
  const target = grimoire.getPlayer(targetId);
  if (!target.alive) return null;

  if (target.protectedTonight) return null;

  if (target.characterId === "soldier" && grimoire.isFunctioning(targetId)) return null;

  if (target.characterId === "mayor" && grimoire.isFunctioning(targetId)) {
    const redirectTo = await decisionProvider.wantsMayorRedirect({
      mayorId: targetId,
      alivePlayerIds: grimoire.livingPlayers().map((p) => p.id),
    });
    if (redirectTo) {
      applyDeath(grimoire, redirectTo, "mayor-redirect");
      return redirectTo;
    }
  }

  applyDeath(grimoire, targetId, "demon-night-kill");
  return targetId;
}
