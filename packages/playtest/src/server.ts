import { createServer } from "node:http";
import { randomUUID, randomInt } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { Rng, TROUBLE_BREWING } from "@boc/shared";
import type { CharacterId, PlayerId, Team } from "@boc/shared";
import { GameSession, randomComposition, type WinResult } from "@boc/server";
import { NetworkDecisionProvider, NetworkPlayerChoiceProvider } from "./networkProviders.js";

function generateSessionCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
  };
  const seedArg = get("--seed", "");
  const codeArg = get("--code", "");
  return {
    players: Number(get("--players", "5")),
    port: Number(get("--port", "3131")),
    seed: seedArg ? Number(seedArg) : randomInt(0, 1_000_000_000),
    code: codeArg || generateSessionCode(),
    townHallSeconds: Number(get("--townhall-seconds", "120")),
    noMisregistration: args.includes("--no-misregistration"),
    voteSeconds: Number(get("--vote-seconds", "5")),
  };
}

const {
  players: expectedPlayerCount,
  port,
  seed,
  code: sessionCode,
  townHallSeconds: defaultTownHallSeconds,
  noMisregistration,
  voteSeconds,
} = parseArgs();

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/** For server-log lines: "playerId (characterId)" when a game is in progress and the player is in it, else just the bare id. */
function describePlayer(playerId: PlayerId | undefined): string {
  if (!playerId) return "unknown";
  const characterId = session?.grimoire.allPlayers().find((p) => p.id === playerId)?.characterId;
  return characterId ? `${playerId} (${characterId})` : playerId;
}

process.on("uncaughtException", (err) => {
  log(`UNCAUGHT EXCEPTION (server kept running): ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  log(`UNHANDLED REJECTION (server kept running): ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: false } });

const players = new Map<PlayerId, Socket>();
const readyPlayers = new Set<PlayerId>();
let storytellerSocket: Socket | null = null;
let session: GameSession | null = null;
let gameOver = false;

interface SetupDraft {
  /** Fixed player order this draft was built against - reused unchanged when confirming. */
  playerIds: PlayerId[];
  /** seating[i] is the characterId currently assigned to playerIds[i]. */
  seating: CharacterId[];
  rng: Rng;
}
let draft: SetupDraft | null = null;

let resolveAllReady: (() => void) | null = null;
let resolveTownHallStart: ((seconds: number | null) => void) | null = null;
let resolvePhaseAdvance: (() => void) | null = null;
let resolveVoteStart: (() => void) | null = null;
let townHallTimer: NodeJS.Timeout | null = null;
let townHallEndsAt: number | null = null;

/** "open" = ready for a nomination; "discussing" = one made, waiting on the Storyteller's "vote" command; "voting" = the clock is running. */
let nominationSubPhase: "open" | "discussing" | "voting" | null = null;
let nominationsForced = false;
let voteClockCurrentVoterId: PlayerId | null = null;
let voteTurnEndsAt: number | null = null;
let voteTurnTimer: NodeJS.Timeout | null = null;
const pendingVoteResponses = new Map<string, { voterId: PlayerId; finish: (voted: boolean) => void }>();

const decisionProvider = new NetworkDecisionProvider(() => storytellerSocket, noMisregistration);
const playerChoiceProvider = new NetworkPlayerChoiceProvider((id) => players.get(id));

function sendInfo(playerId: PlayerId, message: string) {
  players.get(playerId)?.emit("info", { message });
}

function broadcastInfo(message: string) {
  for (const socket of players.values()) socket.emit("info", { message });
  storytellerSocket?.emit("info", { message });
}

function sendInfoToStoryteller(message: string) {
  storytellerSocket?.emit("info", { message });
}

function broadcastLobbyUpdate() {
  const readyToStart = players.size === expectedPlayerCount && !!storytellerSocket && !draft && !session;
  const payload = { playersJoined: players.size, playersExpected: expectedPlayerCount, storytellerJoined: !!storytellerSocket, readyToStart };
  for (const socket of players.values()) socket.emit("lobby:update", payload);
  storytellerSocket?.emit("lobby:update", payload);
}

