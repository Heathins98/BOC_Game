import type {
  ChooseInfoClueContext,
  ChoosePlayersPrompt,
  InfoClueResult,
  MayorRedirectContext,
  MisregistrationContext,
  PlayerChoiceProvider,
  PlayerId,
  Rng,
  StorytellerDecisionProvider,
} from "@boc/shared";
import type { Grimoire } from "../engine/grimoire.js";

/** How often an in-play Recluse/Spy actually misregisters, in the random simulation. */
const MISREGISTRATION_CHANCE = 0.3;

/**
 * Random-but-legal StorytellerDecisionProvider, for full-game simulation tests.
 * `grimoire` is settable rather than constructor-required because dealGame calls
 * chooseRedHerring() - the one method here that never touches it - before the
 * Grimoire it's building exists as a value the caller can pass in.
 */
export class RandomDecisionProvider implements StorytellerDecisionProvider {
  grimoire!: Grimoire;

  constructor(private readonly rng: Rng, grimoire?: Grimoire) {
    if (grimoire) this.grimoire = grimoire;
  }

  async chooseRedHerring(candidates: PlayerId[]): Promise<PlayerId> {
    return this.rng.pick(candidates);
  }

  async chooseInfoClue(context: ChooseInfoClueContext): Promise<InfoClueResult> {
    if (context.truthfulCandidates.length === 0) return { kind: "none" };
    const truePlayerId = this.rng.pick(context.truthfulCandidates);
    const shownCharacterId = this.grimoire.getPlayer(truePlayerId).characterId;
    const decoyPool = context.decoyCandidates.filter((id) => id !== truePlayerId);
    const decoy = decoyPool.length > 0 ? this.rng.pick(decoyPool) : truePlayerId;
    return { kind: "pair", shownCharacterId, players: [truePlayerId, decoy] };
  }

  async fabricateInfoClue(): Promise<InfoClueResult> {
    const players = this.grimoire.allPlayers().map((p) => p.id);
    const a = this.rng.pick(players);
    const b = this.rng.pick(players);
    const shownCharacterId = this.rng.pick(this.grimoire.script.characters).id;
    return { kind: "pair", shownCharacterId, players: [a, b] };
  }

  async fabricateCharacter(): Promise<string> {
    return this.rng.pick(this.grimoire.script.characters).id;
  }

  async fabricateNumber(context: { plausibleMax: number }): Promise<number> {
    return this.rng.nextInt(context.plausibleMax + 1);
  }

  async fabricateBoolean(): Promise<boolean> {
    return this.rng.next() < 0.5;
  }

  async resolveMisregistration(context: MisregistrationContext): Promise<boolean> {
    const truthful = context.checkingFor === "demon" ? context.trueTeam === "demon" : context.trueTeam === "minion" || context.trueTeam === "demon";
    const misregisters = this.rng.next() < MISREGISTRATION_CHANCE;
    return misregisters ? !truthful : truthful;
  }

  async choosePromotedMinion(candidates: PlayerId[]): Promise<PlayerId> {
    return this.rng.pick(candidates);
  }

  async wantsMayorRedirect(context: MayorRedirectContext): Promise<PlayerId | null> {
    const others = context.alivePlayerIds.filter((id) => id !== context.mayorId);
    if (others.length === 0 || this.rng.next() >= 0.5) return null;
    return this.rng.pick(others);
  }
}

/** Random-but-legal PlayerChoiceProvider, for full-game simulation tests. */
export class RandomPlayerChoiceProvider implements PlayerChoiceProvider {
  constructor(private readonly rng: Rng) {}

  async requestPlayerChoice(prompt: ChoosePlayersPrompt): Promise<PlayerId[]> {
    return this.rng.shuffle(prompt.candidates).slice(0, prompt.count);
  }
}
