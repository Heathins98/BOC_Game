import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { Rng, TROUBLE_BREWING } from "@boc/shared";
import type { PlayerId } from "@boc/shared";
import { GameSession, randomComposition, type WinResult } from "@boc/server";
import { NetworkDecisionProvider, NetworkPlayerChoiceProvider } from "./networkProviders.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
  };
  return {
    players: Number(get("--players", "5")),
    port: Number(get("--port", "3131")),
    seed: Number(get("--seed", String(Date.now() % 1_000_000))),
    townHallSeconds: Number(get("--townhall-seconds", "120")),
  };
}

const { players: expectedPlayerCount, port, seed, townHallSeconds: defaultTownHallSeconds } = parseArgs();

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

process.on("uncaughtException", (err) => {
  log(`UNCAUGHT EXCEPTION (server kept running): ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  log(`UNHANDLED REJECTION (server kept running): ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

const players = new Map<PlayerId, Socket>();
const readyPlayers = new Set<PlayerId>();
let storytellerSocket: Socket | null = null;
let session: GameSession | null = null;
let gameOver = false;

let resolveAllReady: (() => void) | null = null;
let resolveTownHallStart: ((seconds: number | null) => void) | null = null;
let resolvePhaseAdvance: (() => void) | null = null;
let townHallTimer: NodeJS.Timeout | null = null;
let townHallEndsAt: number | null = null;

const decisionProvider = new NetworkDecisionProvider(() => storytellerSocket);
const playerChoiceProvider = new NetworkPlayerChoiceProvider((id) => players.get(id));

function sendInfo(playerId: PlayerId, message: string) {
  players.get(playerId)?.emit("info", { message });
}

function broadcastInfo(message: string) {
  for (const socket of players.values()) socket.emit("info", { message });
  storytellerSocket?.emit("info", { message });
}

function broadcastLobbyUpdate() {
  const payload = { playersJoined: players.size, playersExpected: expectedPlayerCount, storytellerJoined: !!storytellerSocket };
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
  return {
    phase: g.phase,
    night: g.nightNumber,
    day: g.dayNumber,
    townHallEndsAt,
    players: g.allPlayers().map((p) => ({ id: p.id, alive: p.alive, seat: p.seat })),
    nominations: g.nominationsToday.map((n, index) => ({
      index,
      nominatorId: n.nominatorId,
      nomineeId: n.nomineeId,
      votes: n.votersInFavor.size,
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
      if (!targetName) return sendInfo(playerId, "Usage: slayer <name>");
      if (!players.has(targetName)) return sendInfo(playerId, `No such player: "${targetName}".`);
      const hit = await session.useSlayerPower(playerId, targetName);
      sendInfo(playerId, hit ? "Your shot hits the Demon!" : "Nothing happens.");
      broadcastPublicState();
      broadcastFullGrimoire();
      checkAndAnnounceWin();
      return;
    }

    if (cmd === "nominate" || cmd === "vote" || cmd === "pass") {
      if (phase !== "nominations") {
        return sendInfo(playerId, "Nominations aren't open yet - wait for the Storyteller to move past Town Hall.");
      }
      if (cmd === "pass") {
        broadcastInfo(`${playerId} has nothing to nominate right now (can still nominate later this phase).`);
        return;
      }
      if (cmd === "nominate") {
        if (!targetName) return sendInfo(playerId, "Usage: nominate <name>");
        if (!players.has(targetName)) return sendInfo(playerId, `No such player: "${targetName}".`);
        const outcome = session.nominate(playerId, targetName);
        if (outcome.kind === "rejected") sendInfo(playerId, `Nomination rejected: ${outcome.reason}`);
        broadcastPublicState();
        if (outcome.kind === "virgin-triggered") {
          broadcastFullGrimoire();
          checkAndAnnounceWin();
        }
        return;
      }
      // vote
      const index = Number(targetName);
      const nomination = session.grimoire.nominationsToday[index];
      if (!nomination) return sendInfo(playerId, "No such nomination index - check `status` for the current list.");
      const accepted = session.castVote(nomination, playerId);
      if (!accepted) sendInfo(playerId, "Vote not accepted (already spent your ghost vote, or your Butler master hasn't voted yet).");
      broadcastPublicState();
      return;
    }

    sendInfo(playerId, "Commands: nominate <name>, pass, vote <#>, slayer <name>, status");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Error handling command "${line}" from ${playerId}: ${message}`);
    sendInfo(playerId, "Something went wrong processing that command - it was ignored.");
  }
}

async function runGame() {
  const playerIds = [...players.keys()];
  const playerSeeds = playerIds.map((id) => ({ id, name: id }));
  const rng = new Rng(seed);
  const characterIds = randomComposition(TROUBLE_BREWING, playerIds.length, rng);

  log(`Starting game with seed ${seed}. Composition: ${characterIds.join(", ")}`);

  session = await GameSession.start({
    players: playerSeeds,
    script: TROUBLE_BREWING,
    characterIds,
    decisionProvider,
    playerChoiceProvider,
    rng,
  });
  decisionProvider.grimoire = session.grimoire;

  broadcastRoles();
  broadcastFullGrimoire();
  log('Waiting for all players to read their role and type "ready"...');
  broadcastLobbyReadyStatus();
  await waitForAllReady();
  if (gameOver) return;

  while (!gameOver) {
    log(`--- Night ${session.grimoire.nightNumber + 1} ---`);
    const nightResults = await session.runNight();
    for (const [playerId, result] of nightResults) {
      players.get(playerId)?.emit("night:info", { result });
    }
    broadcastPublicState();
    broadcastFullGrimoire();
    if (checkAndAnnounceWin()) break;

    session.startDay();
    log(`--- Day ${session.grimoire.dayNumber} --- (free discussion; Storyteller: type "townhall" when ready)`);
    broadcastPublicState();
    broadcastFullGrimoire();

    const requestedSeconds = await waitForTownHallStart();
    if (gameOver) break;

    const seconds = requestedSeconds ?? defaultTownHallSeconds;
    session.grimoire.enterTownHall();
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

    session.grimoire.enterNominations();
    broadcastPublicState();
    log('--- Nominations --- (Storyteller: type "force" to end and move to Night)');
    await waitForPhaseAdvance();
    if (gameOver) break;

    session.resolveDayExecutions();
    broadcastPublicState();
    broadcastFullGrimoire();
    if (checkAndAnnounceWin()) break;
  }

  log("Game over.");
}

function maybeStartGame() {
  if (session || gameOver) return;
  if (players.size === expectedPlayerCount && storytellerSocket) {
    void runGame();
  }
}

io.on("connection", (socket) => {
  socket.on("join", ({ name }: { name: string }) => {
    if (session) {
      socket.emit("error", { message: "The game has already started." });
      return;
    }
    const trimmed = (name ?? "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      socket.emit("error", { message: "Names must be a single word: letters, numbers, - or _ only." });
      return;
    }
    if (players.has(trimmed)) {
      socket.emit("error", { message: "That name is already taken." });
      return;
    }
    if (players.size >= expectedPlayerCount) {
      socket.emit("error", { message: `The table is full (${expectedPlayerCount} players expected).` });
      return;
    }
    players.set(trimmed, socket);
    socket.data.playerId = trimmed;
    socket.emit("joined", { playerId: trimmed });
    log(`${trimmed} joined (${players.size}/${expectedPlayerCount}).`);
    broadcastLobbyUpdate();
    maybeStartGame();
  });

  socket.on("join-storyteller", () => {
    storytellerSocket = socket;
    socket.emit("joined-storyteller", {});
    log("Storyteller connected.");
    broadcastLobbyUpdate();
    maybeStartGame();
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
    log(`${playerId ?? "unknown"} answered a night prompt: ${value}`);
    playerChoiceProvider.resolveChoice(requestId, value);
  });

  socket.on("st:decisionResponse", ({ requestId, value }: { requestId: string; value: string }) => {
    log(`Storyteller answered a decision prompt: ${value}`);
    decisionProvider.resolveDecision(requestId, value);
  });

  socket.on("st:startTownHall", (payload: { seconds?: number | null } = {}) => {
    if (!session || gameOver || session.grimoire.phase !== "day") return;
    log(`Storyteller started Town Hall (seconds=${payload.seconds ?? "default"}).`);
    resolveTownHallStart?.(payload.seconds ?? null);
    resolveTownHallStart = null;
  });

  socket.on("st:forceAdvance", () => {
    if (!session || gameOver) return;
    if (session.grimoire.phase !== "townhall" && session.grimoire.phase !== "nominations") return;
    log(`Storyteller forced the end of the "${session.grimoire.phase}" stage.`);
    triggerPhaseAdvance();
  });

  socket.on("player:command", ({ line }: { line: string }) => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    if (playerId) void handlePlayerCommand(playerId, line);
  });

  socket.on("status:poll", () => {
    if (session) {
      socket.emit("state:public", publicStatePayload());
      if (socket === storytellerSocket) socket.emit("st:fullGrimoire", fullGrimoirePayload());
      if (!readyPlayers.has(socket.data.playerId as PlayerId) || readyPlayers.size < players.size) {
        socket.emit("lobby:readyStatus", { readyIds: [...readyPlayers], waitingOnIds: [...players.keys()].filter((id) => !readyPlayers.has(id)) });
      }
    } else {
      socket.emit("lobby:update", { playersJoined: players.size, playersExpected: expectedPlayerCount, storytellerJoined: !!storytellerSocket });
    }
  });

  socket.on("disconnect", () => {
    const playerId = socket.data.playerId as PlayerId | undefined;
    if (playerId) log(`${playerId} disconnected.`);
    if (storytellerSocket === socket) {
      storytellerSocket = null;
      log("Storyteller disconnected.");
    }
  });
});

httpServer.listen(port, () => {
  log(`Blood on the Clocktower playtest server listening on port ${port}.`);
  log(`Town Hall default duration: ${defaultTownHallSeconds}s (0 = untimed by default).`);
  log(`Waiting for ${expectedPlayerCount} players and 1 Storyteller to connect...`);
});
