import { createInterface } from "node:readline/promises";
import { cursorTo, clearLine } from "node:readline";
import { stdin, stdout } from "node:process";
import { io } from "socket.io-client";

const url = process.argv[2] ?? "http://localhost:3131";
const rl = createInterface({ input: stdin, output: stdout });

const WAITING_REMINDER_INTERVAL_MS = 15_000;

// Every real log clears any in-place heartbeat line first, so the heartbeat never gets
// glued to the front of the next real output (see the setInterval below).
const realLog = console.log.bind(console);
let heartbeatVisible = false;
console.log = (...args: unknown[]) => {
  if (heartbeatVisible) {
    cursorTo(stdout, 0);
    clearLine(stdout, 0);
    heartbeatVisible = false;
  }
  realLog(...args);
};

let pendingDecision: { requestId: string } | null = null;
let currentPhase = "setup";
let nominationSubPhase: "open" | "discussing" | "voting" | null = null;
let readyToStart = false;
let draftInProgress = false;
let lastPrintedLobby = "";
let lastPrintedReadyStatus = "";
let lastPrintedGrimoire = "";
let lastPrintedState = "";

function printHelp() {
  console.log(`
=== Storyteller commands ===
  start                   Draft a random grimoire once all players have joined (shown to you only).
  swap <a> <b>            Swap which characters two drafted players hold.
  set <player> <char-id>  Give a drafted player a specific character (swaps with its current holder).
  seatswap <a> <b>        Swap two players' seat positions (circle order) - characters stay with each player.
  seats <p1> <p2> ...     Set the full seat order at once, to match players' real-life seating.
  confirm                 Lock in the grimoire and send roles out to players - starts Night 1.
  townhall                Start Town Hall (from Day), using the server's default timer.
  townhall <seconds>      Start Town Hall with a custom duration for today.
  townhall off            Start Town Hall untimed - only "force" will end it.
  vote                    Start the voting clock for the currently discussed nomination.
  force                   End the current Town Hall or Nominations stage right now
                          (during Nominations, this ends the whole day's Nominations,
                          concluding any nomination in progress first).
  <answer>                When a [DECISION NEEDED] prompt is shown, whatever you type
                          next is sent back as that answer (not a command).
`);
}

