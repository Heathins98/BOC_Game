import type {
  ChooseInfoClueContext,
  ChoosePlayersPrompt,
  InfoClueResult,
  MayorRedirectContext,
  MisregistrationContext,
  PlayerChoiceProvider,
  PlayerId,
  StorytellerDecisionProvider,
} from "@boc/shared";
import type { Grimoire } from "../engine/grimoire.js";

type Overrides = { [K in keyof StorytellerDecisionProvider]?: StorytellerDecisionProvider[K] };

/**
 * Deterministic StorytellerDecisionProvider for unit tests: sensible, truthful
 * defaults for every decision point, with per-test overrides for whichever
 * call the test actually cares about.
 */
export class ScriptedDecisionProvider implements StorytellerDecisionProvider {
  constructor(private readonly grimoire: Grimoire, private readonly overrides: Overrides = {}) {}

  chooseRedHerring(candidates: PlayerId[]): Promise<PlayerId> {
    if (this.overrides.chooseRedHerring) return this.overrides.chooseRedHerring(candidates);
    return Promise.resolve(candidates[0] as PlayerId);
  }

  chooseInfoClue(context: ChooseInfoClueContext): Promise<InfoClueResult> {
    if (this.overrides.chooseInfoClue) return this.overrides.chooseInfoClue(context);
    if (context.truthfulCandidates.length === 0) return Promise.resolve({ kind: "none" });
    const truePlayerId = context.truthfulCandidates[0] as PlayerId;
    const shownCharacterId = this.grimoire.getPlayer(truePlayerId).characterId;
    const decoy = (context.decoyCandidates.find((id) => id !== truePlayerId) ?? context.decoyCandidates[0]) as PlayerId;
    return Promise.resolve({ kind: "pair", shownCharacterId, players: [truePlayerId, decoy] });
  }

  fabricateInfoClue(context: { characterId: string; playerId: PlayerId }): Promise<InfoClueResult> {
    if (this.overrides.fabricateInfoClue) return this.overrides.fabricateInfoClue(context);
    return Promise.resolve({ kind: "none" });
  }

  fabricateCharacter(context: { characterId: string; playerId: PlayerId; scriptId: string }): Promise<string> {
    if (this.overrides.fabricateCharacter) return this.overrides.fabricateCharacter(context);
    return Promise.resolve(this.grimoire.script.characters[0]!.id);
  }

  fabricateNumber(context: { characterId: string; playerId: PlayerId; plausibleMax: number }): Promise<number> {
    if (this.overrides.fabricateNumber) return this.overrides.fabricateNumber(context);
    return Promise.resolve(0);
  }

  fabricateBoolean(context: { characterId: string; playerId: PlayerId }): Promise<boolean> {
    if (this.overrides.fabricateBoolean) return this.overrides.fabricateBoolean(context);
    return Promise.resolve(false);
  }

  resolveMisregistration(context: MisregistrationContext): Promise<boolean> {
    if (this.overrides.resolveMisregistration) return this.overrides.resolveMisregistration(context);
    const truthful = context.checkingFor === "demon" ? context.trueTeam === "demon" : context.trueTeam === "minion" || context.trueTeam === "demon";
    return Promise.resolve(truthful);
  }

  choosePromotedMinion(candidates: PlayerId[]): Promise<PlayerId> {
    if (this.overrides.choosePromotedMinion) return this.overrides.choosePromotedMinion(candidates);
    return Promise.resolve(candidates[0] as PlayerId);
  }

  wantsMayorRedirect(context: MayorRedirectContext): Promise<PlayerId | null> {
    if (this.overrides.wantsMayorRedirect) return this.overrides.wantsMayorRedirect(context);
    return Promise.resolve(null);
  }
}

/**
 * Deterministic PlayerChoiceProvider for unit tests: a resolver function
 * inspects the prompt and returns a specific choice, falling back to "the
 * first N candidates" when it returns undefined.
 */
export class ScriptedPlayerChoiceProvider implements PlayerChoiceProvider {
  constructor(private readonly resolve: (prompt: ChoosePlayersPrompt) => PlayerId[] | undefined = () => undefined) {}

  requestPlayerChoice(prompt: ChoosePlayersPrompt): Promise<PlayerId[]> {
    const chosen = this.resolve(prompt);
    return Promise.resolve(chosen ?? prompt.candidates.slice(0, prompt.count));
  }
}