function broadcastLobbyReadyStatus() {
  const waitingOnIds = [...players.keys()].filter((id) => !readyPlayers.has(id));
  const payload = { readyIds: [...readyPlayers], waitingOnIds };
  for (const socket of players.values()) socket.emit("lobby:readyStatus", payload);
  storytellerSocket?.emit("lobby:readyStatus", payload);
}

function publicStatePayload() {
  const g = session!.grimoire;
  const threshold = Math.ceil(g.livingPlayers().length / 2);
  const holder = session!.currentBlockHolder();
  return {
    phase: g.phase,
    night: g.nightNumber,
    day: g.dayNumber,
    townHallEndsAt,
    players: g.allPlayers().map((p) => ({ id: p.id, alive: p.alive, seat: p.seat })),
    nominationSubPhase,
    activeVote: g.activeNomination
      ? {
          nominatorId: g.activeNomination.nominatorId,
          nomineeId: g.activeNomination.nomineeId,
          currentVoterId: voteClockCurrentVoterId,
          turnEndsAt: voteTurnEndsAt,
          votesSoFar: g.activeNomination.votersInFavor.size,
        }
      : null,
    blockHolder: holder ? { nominatorId: holder.nomination.nominatorId, nomineeId: holder.nomination.nomineeId, votes: holder.voteCount } : null,
    nominationHistory: g.nominationsToday
      .filter((n) => n.concluded)
      .map((n) => ({
        nominatorId: n.nominatorId,
        nomineeId: n.nomineeId,
        votes: n.votersInFavor.size,
        metThreshold: n.votersInFavor.size >= threshold,
      })),
  };
}

function broadcastPublicState() {
  const payload = publicStatePayload();
  for (const socket of players.values()) socket.emit("state:public", payload);
  storytellerSocket?.emit("state:public", payload);
}

function fullGrimoirePayload() {
  const g = session!.grimoire;
  return {
    phase: g.phase,
    night: g.nightNumber,
    day: g.dayNumber,
    redHerringId: g.redHerringId,
    players: g.allPlayers().map((p) => ({
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
    })),
  };
}

function broadcastFullGrimoire() {
  if (!storytellerSocket || !session) return;
  storytellerSocket.emit("st:fullGrimoire", fullGrimoirePayload());
}

function draftGrimoirePayload() {
  if (!draft) return null;
  return {
    players: draft.playerIds.map((playerId, i) => {
      const def = TROUBLE_BREWING.characters.find((c) => c.id === draft!.seating[i])!;
      return { position: i + 1, id: playerId, characterId: def.id, name: def.name, team: def.team };
    }),
  };
}

function broadcastDraftGrimoire() {
  const payload = draftGrimoirePayload();
  if (payload) storytellerSocket?.emit("st:draftGrimoire", payload);
}

function broadcastRoles() {
  const g = session!.grimoire;
  for (const [playerId, socket] of players) {
    const player = g.getPlayer(playerId);
    const displayId = player.drunkShowsAsCharacterId ?? player.characterId;
    const def = TROUBLE_BREWING.characters.find((c) => c.id === displayId)!;
    socket.emit("role:assign", { characterId: def.id, name: def.name, team: def.team, abilityText: def.abilityText });
  }
}

function announceGameOver(win: WinResult) {
  if (gameOver) return;
  gameOver = true;
  const g = session!.grimoire;
  const payload = {
    winner: win.winner,
    reason: win.reason,
    grimoire: g.allPlayers().map((p) => ({ id: p.id, characterId: p.characterId, alignment: p.alignment, alive: p.alive })),
  };
  for (const socket of players.values()) socket.emit("game:over", payload);
  storytellerSocket?.emit("game:over", payload);
  // Unstick whichever wait the game loop is currently blocked on.
  resolveAllReady?.();
  resolveAllReady = null;
  resolveTownHallStart?.(null);
  resolveTownHallStart = null;
  resolvePhaseAdvance?.();
  resolvePhaseAdvance = null;
  resolveVoteStart?.();
  resolveVoteStart = null;
  for (const pending of pendingVoteResponses.values()) pending.finish(false);
  pendingVoteResponses.clear();
  if (voteTurnTimer) {
    clearTimeout(voteTurnTimer);
    voteTurnTimer = null;
  }
}

function checkAndAnnounceWin(): boolean {
  const win = session!.checkWin();
  if (win) announceGameOver(win);
  return !!win;
}

