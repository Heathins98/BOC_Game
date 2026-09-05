import type { PlayerId, StorytellerDecisionProvider } from "@boc/shared";
import type { Grimoire } from "./grimoire.js";

/**
 * Single choke point every detection-style ability (Fortune Teller, Empath, Chef)
 * reads alignment/demon-hood through, instead of touching Grimoire truth directly.
 * Only ever consults the decision provider for an actual Recluse/Spy - everyone
 * else's detection result is their ground truth.
 */
export async function registersAs(
  grimoire: Grimoire,
  playerId: PlayerId,
  checkingFor: "evil" | "demon",
  decisionProvider: StorytellerDecisionProvider,
): Promise<boolean> {
  const player = grimoire.getPlayer(playerId);
  const trueTeam = grimoire.characterOf(playerId).team;
  const trueAnswer = checkingFor === "demon" ? trueTeam === "demon" : player.alignment === "evil";

  if (player.characterId === "recluse" || player.characterId === "spy") {
    return decisionProvider.resolveMisregistration({ playerId, trueTeam, checkingFor });
  }
  return trueAnswer;
}
