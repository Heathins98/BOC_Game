import type { NightActionHandler } from "../../nightAction.js";
import { applyDeath, resolveDemonNightKill } from "../../killResolution.js";

export const impHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, playerChoiceProvider } = ctx;
  const candidates = grimoire.livingPlayers().map((p) => p.id);
  const [targetId] = await playerChoiceProvider.requestPlayerChoice({ characterId: "imp", playerId, count: 1, candidates });

  if (!grimoire.isFunctioning(playerId)) return; // poisoned Demon: the kill silently fails

  if (targetId === playerId) {
    applyDeath(grimoire, playerId, "imp-self-kill");
    const livingMinions = grimoire
      .allPlayers()
      .filter((p) => p.alive && grimoire.characterOf(p.id).team === "minion")
      .map((p) => p.id);
    if (livingMinions.length > 0) {
      const promotedId = await decisionProvider.choosePromotedMinion(livingMinions);
      grimoire.getPlayer(promotedId).characterId = "imp";
    }
    return;
  }

  await resolveDemonNightKill(grimoire, targetId as string, decisionProvider);
};