function waitForAllReady(): Promise<void> {
  return new Promise((resolve) => {
    resolveAllReady = resolve;
  });
}

function waitForTownHallStart(): Promise<number | null> {
  return new Promise((resolve) => {
    resolveTownHallStart = resolve;
  });
}

function waitForPhaseAdvance(): Promise<void> {
  return new Promise((resolve) => {
    resolvePhaseAdvance = resolve;
  });
}

function triggerPhaseAdvance() {
  resolvePhaseAdvance?.();
  resolvePhaseAdvance = null;
}

function waitForVoteStart(): Promise<void> {
  return new Promise((resolve) => {
    resolveVoteStart = resolve;
  });
}

function triggerVoteStart() {
  resolveVoteStart?.();
  resolveVoteStart = null;
}

async function handlePlayerCommand(playerId: PlayerId, line: string) {
  if (!session || gameOver) return;
  log(`${playerId} command: ${line}`);

  try {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const targetName = rest[0];
    const phase = session.grimoire.phase;

    if (cmd === "status") {
      players.get(playerId)?.emit("state:public", publicStatePayload());
      return;
    }

    if (cmd === "slayer") {
      if (phase !== "day" && phase !== "townhall" && phase !== "nominations") {
        return sendInfo(playerId, "It's not day right now - just wait, you'll be prompted automatically when it's your turn.");
      }
      if (!session.grimoire.getPlayer(playerId).alive) {
        return sendInfo(playerId, "You're dead - you can't use or claim the Slayer's power.");
      }
      if (!targetName) return sendInfo(playerId, "Usage: slayer <name>");
      if (!players.has(targetName)) return sendInfo(playerId, `No such player: "${targetName}".`);

      // Any player may claim the Slayer and take a public shot - only the genuine
      // Slayer's shot can ever actually hit (see useSlayerPower's character check),
      // and a bluffer's miss is worded identically to a real miss so nobody can
      // read the table from the outcome alone.
      broadcastInfo(`${playerId} is taking a shot at ${targetName} as the Slayer!`);
      const hit = await session.useSlayerPower(playerId, targetName);
      if (hit) {
        broadcastInfo(`${targetName} has died!`);
        sendInfoToStoryteller("The Demon has been killed!");
      } else {
        broadcastInfo(`${playerId}'s shot misses.`);
      }
      broadcastPublicState();
      broadcastFullGrimoire();
      checkAndAnnounceWin();
      return;
    }

    if (cmd === "nominate" || cmd === "pass") {
      if (phase !== "nominations") {
        return sendInfo(playerId, "Nominations aren't open yet - wait for the Storyteller to move past Town Hall.");
      }
      if (nominationSubPhase !== "open") {
        return sendInfo(playerId, "A nomination is already being discussed or voted on - wait for it to conclude.");
      }
      if (cmd === "pass") {
        broadcastInfo(`${playerId} has nothing to nominate right now (can still nominate later this phase).`);
        return;
      }
      if (!targetName) return sendInfo(playerId, "Usage: nominate <name>");
      if (!players.has(targetName)) return sendInfo(playerId, `No such player: "${targetName}".`);
      const outcome = session.nominate(playerId, targetName);
      if (outcome.kind === "rejected") {
        sendInfo(playerId, `Nomination rejected: ${outcome.reason}`);
        return;
      }
      if (outcome.kind === "recorded") {
        nominationSubPhase = "discussing";
        broadcastInfo(
          `${playerId} has nominated ${targetName}. ${playerId} may explain why, then ${targetName} may respond - the Storyteller will start voting with "vote" when discussion is done.`,
        );
        broadcastPublicState();
        triggerPhaseAdvance();
        return;
      }
      // virgin-triggered
      broadcastPublicState();
      broadcastFullGrimoire();
      checkAndAnnounceWin();
      return;
    }

    sendInfo(playerId, "Commands: nominate <name>, pass, slayer <name>, status");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Error handling command "${line}" from ${playerId}: ${message}`);
    sendInfo(playerId, "Something went wrong processing that command - it was ignored.");
  }
}

/** Drafts a random seating and shows it only to the Storyteller, who can adjust it before confirming. */
function startSetupDraft(): void {
  if (draft || session || gameOver) return;
  if (players.size !== expectedPlayerCount || !storytellerSocket) return;

  const playerIds = [...players.keys()];
  const rng = new Rng(seed);
  const characterIds = randomComposition(TROUBLE_BREWING, playerIds.length, rng);
  const seating = rng.shuffle(characterIds);
  draft = { playerIds, seating, rng };

  log(`Storyteller started setup (seed ${seed}). Draft composition: ${seating.join(", ")}`);
  broadcastDraftGrimoire();
  broadcastLobbyUpdate();
  broadcastInfo("The Storyteller is building the grimoire - please wait...");
}

/** Swaps two players' seat positions (their circle order) without touching who has which character. */
function swapSeatPositions(playerA: PlayerId, playerB: PlayerId): string | null {
  if (!draft) return "No draft in progress - the Storyteller needs to type \"start\" first.";
  const iA = draft.playerIds.indexOf(playerA);
  const iB = draft.playerIds.indexOf(playerB);
  if (iA < 0) return `No such player: "${playerA}".`;
  if (iB < 0) return `No such player: "${playerB}".`;
  if (iA === iB) return "Those are the same player.";
  const idA = draft.playerIds[iA] as PlayerId;
  const charA = draft.seating[iA] as CharacterId;
  draft.playerIds[iA] = draft.playerIds[iB] as PlayerId;
  draft.seating[iA] = draft.seating[iB] as CharacterId;
  draft.playerIds[iB] = idA;
  draft.seating[iB] = charA;
  return null;
}

/** Sets the full seat order (circle order) at once - each player keeps whatever character they currently hold. */
function setSeatOrder(orderedPlayerIds: PlayerId[]): string | null {
  if (!draft) return "No draft in progress - the Storyteller needs to type \"start\" first.";
  if (orderedPlayerIds.length !== draft.playerIds.length) {
    return `Expected all ${draft.playerIds.length} players, got ${orderedPlayerIds.length}.`;
  }
  const seen = new Set<PlayerId>();
  for (const id of orderedPlayerIds) {
    if (!draft.playerIds.includes(id)) return `No such player: "${id}".`;
    if (seen.has(id)) return `"${id}" was listed more than once.`;
    seen.add(id);
  }
  const characterByPlayer = new Map(draft.playerIds.map((id, i) => [id, draft!.seating[i] as CharacterId]));
  draft.playerIds = orderedPlayerIds;
  draft.seating = orderedPlayerIds.map((id) => characterByPlayer.get(id) as CharacterId);
  return null;
}

/** Swaps which characters two drafted players hold. Returns an error message, or null on success. */
function swapDraftCharacters(playerA: PlayerId, playerB: PlayerId): string | null {
  if (!draft) return "No draft in progress - the Storyteller needs to type \"start\" first.";
  const iA = draft.playerIds.indexOf(playerA);
  const iB = draft.playerIds.indexOf(playerB);
  if (iA < 0) return `No such player: "${playerA}".`;
  if (iB < 0) return `No such player: "${playerB}".`;
  if (iA === iB) return "Those are the same player.";
  const tmp = draft.seating[iA] as CharacterId;
  draft.seating[iA] = draft.seating[iB] as CharacterId;
  draft.seating[iB] = tmp;
  return null;
}

/**
 * Gives a drafted player a specific character. If someone else in the draft already holds it,
 * this just swaps the two. Otherwise it pulls the character in from the bench (any character not
 * currently drafted) - only same-team swaps are allowed, since anything else would change the
 * composition's team counts. The Baron is the one exception that legitimately changes counts
 * (+2 Outsiders / -2 Townsfolk): bringing it in or sending it out is allowed, but requires
 * converting 2 other drafted players between Townsfolk and Outsider to keep the composition valid.
 */
function setDraftCharacter(playerId: PlayerId, characterId: CharacterId): string | null {
  if (!draft) return "No draft in progress - the Storyteller needs to type \"start\" first.";
  const target = draft.playerIds.indexOf(playerId);
  if (target < 0) return `No such player: "${playerId}".`;

  const newDef = TROUBLE_BREWING.characters.find((c) => c.id === characterId);
  if (!newDef) return `Unknown character id "${characterId}".`;

  const currentCharacterId = draft.seating[target] as CharacterId;
  if (currentCharacterId === characterId) return null;

  const holder = draft.seating.indexOf(characterId);
  if (holder >= 0) {
    draft.seating[target] = characterId;
    draft.seating[holder] = currentCharacterId;
    return null;
  }

  const currentDef = TROUBLE_BREWING.characters.find((c) => c.id === currentCharacterId)!;
  if (currentDef.team !== newDef.team) {
    return `"${newDef.name}" is ${newDef.team}, not ${currentDef.team} like "${currentDef.name}" - can't bring it in directly (it would change the composition's team counts). Use "swap <playerA> <playerB>" to trade with someone who already has a same-team character instead.`;
  }

  const wasBaronInPlay = currentCharacterId === "baron";
  const willBaronBeInPlay = characterId === "baron";
  draft.seating[target] = characterId;
  if (wasBaronInPlay === willBaronBeInPlay) return null;

  // Baron just entered or left play - rebalance 2 Townsfolk<->Outsider seats to match.
  const fromTeam: Team = willBaronBeInPlay ? "townsfolk" : "outsider";
  const toTeam: Team = willBaronBeInPlay ? "outsider" : "townsfolk";
  const seatsToConvert = draft.playerIds
    .map((_, i) => i)
    .filter((i) => i !== target && TROUBLE_BREWING.characters.find((c) => c.id === draft!.seating[i])?.team === fromTeam)
    .slice(0, 2);

  if (seatsToConvert.length < 2) {
    draft.seating[target] = currentCharacterId;
    return `Can't give ${playerId} the ${newDef.name} - rebalancing the Baron would need 2 ${fromTeam} players to convert to ${toTeam}, but there aren't enough in the draft.`;
  }
  const benchOfToTeam = TROUBLE_BREWING.characters.filter((c) => c.team === toTeam && !draft!.seating.includes(c.id));
  if (benchOfToTeam.length < 2) {
    draft.seating[target] = currentCharacterId;
    return `Can't give ${playerId} the ${newDef.name} - not enough ${toTeam} characters left on the bench to rebalance the Baron.`;
  }
  const picks = draft.rng.shuffle(benchOfToTeam).slice(0, 2);
  seatsToConvert.forEach((seatIndex, k) => {
    draft!.seating[seatIndex] = picks[k]!.id;
  });
  sendInfoToStoryteller(
    `Baron ${willBaronBeInPlay ? "entered" : "left"} play - also swapped ${seatsToConvert.map((i) => draft!.playerIds[i]).join(" and ")} to rebalance Townsfolk/Outsider counts.`,
  );
  return null;
}

