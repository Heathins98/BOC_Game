import type { CharacterDefinition, CharacterId, PlayerId, PlayerState, ScriptDefinition } from "@boc/shared";

export type Phase = "setup" | "night" | "day" | "townhall" | "nominations" | "game-over";

export interface NominationRecord {
  nominatorId: PlayerId;
  nomineeId: PlayerId;
  votersInFavor: Set<PlayerId>;
}

export class Grimoire {
  readonly script: ScriptDefinition;
  private readonly characterMap: Map<CharacterId, CharacterDefinition>;
  private readonly players: Map<PlayerId, PlayerState>;
  /** Seat order, ascending. The seating circle wraps from the last entry back to the first. */
  readonly seatOrder: PlayerId[];

  redHerringId: PlayerId | null = null;
  /** 3 good characters not in play this game, shown to the Demon on the first night as bluffs. */
  demonBluffs: CharacterId[] = [];

  phase: Phase = "setup";
  nightNumber = 0;
  dayNumber = 0;

  /** Reset at the start of each night; players who died since the last dusk. */
  readonly diedTonight = new Set<PlayerId>();
  /** Reset at the start of each day; set when an execution actually occurs. */
  executedPlayerId: PlayerId | null = null;
  /** Player promoted to Demon today (execution/Slayer death triggering Scarlet Woman), if any. Cleared at the next dawn. */
  newlyDemonPlayerId: PlayerId | null = null;
  /** All nominations made today, in the order they were made. */
  nominationsToday: NominationRecord[] = [];

  constructor(players: PlayerState[], script: ScriptDefinition) {
    this.script = script;
    this.characterMap = new Map(script.characters.map((c) => [c.id, c]));
    this.players = new Map(players.map((p) => [p.id, p]));
    this.seatOrder = players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
  }

  getPlayer(id: PlayerId): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new Error(`Unknown player: ${id}`);
    return player;
  }

  allPlayers(): PlayerState[] {
    return this.seatOrder.map((id) => this.getPlayer(id));
  }

  livingPlayers(): PlayerState[] {
    return this.allPlayers().filter((p) => p.alive);
  }

  characterOf(id: PlayerId): CharacterDefinition {
    const player = this.getPlayer(id);
    const def = this.characterMap.get(player.characterId);
    if (!def) throw new Error(`Unknown character id: ${player.characterId}`);
    return def;
  }

  /** True for a healthy character whose ability functions normally. */
  isFunctioning(id: PlayerId): boolean {
    const player = this.getPlayer(id);
    return !player.poisoned && !player.drunk;
  }

  /**
   * Finds whoever currently holds `characterId`, preferring a living holder.
   * A dead player can keep a characterId a promotion (Imp self-kill, Scarlet
   * Woman) has since handed to someone else - e.g. after such a promotion,
   * both the original dead Demon and their living successor briefly share an
   * id. Falling back to a dead holder only when no living one exists is what
   * still lets a death-triggered slot like the Ravenkeeper find themselves.
   */
  findByCharacter(characterId: CharacterId): PlayerId | undefined {
    const players = this.allPlayers().filter((p) => p.characterId === characterId);
    return (players.find((p) => p.alive) ?? players[0])?.id;
  }

  findAllByCharacter(characterId: CharacterId): PlayerId[] {
    return this.allPlayers()
      .filter((p) => p.characterId === characterId)
      .map((p) => p.id);
  }

  /** Nearest living player in each direction around the seating circle (may repeat if only one other player is alive). */
  livingNeighbors(id: PlayerId): [PlayerId, PlayerId] {
    const n = this.seatOrder.length;
    const index = this.seatOrder.indexOf(id);
    if (index === -1) throw new Error(`Unknown player: ${id}`);

    const findDirection = (step: 1 | -1): PlayerId => {
      for (let offset = 1; offset < n; offset++) {
        const candidateId = this.seatOrder[((index + step * offset) % n + n) % n] as PlayerId;
        if (this.getPlayer(candidateId).alive) return candidateId;
      }
      throw new Error("No other living player found");
    };

    return [findDirection(-1), findDirection(1)];
  }

  markDead(id: PlayerId): void {
    const player = this.getPlayer(id);
    player.alive = false;
    if (this.phase === "night") this.diedTonight.add(id);
  }

  startNight(nightNumber: number): void {
    this.phase = "night";
    this.nightNumber = nightNumber;
    this.diedTonight.clear();
    // Poison lasts "tonight and tomorrow day"; since the Poisoner always acts first in night
    // order, clearing here (before their handler runs) is equivalent to clearing at the moment
    // the previous poisoning's duration actually expires.
    for (const player of this.allPlayers()) {
      player.protectedTonight = false;
      player.poisoned = false;
    }
  }

  startDay(dayNumber: number): void {
    this.phase = "day";
    this.dayNumber = dayNumber;
    this.executedPlayerId = null;
    this.newlyDemonPlayerId = null;
    this.nominationsToday = [];
  }

  /** Moves from free Day discussion into the (timed or untimed) Town Hall sub-phase. Same calendar day, no state reset. */
  enterTownHall(): void {
    this.phase = "townhall";
  }

  /** Moves from Town Hall into the Nominations sub-phase. Same calendar day, no state reset. */
  enterNominations(): void {
    this.phase = "nominations";
  }
}
