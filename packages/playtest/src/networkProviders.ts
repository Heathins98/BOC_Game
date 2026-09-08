import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import type {
  ChooseInfoClueContext,
  InfoClueResult,
  MayorRedirectContext,
  MisregistrationContext,
  PlayerId,
  StorytellerDecisionProvider,
  ChoosePlayersPrompt,
  PlayerChoiceProvider,
} from "@boc/shared";
import type { Grimoire } from "@boc/server";

/**
 * Bridges StorytellerDecisionProvider over a socket to a human Storyteller CLI.
 * Every method sends one free-text prompt and parses whatever comes back -
 * this keeps the Storyteller CLI itself completely generic (it just relays
 * prompt/answer pairs) while all the parsing/validation smarts live here.
 */
export class NetworkDecisionProvider implements StorytellerDecisionProvider {
  grimoire!: Grimoire;
  private readonly pending = new Map<string, { socketId: string; resolve: (value: string) => void }>();

  constructor(
    private readonly getStorytellerSocket: () => Socket | null,
    /** When true, Recluse/Spy always read as their true alignment - no misregistration prompt. */
    private readonly noMisregistration = false,
  ) {}

  /** Only resolves if `fromSocketId` is the socket the prompt was actually sent to - prevents another connection from answering on the Storyteller's behalf. */
  resolveDecision(requestId: string, value: string, fromSocketId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry || entry.socketId !== fromSocketId) return;
    this.pending.delete(requestId);
    entry.resolve(value);
  }

  /** Falls back the same way as "no Storyteller connected" if the socket that was asked disconnects before answering - otherwise the game would hang forever. */
  handleDisconnect(socketId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.socketId !== socketId) continue;
      this.pending.delete(requestId);
      entry.resolve("");
    }
  }

  private ask(prompt: string): Promise<string> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const socket = this.getStorytellerSocket();
      if (!socket) {
        resolve(""); // no Storyteller connected - fall back to defaults below
        return;
      }
      this.pending.set(requestId, { socketId: socket.id, resolve });
      socket.emit("st:decisionRequest", { requestId, prompt });
    });
  }

  async chooseRedHerring(candidates: PlayerId[]): Promise<PlayerId> {
    const answer = await this.ask(
      `Choose the Red Herring - a good player who will always register as the Demon to the Fortune Teller.\nOptions: ${candidates.join(", ")}`,
    );
    return candidates.includes(answer.trim()) ? answer.trim() : (candidates[0] as PlayerId);
  }

  async chooseInfoClue(context: ChooseInfoClueContext): Promise<InfoClueResult> {
    if (context.truthfulCandidates.length === 0) return { kind: "none" };

    const exampleTrue = context.truthfulCandidates[0] as PlayerId;
    const exampleDecoy = (context.decoyCandidates.find((id) => id !== exampleTrue) ?? context.decoyCandidates[0]) as PlayerId;
    const basePrompt =
      `${context.characterId}: choose the TRUE player and a DECOY player.\n` +
      `True options: ${context.truthfulCandidates.join(", ")}\n` +
      `Decoy options: ${context.decoyCandidates.join(", ")}\n` +
      `Reply with exactly two comma-separated names: TRUE,DECOY (e.g. "${exampleTrue},${exampleDecoy}")`;

    let prompt = basePrompt;
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const answer = await this.ask(prompt);
      const parts = answer
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts.length !== 2) {
        prompt = `Expected exactly two comma-separated names, got "${answer.trim()}".\n${basePrompt}`;
        continue;
      }
      const [truePlayerId, decoyId] = parts as [PlayerId, PlayerId];
      if (!context.truthfulCandidates.includes(truePlayerId)) {
        prompt = `"${truePlayerId}" is not a valid TRUE option (must be one of: ${context.truthfulCandidates.join(", ")}).\n${basePrompt}`;
        continue;
      }
      if (!context.decoyCandidates.includes(decoyId)) {
        prompt = `"${decoyId}" is not a valid DECOY option (must be one of: ${context.decoyCandidates.join(", ")}).\n${basePrompt}`;
        continue;
      }
      if (decoyId === truePlayerId) {
        prompt = `TRUE and DECOY must be different players - got "${truePlayerId}" for both.\n${basePrompt}`;
        continue;
      }

      const shownCharacterId = this.grimoire.getPlayer(truePlayerId).characterId;
      return { kind: "pair", shownCharacterId, players: [truePlayerId, decoyId] };
    }

    // No Storyteller connected (ask() resolves to "" immediately), or repeated bad
    // input - fall back rather than loop forever.
    const truePlayerId = context.truthfulCandidates[0] as PlayerId;
    const decoyId = (context.decoyCandidates.find((id) => id !== truePlayerId) ?? context.decoyCandidates[0]) as PlayerId;
    return { kind: "pair", shownCharacterId: this.grimoire.getPlayer(truePlayerId).characterId, players: [truePlayerId, decoyId] };
  }

  async fabricateInfoClue(context: { characterId: string; playerId: PlayerId }): Promise<InfoClueResult> {
    const answer = await this.ask(
      `${context.playerId} is drunk/poisoned as the ${context.characterId}. Give a fabricated "true,decoy" pair of any two players to show them.`,
    );
    const [a, b] = answer.split(",").map((s) => s.trim());
    const fallback = this.grimoire.seatOrder[0] as PlayerId;
    const shownCharacterId = (this.grimoire.script.characters[0]?.id ?? "washerwoman") as string;
    return { kind: "pair", shownCharacterId, players: [(a || fallback) as PlayerId, (b || fallback) as PlayerId] };
  }

  async fabricateCharacter(context: { characterId: string; playerId: PlayerId }): Promise<string> {
    const answer = await this.ask(
      `${context.playerId} is drunk/poisoned as the ${context.characterId}. What fabricated character should they be told (e.g. "empath")?`,
    );
    const found = this.grimoire.script.characters.find((c) => c.id === answer.trim());
    return found?.id ?? (this.grimoire.script.characters[0]?.id as string);
  }

  async fabricateNumber(context: { characterId: string; playerId: PlayerId; plausibleMax: number }): Promise<number> {
    const answer = await this.ask(
      `${context.playerId} is drunk/poisoned as the ${context.characterId}. Give a fabricated number (0-${context.plausibleMax}).`,
    );
    const n = Number(answer.trim());
    return Number.isFinite(n) ? n : 0;
  }

  async fabricateBoolean(context: { characterId: string; playerId: PlayerId }): Promise<boolean> {
    const answer = await this.ask(`${context.playerId} is drunk/poisoned as the ${context.characterId}. Fabricated result - yes or no?`);
    return /^y/i.test(answer.trim());
  }

  async resolveMisregistration(context: MisregistrationContext): Promise<boolean> {
    const truthful = context.checkingFor === "demon" ? context.trueTeam === "demon" : context.trueTeam === "minion" || context.trueTeam === "demon";
    if (this.noMisregistration) return truthful;
    const characterName = context.characterId.charAt(0).toUpperCase() + context.characterId.slice(1);

    if (context.checkingFor === "demon") {
      const answer = await this.ask(
        `${context.playerId} is the ${characterName} - they might register as good or evil (and as any character) to detection abilities; it's the Storyteller's call each time. ` +
          `A Fortune Teller is checking right now whether ${context.playerId} is the Demon. Truthfully, ${context.playerId} is ${truthful ? "" : "not "}the Demon. ` +
          `Should this check see them as the Demon? yes/no`,
      );
      return /^y/i.test(answer.trim());
    }

    const answer = await this.ask(
      `${context.playerId} is the ${characterName} - they might register as good or evil to detection abilities; it's the Storyteller's call each time. ` +
        `A detection ability is checking right now whether ${context.playerId} is evil. Truthfully, ${context.playerId} is ${context.trueTeam} (${truthful ? "evil" : "good"}). ` +
        `Should ${context.playerId} read as "good" or "evil" for this check?`,
    );
    return /^e/i.test(answer.trim());
  }

  async choosePromotedMinion(candidates: PlayerId[]): Promise<PlayerId> {
    const answer = await this.ask(`A Minion must become the new Demon.\nOptions: ${candidates.join(", ")}`);
    return candidates.includes(answer.trim()) ? answer.trim() : (candidates[0] as PlayerId);
  }

  async wantsMayorRedirect(context: MayorRedirectContext): Promise<PlayerId | null> {
    const others = context.alivePlayerIds.filter((id) => id !== context.mayorId);
    if (others.length === 0) return null;
    const answer = await this.ask(
      `The Demon's kill targeted the Mayor (${context.mayorId}). Redirect to another player instead?\n` +
        `Type a name from [${others.join(", ")}], or "no".`,
    );
    const trimmed = answer.trim();
    if (!trimmed || trimmed.toLowerCase() === "no") return null;
    return others.includes(trimmed) ? trimmed : null;
  }
}

