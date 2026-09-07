export type PlayerId = string;
export type CharacterId = string;
export type ScriptId = string;

export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";
export type Alignment = "good" | "evil";

/** Conditions that gate whether a night-order slot actually fires on a given night. */
export type NightCondition =
  | "diedTonight" // Ravenkeeper: only wakes on the night they die
  | "becameDemonToday" // Scarlet Woman: only wakes the night they became the Demon
  | "executionOccurredToday" // Undertaker: only wakes if an execution happened today
  | "actsWhileDead"; // Spy: still wakes/acts after death

/** One entry in a script's ordered night sequence. */
export interface NightOrderSlot {
  characterId: CharacterId;
  condition?: NightCondition;
}

/**
 * Static, script-agnostic metadata for one character. Deliberately holds no
 * behavior - ability logic lives in packages/server, keyed by `id`, so this
 * package stays a plain data dependency any client can also import (e.g. to
 * render ability text) without pulling in engine internals. Night ordering
 * lives on the ScriptDefinition, not here, so it has exactly one home.
 */
export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  team: Team;
  script: ScriptId;
  abilityText: string;
  /** Setup-time headcount modifier, e.g. the Baron's +2 Outsiders / -2 Townsfolk. */
  setupModifier?: "addsTwoOutsiders";
}

export interface SetupCounts {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
}

export interface ScriptDefinition {
  id: ScriptId;
  characters: CharacterDefinition[];
  /** Base setup counts by player count, before any setupModifier is applied. */
  setupTable: Record<number, SetupCounts>;
  /** Bookend steps (Dusk/Minion Info/Demon Info/Dawn) are engine-level, not data. */
  firstNightOrder: NightOrderSlot[];
  otherNightOrder: NightOrderSlot[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  seat: number;
  characterId: CharacterId;
  alignment: Alignment;
  alive: boolean;
  ghostVoteAvailable: boolean;
  poisoned: boolean;
  drunk: boolean;
  /** Set by the Monk each night; cleared at the start of the next night. */
  protectedTonight: boolean;
  usedSlayerPower: boolean;
  /** True once this player has been the subject of their first nomination (Virgin check). */
  hasBeenNominated: boolean;
  /** Butler's chosen "master" for the current day's voting, if this player is the Butler. */
  butlerMasterId?: PlayerId | undefined;
  /** The fake Townsfolk identity this player believes they have, if their true characterId is "drunk". */
  drunkShowsAsCharacterId?: CharacterId | undefined;
  reminderTokens: string[];
}

/**
 * The Spy's "you see the Grimoire" result - the true board state when healthy, or a
 * fabricated one (same players/cast, characters reassigned as a derangement) when
 * poisoned/drunk. Both cases share this exact shape so the player can't tell which
 * they received.
 */
export interface SpyGrimoireResult {
  kind: "grimoire";
  redHerringId: PlayerId | null;
  players: Pick<
    PlayerState,
    | "id"
    | "characterId"
    | "alignment"
    | "alive"
    | "poisoned"
    | "drunk"
    | "drunkShowsAsCharacterId"
    | "protectedTonight"
    | "usedSlayerPower"
    | "butlerMasterId"
  >[];
}