/** Locks in the (possibly Storyteller-adjusted) draft, deals it for real, and sends roles out to players. */
async function confirmDraftAndStartGame(): Promise<void> {
  if (!draft || session || gameOver) return;
  const { playerIds, seating, rng } = draft;

  if (playerIds.some((id) => !players.has(id))) {
    broadcastInfo('A player disconnected during setup - the draft was discarded. Type "start" again once everyone is back.');
    draft = null;
    broadcastLobbyUpdate();
    return;
  }

  const playerSeeds = playerIds.map((id) => ({ id, name: id }));
  log(`Storyteller confirmed the grimoire. Composition: ${seating.join(", ")}`);
  draft = null;

  session = await GameSession.startSeated({
    players: playerSeeds,
    script: TROUBLE_BREWING,
    seatedCharacterIds: seating,
    decisionProvider,
    playerChoiceProvider,
    rng,
  });
  decisionProvider.grimoire = session.grimoire;
  log("Grimoire: " + session.grimoire.allPlayers().map((p) => `${p.id}=${p.characterId} (${p.alignment})`).join(", "));

  broadcastRoles();
  broadcastFullGrimoire();
  log('Waiting for all players to read their role and type "ready"...');
  broadcastLobbyReadyStatus();
  await waitForAllReady();
  if (gameOver) return;

  await runNightDayLoop();
}

