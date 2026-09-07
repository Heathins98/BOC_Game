import type {
  Alignment,
  CharacterId,
  PlayerId,
  PlayerState,
  ScriptDefinition,
  SetupCounts,
  StorytellerDecisionProvider,
  Team,
} from "@boc/shared";
import { Rng } from "@boc/shared";
import { Grimoire } from "./grimoire.js";

export interface PlayerSeed {
  id: PlayerId;
  name: string;
}

const GOOD_TEAMS: Team[] = ["townsfolk", "outsider"];

function baseSetupCounts(script: ScriptDefinition, playerCount: number): SetupCounts {
  const tabledCounts = script.setupTable[playerCount];
  if (tabledCounts) return tabledCounts;

  const tabledPlayerCounts = Object.keys(script.setupTable).map(Number);
  const maxTabled = Math.max(...tabledPlayerCounts);
  if (playerCount > maxTabled) {
    return script.setupTable[maxTabled] as SetupCounts;
  }
  throw new Error(`No setup counts for ${playerCount} players in script "${script.id}"`);
}

/** Applies any in-play setup modifiers (currently just the Baron) to the base counts. */
export function effectiveSetupCounts(script: ScriptDefinition, playerCount: number, characterIds: CharacterId[]): SetupCounts {
  const base = baseSetupCounts(script, playerCount);
  const hasBaron = characterIds.some((id) => script.characters.find((c) => c.id === id)?.setupModifier === "addsTwoOutsiders");
  if (!hasBaron) return base;
  return { ...base, townsfolk: base.townsfolk - 2, outsider: base.outsider + 2 };
}

export function validateComposition(script: ScriptDefinition, playerCount: number, characterIds: CharacterId[]): void {
  if (characterIds.length !== playerCount) {
    throw new Error(`Expected ${playerCount} characters, got ${characterIds.length}`);
  }
  const expected = effectiveSetupCounts(script, playerCount, characterIds);
  const counts: SetupCounts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of characterIds) {
    const def = script.characters.find((c) => c.id === id);
    if (!def) throw new Error(`Unknown character id "${id}" for script "${script.id}"`);
    if (def.team === "townsfolk" || def.team === "outsider" || def.team === "minion" || def.team === "demon") {
      counts[def.team] += 1;
    }
  }
  for (const team of ["townsfolk", "outsider", "minion", "demon"] as const) {
    if (counts[team] !== expected[team]) {
      throw new Error(
        `Composition mismatch for ${team}: expected ${expected[team]}, got ${counts[team]} (characters: ${characterIds.join(", ")})`,
      );
    }
  }
}

/** Picks a random valid character composition for the given player count. Useful for simulation tests. */
export function randomComposition(script: ScriptDefinition, playerCount: number, rng: Rng): CharacterId[] {
  const base = baseSetupCounts(script, playerCount);
  const minions = script.characters.filter((c) => c.team === "minion");
  const baronDef = minions.find((c) => c.setupModifier === "addsTwoOutsiders");

  const chosenMinions = rng.shuffle(minions).slice(0, base.minion);
  const includeBaron = baronDef !== undefined && chosenMinions.some((c) => c.id === baronDef.id);

  const townsfolkCount = includeBaron ? base.townsfolk - 2 : base.townsfolk;
  const outsiderCount = includeBaron ? base.outsider + 2 : base.outsider;

  const townsfolk = rng.shuffle(script.characters.filter((c) => c.team === "townsfolk")).slice(0, townsfolkCount);
  const outsiders = rng.shuffle(script.characters.filter((c) => c.team === "outsider")).slice(0, outsiderCount);
  const demons = rng.shuffle(script.characters.filter((c) => c.team === "demon")).slice(0, base.demon);

  return [...townsfolk, ...outsiders, ...chosenMinions, ...demons].map((c) => c.id);
}

function alignmentFor(team: Team): Alignment {
  return GOOD_TEAMS.includes(team) ? "good" : "evil";
}

export async function dealGame(
  players: PlayerSeed[],
  script: ScriptDefinition,
  characterIds: CharacterId[],
  decisionProvider: StorytellerDecisionProvider,
  rng: Rng,
): Promise<Grimoire> {
  validateComposition(script, players.length, characterIds);
  return dealSeatedGame(players, script, rng.shuffle(characterIds), decisionProvider, rng);
}

/**
 * Deals a game from a seat-ordered character list (`seatedCharacterIds[i]` goes to `players[i]`)
 * instead of shuffling one internally. Used by the network layer so a Storyteller can hand-adjust
 * a randomly drafted seating (swap who has which character) before the roles are confirmed and
 * sent out - see randomComposition() + rng.shuffle() to produce the initial draft.
 */
export async function dealSeatedGame(
  players: PlayerSeed[],
  script: ScriptDefinition,
  seatedCharacterIds: CharacterId[],
  decisionProvider: StorytellerDecisionProvider,
  rng: Rng,
): Promise<Grimoire> {
  validateComposition(script, players.length, seatedCharacterIds);

  const playerStates: PlayerState[] = players.map((seed, seat) => {
    const characterId = seatedCharacterIds[seat] as CharacterId;
    const def = script.characters.find((c) => c.id === characterId);
    if (!def) throw new Error(`Unknown character id "${characterId}"`);
    return {
      id: seed.id,
      name: seed.name,
      seat,
      characterId,
      alignment: alignmentFor(def.team),
      alive: true,
      ghostVoteAvailable: true,
      poisoned: false,
      drunk: false,
      protectedTonight: false,
      usedSlayerPower: false,
      hasBeenNominated: false,
      reminderTokens: [],
    };
  });

  const grimoire = new Grimoire(playerStates, script);

  const drunkPlayer = playerStates.find((p) => p.characterId === "drunk");
  if (drunkPlayer) {
    const notInPlayTownsfolk = script.characters.filter(
      (c) => c.team === "townsfolk" && !seatedCharacterIds.includes(c.id),
    );
    if (notInPlayTownsfolk.length > 0) {
      drunkPlayer.drunk = true;
      drunkPlayer.drunkShowsAsCharacterId = rng.pick(notInPlayTownsfolk).id;
    }
  }

  const fortuneTellerInPlay = grimoire.findByCharacter("fortune-teller");
  if (fortuneTellerInPlay) {
    const goodPlayerIds = playerStates.filter((p) => p.alignment === "good").map((p) => p.id);
    grimoire.redHerringId = await decisionProvider.chooseRedHerring(goodPlayerIds);
  }

  // Demon bluffs: 3 good characters not in play, shown to the Demon on the first
  // night (7+ players only - see the Demon Info step in nightEngine/demonMinionInfo).
  const notInPlayGoodCharacters = script.characters.filter(
    (c) => (c.team === "townsfolk" || c.team === "outsider") && !seatedCharacterIds.includes(c.id),
  );
  grimoire.demonBluffs = rng.shuffle(notInPlayGoodCharacters).slice(0, 3).map((c) => c.id);

  return grimoire;
}
