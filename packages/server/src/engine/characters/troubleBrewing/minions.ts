import type { SpyGrimoireResult } from "@boc/shared";
import type { NightActionHandler } from "../../nightAction.js";

export const poisonerHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, playerChoiceProvider } = ctx;
  const candidates = grimoire.livingPlayers().map((p) => p.id);
  const [targetId] = await playerChoiceProvider.requestPlayerChoice({ characterId: "poisoner", playerId, count: 1, candidates });
  if (targetId) grimoire.getPlayer(targetId).poisoned = true;
};

/**
 * Spy: "Each night, you see the Grimoire." Shows ground truth - the same data the
 * Storyteller sees - since misregistration only ever applies to a character *checking*
 * a Recluse/Spy, not to what the Spy itself perceives. When poisoned/drunk, the board is
 * fabricated instead: the same players and in-play characters, reassigned as a
 * derangement (nobody keeps their true character) using the game's seeded RNG so it
 * still replays identically for a given --seed. Both cases share the exact same result
 * shape, so a poisoned Spy can't tell their info is fake.
 */
export const spyHandler: NightActionHandler = async (ctx) => {
  const { grimoire, playerId, rng, privateResults } = ctx;

  const players: SpyGrimoireResult["players"] = grimoire.allPlayers().map((p) => ({
    id: p.id,
    characterId: p.characterId,
    alignment: p.alignment,
    alive: p.alive,
    poisoned: p.poisoned,
    drunk: p.drunk,
    drunkShowsAsCharacterId: p.drunkShowsAsCharacterId,
    protectedTonight: p.protectedTonight,
    usedSlayerPower: p.usedSlayerPower,
    butlerMasterId: p.butlerMasterId,
  }));

  if (!grimoire.isFunctioning(playerId)) {
    const identities = players.map((p) => ({ characterId: p.characterId, alignment: p.alignment }));
    let shuffled = rng.shuffle(identities);
    let attempts = 0;
    while (shuffled.some((identity, i) => identity.characterId === identities[i]!.characterId) && attempts < 100) {
      shuffled = rng.shuffle(identities);
      attempts++;
    }
    const fakePlayers = players.map((p, i) => ({ ...p, ...shuffled[i]! }));
    privateResults.set(playerId, { kind: "grimoire", redHerringId: grimoire.redHerringId, players: fakePlayers } satisfies SpyGrimoireResult);
    return;
  }

  privateResults.set(playerId, { kind: "grimoire", redHerringId: grimoire.redHerringId, players } satisfies SpyGrimoireResult);
};