/**
 * Bridges PlayerChoiceProvider over a socket to whichever player's CLI is
 * currently being asked. Same free-text-prompt/parse-here approach as above.
 */
export class NetworkPlayerChoiceProvider implements PlayerChoiceProvider {
  private readonly pending = new Map<string, { socketId: string; resolve: (value: string) => void }>();

  constructor(private readonly getPlayerSocket: (playerId: PlayerId) => Socket | undefined) {}

  /** Only resolves if `fromSocketId` is the socket the prompt was actually sent to - prevents another connection from answering on that player's behalf. */
  resolveChoice(requestId: string, value: string, fromSocketId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry || entry.socketId !== fromSocketId) return;
    this.pending.delete(requestId);
    entry.resolve(value);
  }

  /** Falls back to the empty answer (which requestPlayerChoice below turns into its candidate fallback) if the targeted player disconnects before answering - otherwise the game would hang forever. */
  handleDisconnect(socketId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.socketId !== socketId) continue;
      this.pending.delete(requestId);
      entry.resolve("");
    }
  }

  async requestPlayerChoice(prompt: ChoosePlayersPrompt): Promise<PlayerId[]> {
    const socket = this.getPlayerSocket(prompt.playerId);
    const fallback = () => prompt.candidates.slice(0, prompt.count);
    if (!socket) return fallback();

    const requestId = randomUUID();
    const promptText = `As the ${prompt.characterId}, choose ${prompt.count} player(s) from: ${prompt.candidates.join(", ")}`;
    const answer = await new Promise<string>((resolve) => {
      this.pending.set(requestId, { socketId: socket.id, resolve });
      socket.emit("night:prompt", { requestId, prompt: promptText, count: prompt.count, candidates: prompt.candidates });
    });

    const names = answer
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = names.filter((n) => prompt.candidates.includes(n));
    return valid.length >= prompt.count ? valid.slice(0, prompt.count) : fallback();
  }
}
