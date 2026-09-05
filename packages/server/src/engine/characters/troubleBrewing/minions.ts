import type { NightActionHandler } from "../../nightAction.js";

export const poisonerHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, playerChoiceProvider } = ctx;
  const candidates = grimoire.livingPlayers().map((p) => p.id);
  const [targetId] = await playerChoiceProvider.requestPlayerChoice({ characterId: "poisoner", playerId, count: 1, candidates });
  if (targetId) grimoire.getPlayer(targetId).poisoned = true;
};
