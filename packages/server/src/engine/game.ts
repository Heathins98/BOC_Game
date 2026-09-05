import type { CharacterId, PlayerChoiceProvider, PlayerId, ScriptDefinition, StorytellerDecisionProvider } from "@boc/shared";
import { Rng } from "@boc/shared";
import { Grimoire, type NominationRecord } from "./grimoire.js";
import { dealGame, type PlayerSeed } from "./setup.js";
import { runNight } from "./nightEngine.js";
import { castVote, nominate, resolveDayExecutions, useSlayerPower, type NominationOutcome } from "./dayEngine.js";
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

  private constructor(grimoire: Grimoire, decisionProvider: StorytellerDecisionProvider, playerChoiceProvider: PlayerChoiceProvider) {
    this.grimoire = grimoire;
    this.decisionProvider = decisionProvider;
    this.playerChoiceProvider = playerChoiceProvider;
  }

  static async start(config: GameConfig): Promise<GameSession> {
    const grimoire = await dealGame(config.players, config.script, config.characterIds, config.decisionProvider, config.rng);
    return new GameSession(grimoire, config.decisionProvider, config.playerChoiceProvider);
  }

  async runNight(): Promise<Map<PlayerId, unknown>> {
    return runNight({
      grimoire: this.grimoire,
      nightNumber: this.grimoire.nightNumber + 1,
      decisionProvider: this.decisionProvider,
      playerChoiceProvider: this.playerChoiceProvider,
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
