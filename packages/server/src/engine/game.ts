import type { CharacterId, PlayerChoiceProvider, PlayerId, ScriptDefinition, StorytellerDecisionProvider } from "@boc/shared";
import { Rng } from "@boc/shared";
import { Grimoire, type NominationRecord } from "./grimoire.js";
import { dealGame, dealSeatedGame, type PlayerSeed } from "./setup.js";
import { runNight } from "./nightEngine.js";
import {
  castVote,
  concludeVote,
  currentBlockHolder,
  nominate,
  resolveDayExecutions,
  useSlayerPower,
  type BlockHolder,
  type NominationOutcome,
  type VoteConclusion,
} from "./dayEngine.js";
import { checkSaintExecutionLoss, checkWinConditions, type WinResult } from "./winConditions.js";

export interface GameConfig {
  players: PlayerSeed[];
  script: ScriptDefinition;
  characterIds: CharacterId[];
  decisionProvider: StorytellerDecisionProvider;
  playerChoiceProvider: PlayerChoiceProvider;
  rng: Rng;
}

/**
 * Thin, stateful convenience wrapper around the standalone engine functions
 * (setup/nightEngine/dayEngine/winConditions), giving callers - tests, the
 * simulation suite, and eventually the network layer - a single object to
 * drive a game through instead of threading a Grimoire through every call.
 */
export class GameSession {
  readonly grimoire: Grimoire;
  private readonly decisionProvider: StorytellerDecisionProvider;
  private readonly playerChoiceProvider: PlayerChoiceProvider;
  /** Retained past setup so night actions (e.g. the Spy's fabricated board) can use seeded randomness too. */
  private readonly rng: Rng;

  private constructor(grimoire: Grimoire, decisionProvider: StorytellerDecisionProvider, playerChoiceProvider: PlayerChoiceProvider, rng: Rng) {
    this.grimoire = grimoire;
    this.decisionProvider = decisionProvider;
    this.playerChoiceProvider = playerChoiceProvider;
    this.rng = rng;
  }

  static async start(config: GameConfig): Promise<GameSession> {
    const grimoire = await dealGame(config.players, config.script, config.characterIds, config.decisionProvider, config.rng);
    return new GameSession(grimoire, config.decisionProvider, config.playerChoiceProvider, config.rng);
  }

  /**
   * Like start(), but takes a seat-ordered character list (seatedCharacterIds[i] -> players[i])
   * instead of shuffling one internally - for a Storyteller-confirmed draft seating.
   */
  static async startSeated(config: Omit<GameConfig, "characterIds"> & { seatedCharacterIds: CharacterId[] }): Promise<GameSession> {
    const grimoire = await dealSeatedGame(
      config.players,
      config.script,
      config.seatedCharacterIds,
      config.decisionProvider,
      config.rng,
    );
    return new GameSession(grimoire, config.decisionProvider, config.playerChoiceProvider, config.rng);
  }

  async runNight(onResult?: (playerId: PlayerId, result: unknown) => void): Promise<Map<PlayerId, unknown>> {
    return runNight({
      grimoire: this.grimoire,
      nightNumber: this.grimoire.nightNumber + 1,
      rng: this.rng,
      decisionProvider: this.decisionProvider,
      playerChoiceProvider: this.playerChoiceProvider,
      onResult,
    });
  }

  startDay(): void {
    this.grimoire.startDay(this.grimoire.dayNumber + 1);
  }

  nominate(nominatorId: PlayerId, nomineeId: PlayerId): NominationOutcome {
    return nominate(this.grimoire, nominatorId, nomineeId);
  }

  castVote(nomination: NominationRecord, voterId: PlayerId): boolean {
    return castVote(this.grimoire, nomination, voterId);
  }

  concludeVote(): VoteConclusion {
    return concludeVote(this.grimoire);
  }

  currentBlockHolder(): BlockHolder | null {
    return currentBlockHolder(this.grimoire);
  }

  votingOrderFor(nomineeId: PlayerId): PlayerId[] {
    return this.grimoire.votingOrderFor(nomineeId);
  }

  hasVotingCapacity(voterId: PlayerId): boolean {
    return this.grimoire.hasVotingCapacity(voterId);
  }

  resolveDayExecutions(): { executedPlayerId: PlayerId | null } {
    return resolveDayExecutions(this.grimoire);
  }

  async useSlayerPower(slayerId: PlayerId, targetId: PlayerId): Promise<boolean> {
    return useSlayerPower(this.grimoire, slayerId, targetId, this.decisionProvider);
  }

  /** Checks the Saint's execution-loss condition (if an execution just happened) and the standard win conditions. */
  checkWin(): WinResult | null {
    if (this.grimoire.executedPlayerId) {
      const saintLoss = checkSaintExecutionLoss(this.grimoire, this.grimoire.executedPlayerId);
      if (saintLoss) return saintLoss;
    }
    return checkWinConditions(this.grimoire);
  }
}
