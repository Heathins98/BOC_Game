import type { InfoClueResult } from "@boc/shared";
import type { NightActionHandler } from "../../nightAction.js";
import { registersAs } from "../../detection.js";
import { runInfoClueAbility } from "../infoClue.js";

export const washerwomanHandler: NightActionHandler = async (ctx) => {
  await runInfoClueAbility(ctx, "washerwoman", "townsfolk");
};

export const librarianHandler: NightActionHandler = async (ctx) => {
  await runInfoClueAbility(ctx, "librarian", "outsider");

  // "If the identified Outsider is the Drunk, the Librarian learns the Drunk's
  // true (fake) Townsfolk character, not 'Drunk'."
  const clue = ctx.privateResults.get(ctx.playerId) as InfoClueResult | undefined;
  if (clue?.kind === "pair") {
    const trueBearer = ctx.grimoire.getPlayer(clue.players[0]);
    if (trueBearer.characterId === "drunk" && trueBearer.drunkShowsAsCharacterId) {
      ctx.privateResults.set(ctx.playerId, { ...clue, shownCharacterId: trueBearer.drunkShowsAsCharacterId });
    }
  }
};

export const investigatorHandler: NightActionHandler = async (ctx) => {
  await runInfoClueAbility(ctx, "investigator", "minion");
};

export const chefHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, privateResults } = ctx;

  if (!grimoire.isFunctioning(playerId)) {
    const count = await decisionProvider.fabricateNumber({
      characterId: "chef",
      playerId,
      plausibleMax: Math.floor(grimoire.allPlayers().length / 2),
    });
    privateResults.set(playerId, count);
    return;
  }

  const seatOrder = grimoire.seatOrder;
  const evilFlags = await Promise.all(seatOrder.map((id) => registersAs(grimoire, id, "evil", decisionProvider)));
  const n = seatOrder.length;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (evilFlags[i] && evilFlags[next]) pairs++;
  }
  privateResults.set(playerId, pairs);
};

export const empathHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, privateResults } = ctx;

  if (!grimoire.isFunctioning(playerId)) {
    const count = await decisionProvider.fabricateNumber({ characterId: "empath", playerId, plausibleMax: 2 });
    privateResults.set(playerId, count);
    return;
  }

  const neighbors = grimoire.livingNeighbors(playerId);
  const evilFlags = await Promise.all(neighbors.map((id) => registersAs(grimoire, id, "evil", decisionProvider)));
  privateResults.set(playerId, evilFlags.filter(Boolean).length);
};

export const fortuneTellerHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, playerChoiceProvider, privateResults } = ctx;

  const candidates = grimoire.livingPlayers().map((p) => p.id);
  const [a, b] = await playerChoiceProvider.requestPlayerChoice({
    characterId: "fortune-teller",
    playerId,
    count: 2,
    candidates,
  });

  if (!grimoire.isFunctioning(playerId)) {
    const result = await decisionProvider.fabricateBoolean({ characterId: "fortune-teller", playerId });
    privateResults.set(playerId, result);
    return;
  }

  const checks = await Promise.all(
    [a, b].map(async (id) => {
      if (id === grimoire.redHerringId) return true;
      return registersAs(grimoire, id as string, "demon", decisionProvider);
    }),
  );
  privateResults.set(playerId, checks[0] === true || checks[1] === true);
};

export const undertakerHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, privateResults } = ctx;
  const executedId = grimoire.executedPlayerId;
  if (!executedId) return;

  if (!grimoire.isFunctioning(playerId)) {
    const fake = await decisionProvider.fabricateCharacter({ characterId: "undertaker", playerId, scriptId: grimoire.script.id });
    privateResults.set(playerId, fake);
    return;
  }

  privateResults.set(playerId, grimoire.getPlayer(executedId).characterId);
};

export const monkHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, playerChoiceProvider } = ctx;
  const candidates = grimoire
    .livingPlayers()
    .map((p) => p.id)
    .filter((id) => id !== playerId);
  const [targetId] = await playerChoiceProvider.requestPlayerChoice({ characterId: "monk", playerId, count: 1, candidates });

  if (grimoire.isFunctioning(playerId) && targetId) {
    grimoire.getPlayer(targetId).protectedTonight = true;
  }
};

export const ravenkeeperHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, decisionProvider, playerChoiceProvider, privateResults } = ctx;
  const candidates = grimoire
    .livingPlayers()
    .map((p) => p.id)
    .filter((id) => id !== playerId);
  const [targetId] = await playerChoiceProvider.requestPlayerChoice({
    characterId: "ravenkeeper",
    playerId,
    count: 1,
    candidates,
  });

  if (!grimoire.isFunctioning(playerId)) {
    const fake = await decisionProvider.fabricateCharacter({ characterId: "ravenkeeper", playerId, scriptId: grimoire.script.id });
    privateResults.set(playerId, fake);
    return;
  }

  privateResults.set(playerId, grimoire.getPlayer(targetId as string).characterId);
};