/** Prompts one voter and races their response against the per-voter timeout. No response in time = no vote (indistinguishable from a bailed fake-hand). */
function waitForVoteResponse(voterId: PlayerId, nominatorId: PlayerId, nomineeId: PlayerId, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (voted: boolean) => {
      if (settled) return;
      settled = true;
      pendingVoteResponses.delete(requestId);
      resolve(voted);
    };
    pendingVoteResponses.set(requestId, { voterId, finish });
    players.get(voterId)?.emit("vote:prompt", { requestId, nominatorId, nomineeId, secondsLeft: seconds });
    voteTurnTimer = setTimeout(() => finish(false), seconds * 1000);
  });
}

/** Runs the sequential "clock" for the currently active nomination, then concludes it (never executes - see resolveDayExecutions). */
async function runVotingClock() {
  const activeSession = session!;
  const g = activeSession.grimoire;
  const nomination = g.activeNomination!;
  const order = g.votingOrderFor(nomination.nomineeId);

  nominationSubPhase = "voting";
  broadcastPublicState();

  for (const voterId of order) {
    if (nominationsForced) break;
    if (!g.hasVotingCapacity(voterId)) continue; // dead with no ghost vote left - silently skipped, no prompt
    voteClockCurrentVoterId = voterId;
    voteTurnEndsAt = Date.now() + voteSeconds * 1000;
    broadcastPublicState();

    const voted = await waitForVoteResponse(voterId, nomination.nominatorId, nomination.nomineeId, voteSeconds);
    if (voteTurnTimer) {
      clearTimeout(voteTurnTimer);
      voteTurnTimer = null;
    }
    if (voted) activeSession.castVote(nomination, voterId);
  }
  voteClockCurrentVoterId = null;
  voteTurnEndsAt = null;

  const conclusion = activeSession.concludeVote();
  broadcastInfo(
    `Vote on ${conclusion.nomineeId}: ${conclusion.voteCount}/${conclusion.threshold}.` +
      (conclusion.onBlock ? ` ${conclusion.nomineeId} is now on the block.` : ""),
  );
  broadcastPublicState();
}

