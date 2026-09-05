import type { CharacterId, PlayerId, ScriptId, Team } from "./types.js";

export type InfoClueResult =
  | { kind: "pair"; shownCharacterId: CharacterId; players: [PlayerId, PlayerId] }
  | { kind: "none" };

export interface ChooseInfoClueContext {
  /** The asking character, e.g. "washerwoman". */
  characterId: CharacterId;
  /** In-play players of the target team (Townsfolk/Outsider/Minion) to truthfully reveal one of; empty means none in play. */
  truthfulCandidates: PlayerId[];
  /** Players eligible to be shown as the "wrong" decoy alongside whichever truthful player is picked. */
  decoyCandidates: PlayerId[];
}

export interface MisregistrationContext {
  playerId: PlayerId;
  trueTeam: Team;
  checkingFor: "evil" | "demon";
}

export interface MayorRedirectContext {
  mayorId: PlayerId;
  alivePlayerIds: PlayerId[];
}

/**
 * Every rules-defined "the Storyteller decides, not the player" moment (see the
 * botc-rules skill's Ability Resolution Rules) is routed through here. v1's only
 * implementation is a scripted/random test double (packages/server/src/testUtils);
 * a future human-dashboard-backed implementation and/or a fully-automated
 * implementation plug in here without any change to the engine that calls it.
 */
export interface StorytellerDecisionProvider {
  /** Picks the Fortune Teller's Red Herring once, at setup. */
  chooseRedHerring(candidates: PlayerId[]): Promise<PlayerId>;

  /** Washerwoman/Librarian/Investigator, when NOT drunk/poisoned: which real+decoy pair to show. */
  chooseInfoClue(context: ChooseInfoClueContext): Promise<InfoClueResult>;

  /** Same three abilities, when drunk/poisoned: a fabricated pair with no truthfulness constraint. */
  fabricateInfoClue(context: { characterId: CharacterId; playerId: PlayerId }): Promise<InfoClueResult>;

  /** Undertaker/Ravenkeeper, when drunk/poisoned: a fabricated character to show instead of the truth. */
  fabricateCharacter(context: {
    characterId: CharacterId;
    playerId: PlayerId;
    scriptId: ScriptId;
  }): Promise<CharacterId>;

  /** Chef/Empath, when drunk/poisoned: a fabricated count instead of the truth. */
  fabricateNumber(context: { characterId: CharacterId; playerId: PlayerId; plausibleMax: number }): Promise<number>;

  /** Fortune Teller, when drunk/poisoned: a fabricated yes/no instead of the truth. */
  fabricateBoolean(context: { characterId: CharacterId; playerId: PlayerId }): Promise<boolean>;

  /**
   * Whether `playerId` (a Recluse or Spy) registers as the opposite side for this
   * particular check. Only ever called for actual Recluses/Spies - every other
   * player's detection reads its own true alignment directly.
   */
  resolveMisregistration(context: MisregistrationContext): Promise<boolean>;

  /** Which living Minion becomes the new Demon (Imp self-kill or Scarlet Woman). */
  choosePromotedMinion(candidates: PlayerId[]): Promise<PlayerId>;

  /** Whether/where to silently redirect a night-kill that targeted the Mayor. Null = no redirect. */
  wantsMayorRedirect(context: MayorRedirectContext): Promise<PlayerId | null>;
}
