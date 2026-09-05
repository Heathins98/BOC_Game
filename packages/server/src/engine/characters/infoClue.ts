import type { CharacterId, Team } from "@boc/shared";
import type { NightActionContext } from "../nightAction.js";

/**
 * Shared implementation for Washerwoman/Librarian/Investigator: "you start
 * knowing 1 of 2 players is a particular [team]." Handles the healthy vs
 * drunk/poisoned split; the Librarian-seeing-the-Drunk's-fake-identity rule is
 * applied by the caller since it only ever applies to that one character.
 */
export async function runInfoClueAbility(ctx: NightActionContext, characterId: CharacterId, targetTeam: Team): Promise<void> {
  const { grimoire, playerId, decisionProvider, privateResults } = ctx;

  if (!grimoire.isFunctioning(playerId)) {
    const clue = await decisionProvider.fabricateInfoClue({ characterId, playerId });
    privateResults.set(playerId, clue);
    return;
  }

  const truthfulCandidates = grimoire
    .allPlayers()
    .filter((p) => p.id !== playerId && grimoire.characterOf(p.id).team === targetTeam)
    .map((p) => p.id);
  const decoyCandidates = grimoire
    .allPlayers()
    .map((p) => p.id)
    .filter((id) => id !== playerId);

  const clue = await decisionProvider.chooseInfoClue({ characterId, truthfulCandidates, decoyCandidates });
  privateResults.set(playerId, clue);
}