/** Drives one day's whole Nominations phase: open for a nomination, discuss, vote, repeat - until the Storyteller forces the end. */
async function runNominationsPhase() {
  const activeSession = session!;
  activeSession.grimoire.enterNominations();
  nominationsForced = false;
  log('--- Nominations --- ("nominate <name>" opens discussion; Storyteller: type "force" to end the whole phase any time)');

  while (!gameOver && !nominationsForced) {
    nominationSubPhase = "open";
    broadcastPublicState();
    await waitForPhaseAdvance(); // woken by a successful nomination, or by force
    if (gameOver || nominationsForced) break;

    if (activeSession.grimoire.activeNomination) {
      await waitForVoteStart(); // "discussing" - waits for the Storyteller's "vote" command, or force
      if (gameOver || nominationsForced) break;
      await runVotingClock();
    }
  }

  if (activeSession.grimoire.activeNomination) {
    // Forced out of discussion/voting early - conclude with whatever (if any) votes exist so it's recorded in history.
    activeSession.concludeVote();
  }
  nominationSubPhase = null;
  activeSession.resolveDayExecutions();
}

async function runNightDayLoop() {
  const activeSession = session!;
  while (!gameOver) {
    log(`--- Night ${activeSession.grimoire.nightNumber + 1} ---`);
    await activeSession.runNight((playerId, result) => {
      players.get(playerId)?.emit("night:info", { result });
    });
    broadcastPublicState();
    broadcastFullGrimoire();
    if (checkAndAnnounceWin()) break;

    activeSession.startDay();
    log(`--- Day ${activeSession.grimoire.dayNumber} --- (free discussion; Storyteller: type "townhall" when ready)`);
    broadcastPublicState();
    broadcastFullGrimoire();

    const requestedSeconds = await waitForTownHallStart();
    if (gameOver) break;

    const seconds = requestedSeconds ?? defaultTownHallSeconds;
    activeSession.grimoire.enterTownHall();
    townHallEndsAt = seconds > 0 ? Date.now() + seconds * 1000 : null;
    broadcastPublicState();
    log(`--- Town Hall --- (${seconds > 0 ? `${seconds}s timer` : "untimed"}; Storyteller: type "force" to end early)`);
    if (seconds > 0) {
      townHallTimer = setTimeout(() => triggerPhaseAdvance(), seconds * 1000);
    }
    await waitForPhaseAdvance();
    if (townHallTimer) {
      clearTimeout(townHallTimer);
      townHallTimer = null;
    }
    townHallEndsAt = null;
    if (gameOver) break;

    await runNominationsPhase();
    if (gameOver) break;

    broadcastPublicState();
    broadcastFullGrimoire();
    if (checkAndAnnounceWin()) break;
  }

  log("Game over.");
}