function main() {
  const socket = io(url, { reconnection: false });

  socket.on("connect", () => socket.emit("join-storyteller"));
  socket.on("joined-storyteller", () => {
    console.log('Joined as Storyteller. Waiting for all players to join... (type "help" any time for commands)');
  });
  socket.on("error", (p: { message: string }) => console.log(`[error] ${p.message}`));
  socket.on("info", (p: { message: string }) => console.log(`[info] ${p.message}`));

  socket.on("disconnect", (reason: string) => {
    console.log(`\n❌ Server session ended (${reason}). Exiting.`);
    process.exit(1);
  });
  socket.on("connect_error", (err: Error) => {
    console.log(`\n❌ Could not reach the server (${err.message}). Exiting.`);
    process.exit(1);
  });

  socket.on("lobby:update", (u: { playersJoined: number; playersExpected: number; readyToStart: boolean }) => {
    readyToStart = u.readyToStart;
    const snapshot = JSON.stringify(u);
    if (snapshot === lastPrintedLobby) return;
    lastPrintedLobby = snapshot;
    console.log(`Lobby: ${u.playersJoined}/${u.playersExpected} players joined.`);
    if (readyToStart) console.log('Everyone is here. Type "start" to draft a grimoire.');
  });

  socket.on("lobby:readyStatus", (r: { readyIds: string[]; waitingOnIds: string[] }) => {
    const snapshot = JSON.stringify(r);
    if (snapshot === lastPrintedReadyStatus) return;
    lastPrintedReadyStatus = snapshot;
    if (r.waitingOnIds.length === 0) {
      console.log("All players are ready.");
    } else {
      console.log(`Waiting on: ${r.waitingOnIds.join(", ")} to read their role and type "ready".`);
    }
  });

  socket.on("st:draftGrimoire", (d: { players: { position: number; id: string; characterId: string; name: string; team: string }[] }) => {
    draftInProgress = true;
    console.log("\n=== DRAFT GRIMOIRE (not sent to players yet) - seat order below ===");
    for (const p of d.players) console.log(`  ${p.position}. ${p.id}: ${p.name} [${p.characterId}] (${p.team})`);
    console.log(
      'Type "swap <a> <b>" / "set <player> <char-id>" to adjust characters, "seatswap <a> <b>" / "seats <p1> <p2> ..." to fix seat order, or "confirm" to lock it in and start Night 1.\n',
    );
  });

  socket.on(
    "st:fullGrimoire",
    (g: {
      phase: string;
      night: number;
      day: number;
      redHerringId: string | null;
      players: {
        id: string;
        characterId: string;
        alignment: string;
        alive: boolean;
        poisoned: boolean;
        drunk: boolean;
        drunkShowsAsCharacterId?: string;
        protectedTonight: boolean;
        usedSlayerPower: boolean;
        butlerMasterId?: string;
      }[];
    }) => {
      draftInProgress = false;
      const snapshot = JSON.stringify(g);
      if (snapshot === lastPrintedGrimoire) return;
      lastPrintedGrimoire = snapshot;
      console.log(`\n=== GRIMOIRE (phase: ${g.phase}, night ${g.night}, day ${g.day}) ===`);
      for (const p of g.players) {
        const flags = [
          p.alive ? "alive" : "DEAD",
          p.poisoned && "poisoned",
          p.drunk && "drunk",
          p.protectedTonight && "monk-protected",
          p.usedSlayerPower && "used-slayer",
          p.butlerMasterId && `master:${p.butlerMasterId}`,
          p.drunkShowsAsCharacterId && `shows-as:${p.drunkShowsAsCharacterId}`,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(`  ${p.id}: ${p.characterId} (${p.alignment}) [${flags}]`);
      }
      if (g.redHerringId) console.log(`  Red Herring: ${g.redHerringId}`);
    },
  );

  socket.on("st:decisionRequest", (p: { requestId: string; prompt: string }) => {
    pendingDecision = { requestId: p.requestId };
    console.log(`\n[DECISION NEEDED] ${p.prompt}`);
    console.log("> (type your answer and press enter)");
  });

  socket.on(
    "state:public",
    (s: {
      phase: string;
      night: number;
      day: number;
      townHallEndsAt: number | null;
      nominationSubPhase: "open" | "discussing" | "voting" | null;
      activeVote: { nominatorId: string; nomineeId: string; currentVoterId: string | null; turnEndsAt: number | null; votesSoFar: number } | null;
      blockHolder: { nominatorId: string; nomineeId: string; votes: number } | null;
      nominationHistory: { nominatorId: string; nomineeId: string; votes: number; metThreshold: boolean }[];
    }) => {
      currentPhase = s.phase;
      nominationSubPhase = s.nominationSubPhase;
      const snapshot = JSON.stringify(s);
      if (snapshot === lastPrintedState) return;
      lastPrintedState = snapshot;

      const phaseLabel = s.phase === "townhall" ? "Town Hall" : s.phase === "nominations" ? "Nominations" : s.phase;
      console.log(`\n[STATE] phase=${phaseLabel} night=${s.night} day=${s.day}`);
      if (s.phase === "townhall" && s.townHallEndsAt) {
        const secondsLeft = Math.max(0, Math.round((s.townHallEndsAt - Date.now()) / 1000));
        console.log(`Town Hall ends in ~${secondsLeft}s (or type "force" to end it now).`);
      }
      if (s.blockHolder) console.log(`On the block: ${s.blockHolder.nomineeId} (${s.blockHolder.votes} votes).`);
      if (s.nominationHistory.length > 0) {
        console.log(
          "This round: " +
            s.nominationHistory.map((n) => `${n.nominatorId}→${n.nomineeId} (${n.votes} votes${n.metThreshold ? ", met threshold" : ""})`).join(" | "),
        );
      }
      if (s.activeVote) {
        const turn = s.activeVote.currentVoterId ? ` - ${s.activeVote.currentVoterId}'s turn to vote` : "";
        console.log(`Nomination: ${s.activeVote.nominatorId}→${s.activeVote.nomineeId} (${s.activeVote.votesSoFar} votes so far)${turn}.`);
      }
      if (s.phase === "day") console.log('Type "townhall" (optionally "townhall <seconds>" or "townhall off") to start discussion.');
      if (s.phase === "townhall") console.log('Type "force" to end Town Hall early and open Nominations.');
      if (s.phase === "nominations" && s.nominationSubPhase === "open") console.log('Waiting for a nomination. Type "force" to end Nominations for the day.');
      if (s.phase === "nominations" && s.nominationSubPhase === "discussing") console.log('Discussion in progress. Type "vote" to start the voting clock.');
      if (s.phase === "nominations" && s.nominationSubPhase === "voting") console.log('Voting clock running. Type "force" to cut it short and end Nominations.');
    },
  );

  socket.on(
    "game:over",
    (g: { winner: string; reason: string; grimoire: { id: string; characterId: string; alignment: string; alive: boolean }[] }) => {
      console.log(`\n\n=== GAME OVER: ${g.winner.toUpperCase()} WINS ===\n${g.reason}`);
      for (const p of g.grimoire) console.log(`  ${p.id}: ${p.characterId} (${p.alignment})${p.alive ? "" : " - dead"}`);
      rl.close();
      socket.close();
      process.exit(0);
    },
  );

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (pendingDecision) {
      socket.emit("st:decisionResponse", { requestId: pendingDecision.requestId, value: trimmed });
      pendingDecision = null;
      return;
    }

    const [cmd, ...rest] = trimmed.split(/\s+/);

    if (cmd === "help") {
      printHelp();
      return;
    }

    if (cmd === "start") {
      if (!readyToStart) {
        console.log("Not everyone has joined yet.");
        return;
      }
      socket.emit("st:startGame");
      return;
    }

    if (cmd === "swap") {
      const [a, b] = rest;
      if (!a || !b) {
        console.log("Usage: swap <playerA> <playerB>");
        return;
      }
      if (!draftInProgress) {
        console.log('No draft in progress - type "start" first.');
        return;
      }
      socket.emit("st:swapDraft", { playerA: a, playerB: b });
      return;
    }

    if (cmd === "set") {
      const [player, characterId] = rest;
      if (!player || !characterId) {
        console.log("Usage: set <player> <character-id>");
        return;
      }
      if (!draftInProgress) {
        console.log('No draft in progress - type "start" first.');
        return;
      }
      socket.emit("st:setDraftCharacter", { playerId: player, characterId });
      return;
    }

    if (cmd === "seatswap") {
      const [a, b] = rest;
      if (!a || !b) {
        console.log("Usage: seatswap <playerA> <playerB>");
        return;
      }
      if (!draftInProgress) {
        console.log('No draft in progress - type "start" first.');
        return;
      }
      socket.emit("st:swapSeats", { playerA: a, playerB: b });
      return;
    }

    if (cmd === "seats") {
      if (rest.length === 0) {
        console.log("Usage: seats <player1> <player2> ... <playerN> - list everyone in their real-life circle order.");
        return;
      }
      if (!draftInProgress) {
        console.log('No draft in progress - type "start" first.');
        return;
      }
      socket.emit("st:setSeatOrder", { playerIds: rest });
      return;
    }

    if (cmd === "confirm") {
      if (!draftInProgress) {
        console.log('No draft in progress - type "start" first.');
        return;
      }
      socket.emit("st:confirmSetup");
      console.log("Confirming grimoire and sending roles out...");
      return;
    }

    if (cmd === "townhall") {
      const arg = rest[0];
      let seconds: number | null = null;
      if (arg === "off") seconds = 0;
      else if (arg !== undefined) {
        const n = Number(arg);
        seconds = Number.isFinite(n) ? n : null;
      }
      socket.emit("st:startTownHall", { seconds });
      console.log(`Starting Town Hall${seconds === null ? " (default duration)" : seconds === 0 ? " (untimed)" : ` (${seconds}s)`}...`);
      return;
    }

    if (cmd === "vote") {
      if (nominationSubPhase !== "discussing") {
        console.log("No nomination is currently waiting on discussion.");
        return;
      }
      socket.emit("st:startVoting");
      console.log("Starting the voting clock...");
      return;
    }

    if (cmd === "force") {
      socket.emit("st:forceAdvance");
      console.log("Forcing the current stage to end...");
      return;
    }

    console.log('Unrecognized command. Type "help" to see everything you can do.');
  });

  setInterval(() => {
    if (pendingDecision) return;
    socket.emit("status:poll");

    let label: string | null = null;
    if (currentPhase === "night") label = "Night is running automatically...";
    else if (currentPhase === "day") label = 'Free discussion - type "townhall" when ready.';
    if (label) {
      // Redraws in place (no trailing newline) instead of scrolling a new line each tick.
      cursorTo(stdout, 0);
      clearLine(stdout, 0);
      stdout.write(`[waiting] ${label}`);
      heartbeatVisible = true;
    }
  }, WAITING_REMINDER_INTERVAL_MS);
}

main();
