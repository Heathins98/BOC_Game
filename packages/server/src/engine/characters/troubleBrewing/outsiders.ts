import type { NightActionHandler } from "../../nightAction.js";

export const butlerHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, playerChoiceProvider } = ctx;
  const candidates = grimoire
    .livingPlayers()
    .map((p) => p.id)
    .filter((id) => id !== playerId);
  const [masterId] = await playerChoiceProvider.requestPlayerChoice({ characterId: "butler", playerId, count: 1, candidates });

  grimoire.getPlayer(playerId).butlerMasterId = grimoire.isFunctioning(playerId) ? masterId : undefined;
};
