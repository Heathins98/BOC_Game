import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { io } from "socket.io-client";

const url = process.argv[2] ?? "http://localhost:3131";
const rl = createInterface({ input: stdin, output: stdout });

const WAITING_REMINDER_INTERVAL_MS = 15_000;

let pendingDecision: { requestId: string } | null = null;
let currentPhase = "setup";

function printHelp() {
  console.log(`
=== Storyteller commands ===
  help                    Show this list.
  townhall                Start Town Hall (from Day), using the server's default timer.
  townhall <seconds>      Start Town Hall with a custom duration for today.
  townhall off            Start Town Hall untimed - only "force" will end it.
  force                   End the current Town Hall or Nominations stage right now.
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

  socket.on("lobby:update", (u: { playersJoined: number; playersExpected: number }) => {
    console.log(`Lobby: ${u.playersJoined}/${u.playersExpected} players joined.`);
  });

  socket.on("lobby:readyStatus", (r: { readyIds: string[]; waitingOnIds: string[] }) => {
    if (r.waitingOnIds.length === 0) {
      console.log("All players are ready.");
    } else {
      console.log(`Waiting on: ${r.waitingOnIds.join(", ")} to read their role and type "ready".`);
    }
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
      nominations: { index: number; nominatorId: string; nomineeId: string; votes: number }[];
    }) => {
      currentPhase = s.phase;
      const phaseLabel = s.phase === "townhall" ? "Town Hall" : s.phase === "nominations" ? "Nominations" : s.phase;
      console.log(`\n[STATE] phase=${phaseLabel} night=${s.night} day=${s.day}`);
      if (s.phase === "townhall" && s.townHallEndsAt) {
        const secondsLeft = Math.max(0, Math.round((s.townHallEndsAt - Date.now()) / 1000));
        console.log(`Town Hall ends in ~${secondsLeft}s (or type "force" to end it now).`);
      }
      if (s.nominations.length > 0) {
        console.log("Nominations: " + s.nominations.map((n) => `#${n.index} ${n.nominatorId}→${n.nomineeId} (${n.votes} votes)`).join(" | "));
      }
      if (s.phase === "day") console.log('Type "townhall" (optionally "townhall <seconds>" or "townhall off") to start discussion.');
      if (s.phase === "townhall") console.log('Type "force" to end Town Hall early and open Nominations.');
      if (s.phase === "nominations") console.log('Type "force" to end Nominations and resolve the day.');
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
    if (currentPhase === "night") console.log("[waiting] Night is running automatically...");
    else if (currentPhase === "day") console.log('[waiting] Free discussion - type "townhall" when ready.');
  }, WAITING_REMINDER_INTERVAL_MS);
}

main();
