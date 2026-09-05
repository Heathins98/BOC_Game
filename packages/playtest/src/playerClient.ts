import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { io } from "socket.io-client";

const url = process.argv[2] ?? "http://localhost:3131";
const rl = createInterface({ input: stdin, output: stdout });

const WAITING_REMINDER_INTERVAL_MS = 15_000;

async function main() {
  const socket = io(url, { reconnection: false });
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  let joined = false;
  while (!joined) {
    const name = (await rl.question("Your name (letters/numbers/-/_ only, no spaces): ")).trim();
    socket.emit("join", { name });
    const result = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
      socket.once("joined", () => resolve({ ok: true }));
      socket.once("error", (e: { message: string }) => resolve({ ok: false, message: e.message }));
    });
    if (result.ok) {
      joined = true;
      console.log("Joined! Waiting for the rest of the table...");
    } else {
      console.log(`Could not join: ${result.message}`);
    }
  }

  let pendingNightPrompt: { requestId: string } | null = null;
  let currentPhase = "setup";
  let hasReadied = false;

  socket.on("disconnect", (reason: string) => {
    console.log(`\n❌ Server session ended (${reason}). Exiting.`);
    process.exit(1);
  });
  socket.on("connect_error", (err: Error) => {
    console.log(`\n❌ Could not reach the server (${err.message}). Exiting.`);
    process.exit(1);
  });

  socket.on("lobby:update", (u: { playersJoined: number; playersExpected: number; storytellerJoined: boolean }) => {
    console.log(`Lobby: ${u.playersJoined}/${u.playersExpected} players joined. Storyteller ${u.storytellerJoined ? "present" : "MISSING"}.`);
  });

  socket.on("lobby:readyStatus", (r: { readyIds: string[]; waitingOnIds: string[] }) => {
    if (r.waitingOnIds.length === 0) {
      console.log("Everyone is ready!");
    } else {
      console.log(`Waiting on: ${r.waitingOnIds.join(", ")} to type "ready".`);
    }
  });

  socket.on("role:assign", (r: { name: string; team: string; abilityText: string }) => {
    console.log(`\n=== YOUR ROLE: ${r.name} (${r.team}) ===`);
    console.log(r.abilityText);
    console.log('(Keep this secret from the other players!) Type "ready" once you have read it.\n');
  });

  socket.on("night:prompt", (p: { requestId: string; prompt: string }) => {
    pendingNightPrompt = { requestId: p.requestId };
    console.log(`\n[NIGHT ACTION] ${p.prompt}`);
    console.log("> (type your answer and press enter)");
  });

  socket.on("night:info", (p: { result: unknown }) => {
    console.log(`\n[YOUR NIGHT INFO] ${JSON.stringify(p.result)}\n`);
  });

  socket.on("info", (p: { message: string }) => console.log(`[info] ${p.message}`));
  socket.on("error", (p: { message: string }) => console.log(`[error] ${p.message}`));

  socket.on(
    "state:public",
    (s: {
      phase: string;
      night: number;
      day: number;
      townHallEndsAt: number | null;
      players: { id: string; alive: boolean }[];
      nominations: { index: number; nominatorId: string; nomineeId: string; votes: number }[];
    }) => {
      currentPhase = s.phase;
      const phaseLabel = s.phase === "townhall" ? "Town Hall" : s.phase === "nominations" ? "Nominations" : s.phase;
      console.log(`\n[STATE] phase=${phaseLabel} night=${s.night} day=${s.day}`);
      if (s.phase === "townhall" && s.townHallEndsAt) {
        const secondsLeft = Math.max(0, Math.round((s.townHallEndsAt - Date.now()) / 1000));
        console.log(`Town Hall ends in ~${secondsLeft}s (or when the Storyteller forces it).`);
      }
      console.log("Players: " + s.players.map((p) => `${p.id}${p.alive ? "" : " (dead)"}`).join(", "));
      if (s.nominations.length > 0) {
        console.log("Nominations: " + s.nominations.map((n) => `#${n.index} ${n.nominatorId}→${n.nomineeId} (${n.votes} votes)`).join(" | "));
      }
      if (s.phase === "day") console.log('Discuss freely. Waiting on the Storyteller to start Town Hall.');
      if (s.phase === "townhall") console.log('Discuss freely. Nominations open once Town Hall ends.');
      if (s.phase === "nominations") console.log('cmd (nominate <name> | pass | vote <#> | slayer <name> | status)>');
    },
  );

  socket.on(
    "game:over",
    (g: { winner: string; reason: string; grimoire: { id: string; characterId: string; alignment: string; alive: boolean }[] }) => {
      console.log(`\n\n=== GAME OVER: ${g.winner.toUpperCase()} WINS ===\n${g.reason}`);
      console.log("Final roles:");
      for (const p of g.grimoire) console.log(`  ${p.id}: ${p.characterId} (${p.alignment})${p.alive ? "" : " - dead"}`);
      rl.close();
      socket.close();
      process.exit(0);
    },
  );

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (pendingNightPrompt) {
      socket.emit("night:submitChoice", { requestId: pendingNightPrompt.requestId, value: trimmed });
      pendingNightPrompt = null;
      return;
    }
    if (!hasReadied && trimmed.toLowerCase() === "ready") {
      hasReadied = true;
      socket.emit("player:ready");
      console.log("Marked ready. Waiting for everyone else...");
      return;
    }
    if (currentPhase === "day" || currentPhase === "townhall" || currentPhase === "nominations") {
      socket.emit("player:command", { line: trimmed });
      return;
    }
    console.log("(Nothing to do right now - wait for your turn or for the game to progress.)");
  });

  setInterval(() => {
    if (pendingNightPrompt) return;
    socket.emit("status:poll");
    if (!hasReadied) {
      console.log('[waiting] Still waiting on you to read your role and type "ready".');
    } else if (currentPhase === "night" || currentPhase === "setup") {
      console.log("[waiting] Waiting on other players' night actions...");
    }
  }, WAITING_REMINDER_INTERVAL_MS);
}

main();