io.on("connection", (socket) => {
  socket.on("join", ({ name, code }: { name: string; code: string }) => {
    if (code !== sessionCode) {
      socket.emit("error", { message: "Invalid session code.", reason: "invalid-code" });
      return;
    }
    if (session || draft) {
      socket.emit("error", { message: "The game has already started.", reason: "already-started" });
      return;
    }
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      socket.emit("error", { message: "Names must be a single word: letters, numbers, - or _ only.", reason: "invalid-name" });
      return;
    }
    if (players.has(trimmed)) {
      socket.emit("error", { message: "That name is already taken.", reason: "name-taken" });
      return;
    }
    if (players.size >= expectedPlayerCount) {
      socket.emit("error", { message: `The table is full (${expectedPlayerCount} players expected).`, reason: "table-full" });
      return;
    }
    players.set(trimmed, socket);
    socket.data.playerId = trimmed;
    socket.emit("joined", { playerId: trimmed });
    log(`${trimmed} joined (${players.size}/${expectedPlayerCount}).`);
    broadcastLobbyUpdate();
  });

  socket.on("join-storyteller", ({ code }: { code: string }) => {
    if (code !== sessionCode) {
      socket.emit("error", { message: "Invalid session code.", reason: "invalid-code" });
      return;
    }
    if (storytellerSocket && storytellerSocket.connected) {
      socket.emit("error", { message: "A Storyteller is already connected.", reason: "storyteller-taken" });
      return;
    }
    storytellerSocket = socket;
    socket.emit("joined-storyteller", {});
    log("Storyteller connected.");
    broadcastLobbyUpdate();
  });

  socket.on("st:startGame", () => {
    if (socket !== storytellerSocket) return;
    if (draft || session) return;
    if (players.size !== expectedPlayerCount) {
      sendInfoToStoryteller(`Still waiting for players (${players.size}/${expectedPlayerCount}).`);
      return;
    }
    startSetupDraft();
  });

  socket.on("st:swapDraft", ({ playerA, playerB }: { playerA: string; playerB: string }) => {
    if (socket !== storytellerSocket) return;
    const err = swapDraftCharacters(playerA, playerB);
    if (err) sendInfoToStoryteller(err);
    else broadcastDraftGrimoire();
  });

  socket.on("st:setDraftCharacter", ({ playerId, characterId }: { playerId: string; characterId: string }) => {
    if (socket !== storytellerSocket) return;
    const err = setDraftCharacter(playerId, characterId as CharacterId);
    if (err) sendInfoToStoryteller(err);
    else broadcastDraftGrimoire();
  });

  socket.on("st:swapSeats", ({ playerA, playerB }: { playerA: string; playerB: string }) => {
    if (socket !== storytellerSocket) return;
    const err = swapSeatPositions(playerA, playerB);
    if (err) sendInfoToStoryteller(err);
    else broadcastDraftGrimoire();
  });

  socket.on("st:setSeatOrder", ({ playerIds }: { playerIds: string[] }) => {
    if (socket !== storytellerSocket) return;
    if (!Array.isArray(playerIds)) return;
    const err = setSeatOrder(playerIds);
    if (err) sendInfoToStoryteller(err);
    else broadcastDraftGrimoire();
  });

  socket.on("st:confirmSetup", () => {
    if (socket !== storytellerSocket) return;
    void confirmDraftAndStartGame();
  });

  socket.on("player:ready", () => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    if (!playerId || !session || gameOver) return;
    readyPlayers.add(playerId);
    log(`${playerId} is ready (${readyPlayers.size}/${players.size}).`);
    broadcastLobbyReadyStatus();
    if (readyPlayers.size === players.size) {
      resolveAllReady?.();
      resolveAllReady = null;
    }
  });

  socket.on("night:submitChoice", ({ requestId, value }: { requestId: string; value: string }) => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    log(`${describePlayer(playerId)} answered a night prompt: ${value}`);
    playerChoiceProvider.resolveChoice(requestId, value, socket.id);
  });

  socket.on("vote:submitChoice", ({ requestId, value }: { requestId: string; value: string }) => {
    const pending = pendingVoteResponses.get(requestId);
    if (!pending || socket.data.playerId !== pending.voterId) return;
    const playerId = socket.data.playerId as PlayerId | undefined;
    log(`${describePlayer(playerId)} voted: ${value}`);
    pending.finish(/^y/i.test(value.trim()));
  });

  socket.on("st:decisionResponse", ({ requestId, value }: { requestId: string; value: string }) => {
    log(`Storyteller answered a decision prompt: ${value}`);
    decisionProvider.resolveDecision(requestId, value, socket.id);
  });

  socket.on("st:startTownHall", (payload: { seconds?: number | null } = {}) => {
    if (socket !== storytellerSocket) return;
    if (!session || gameOver || session.grimoire.phase !== "day") return;
    log(`Storyteller started Town Hall (seconds=${payload.seconds ?? "default"}).`);
    resolveTownHallStart?.(payload.seconds ?? null);
    resolveTownHallStart = null;
  });

  socket.on("st:startVoting", () => {
    if (socket !== storytellerSocket) return;
    if (!session || gameOver || session.grimoire.phase !== "nominations") return;
    if (nominationSubPhase !== "discussing") return;
    log("Storyteller started the voting clock.");
    triggerVoteStart();
  });

  socket.on("st:forceAdvance", () => {
    if (socket !== storytellerSocket) return;
    if (!session || gameOver) return;
    const phase = session.grimoire.phase;
    if (phase !== "townhall" && phase !== "nominations") return;
    log(`Storyteller forced the end of the "${phase}" stage.`);
    if (phase === "nominations") {
      nominationsForced = true;
      for (const pending of pendingVoteResponses.values()) pending.finish(false);
      triggerVoteStart();
    }
    triggerPhaseAdvance();
  });

  socket.on("player:command", ({ line }: { line: string }) => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    if (playerId && typeof line === "string") void handlePlayerCommand(playerId, line);
  });

  socket.on("status:poll", () => {
    if (session) {
      socket.emit("state:public", publicStatePayload());
      if (socket === storytellerSocket) socket.emit("st:fullGrimoire", fullGrimoirePayload());
      if (!readyPlayers.has(socket.data.playerId as PlayerId) || readyPlayers.size < players.size) {
        socket.emit("lobby:readyStatus", { readyIds: [...readyPlayers], waitingOnIds: [...players.keys()].filter((id) => !readyPlayers.has(id)) });
      }
    } else {
      const readyToStart = players.size === expectedPlayerCount && !!storytellerSocket && !draft;
      socket.emit("lobby:update", { playersJoined: players.size, playersExpected: expectedPlayerCount, storytellerJoined: !!storytellerSocket, readyToStart });
      if (socket === storytellerSocket) broadcastDraftGrimoire();
    }
  });

  socket.on("disconnect", () => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    if (playerId) log(`${playerId} disconnected.`);
    if (storytellerSocket === socket) {
      storytellerSocket = null;
      log("Storyteller disconnected.");
    }
    if (draft && !session && playerId && draft.playerIds.includes(playerId)) {
      draft = null;
      broadcastInfo(`${playerId ?? "A player"} disconnected during setup - the draft was discarded.`);
    }
    if (!session && playerId && players.get(playerId) === socket) {
      players.delete(playerId);
      readyPlayers.delete(playerId);
    }
    decisionProvider.handleDisconnect(socket.id);
    playerChoiceProvider.handleDisconnect(socket.id);
    broadcastLobbyUpdate();
  });
});

httpServer.listen(port, () => {
  log(`Blood on the Clocktower playtest server listening on port ${port}.`);
  log(`Session code: ${sessionCode} - share this with your Storyteller and players.`);
  log(`Town Hall default duration: ${defaultTownHallSeconds}s (0 = untimed by default).`);
  log(`Waiting for ${expectedPlayerCount} players and 1 Storyteller to connect...`);
});
