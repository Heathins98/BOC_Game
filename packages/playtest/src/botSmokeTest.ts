/**
 * Not part of the playtest tool itself - a throwaway script that drives a full
 * game over real sockets with scripted bot clients, to verify the server +
 * protocol (ready-up, Town Hall timer, Nominations/pass/repeat-rejection,
 * force-advance) work end-to-end before a human sits down at 7 terminals.
 */
import { io, type Socket } from "socket.io-client";
import { spawn } from "node:child_process";

const PORT = 3988;
const PLAYER_NAMES = ["alice", "bob", "carol", "dave", "erin"];

function log(who: string, msg: string) {
  console.log(`[${who}] ${msg}`);
}

async function waitFor<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function main() {
  const server = spawn(
    "pnpm",
    ["exec", "tsx", "src/server.ts", "--players", "5", "--port", String(PORT), "--seed", "12345", "--townhall-seconds", "3"],
    { stdio: "inherit" },
  );

  await new Promise((r) => setTimeout(r, 1500));

  const url = `http://localhost:${PORT}`;
  const playerSockets = new Map<string, Socket>();
  let done = false;
  let sawRepeatRejection = false;
  let sawPass = false;
  let sawTownHallTimerFire = false;
  let nominatedOnce = false;
  let passedOnce = false;
  let repeatAttempted = false;
  const votedOnce = new Set<string>();

  const stSocket = io(url);
  await waitFor(stSocket, "connect");
  stSocket.emit("join-storyteller");
  await waitFor(stSocket, "joined-storyteller");
  log("ST", "connected");

  stSocket.on("st:decisionRequest", ({ requestId, prompt }: { requestId: string; prompt: string }) => {
    let value = "no";
    const optionsMatch = prompt.match(/Options?:\s*([^\n]+)/);
    if (optionsMatch) value = (optionsMatch[1] as string).split(",")[0]!.trim();
    if (prompt.includes('"true,decoy"')) {
      const trueOpt = prompt.match(/True options:\s*([^\n]+)/)?.[1]?.split(",")[0]?.trim();
      const decoyOpt = prompt.match(/Decoy options:\s*([^\n]+)/)?.[1]?.split(",")[0]?.trim();
      value = `${trueOpt ?? "alice"},${decoyOpt ?? "bob"}`;
    }
    stSocket.emit("st:decisionResponse", { requestId, value });
  });

  stSocket.on("state:public", (s: { phase: string; day: number }) => {
    if (s.phase === "day") {
      log("ST", `day ${s.day} started -> starting Town Hall (3s timer)`);
      setTimeout(() => stSocket.emit("st:startTownHall", { seconds: 3 }), 300);
    }
    if (s.phase === "townhall") {
      log("ST", "Town Hall started - letting the timer run out naturally this once");
    }
    if (s.phase === "nominations" && s.day === 1) {
      sawTownHallTimerFire = true;
      log("ST", "Nominations open (Town Hall timer fired on its own, as intended)");
    }
  });

  stSocket.on("info", (p: { message: string }) => {
    if (p.message.includes("nothing to nominate")) sawPass = true;
    log("ST", `info: ${p.message}`);
  });

  stSocket.on("game:over", (g: { winner: string; reason: string }) => {
    done = true;
    log("ST", `GAME OVER: ${g.winner} - ${g.reason}`);
  });

  for (const name of PLAYER_NAMES) {
    const socket = io(url);
    await waitFor(socket, "connect");
    socket.emit("join", { name });
    await waitFor(socket, "joined");
    playerSockets.set(name, socket);
    log(name, "joined");

    socket.on("role:assign", (r: { name: string }) => {
      log(name, `role = ${r.name}`);
      setTimeout(() => socket.emit("player:ready"), 100);
    });
    socket.on("night:info", (r: { result: unknown }) => log(name, `night info = ${JSON.stringify(r.result)}`));
    socket.on("game:over", (g: { winner: string }) => log(name, `sees game over: ${g.winner}`));
    socket.on("info", (p: { message: string }) => {
      if (p.message.includes("already been made today")) sawRepeatRejection = true;
      log(name, `info: ${p.message}`);
    });

    socket.on("night:prompt", ({ requestId, prompt, count, candidates }: { requestId: string; prompt: string; count: number; candidates: string[] }) => {
      log(name, `prompted: ${prompt}`);
      const others = candidates.filter((c) => c !== name);
      const choice = (others.length > 0 ? others : candidates).slice(0, count).join(",");
      socket.emit("night:submitChoice", { requestId, value: choice });
    });

    socket.on(
      "state:public",
      (s: { phase: string; day: number; nominations: { index: number; nominatorId: string; nomineeId: string }[] }) => {
        if (s.phase !== "nominations" || s.day !== 1) return;

        if (name === "carol" && s.nominations.length === 0 && !passedOnce) {
          passedOnce = true;
          setTimeout(() => socket.emit("player:command", { line: "pass" }), 200);
        }
        if (name === "alice" && s.nominations.length === 0 && !nominatedOnce) {
          nominatedOnce = true;
          setTimeout(() => socket.emit("player:command", { line: "nominate bob" }), 400);
        }
        if (s.nominations.length === 1 && s.nominations[0]!.nomineeId === "bob") {
          if (!votedOnce.has(name)) {
            votedOnce.add(name);
            setTimeout(() => socket.emit("player:command", { line: "vote 0" }), 600);
          }
          if (name === "alice" && !repeatAttempted) {
            repeatAttempted = true;
            // Try (and expect to fail) an identical repeat of the same pair.
            setTimeout(() => socket.emit("player:command", { line: "nominate bob" }), 1000);
          }
        }
      },
    );
  }

  // Storyteller forces every day's Nominations to end (giving day 1 extra time for the
  // scripted nominate/pass/vote/repeat-rejection sequence to play out first).
  let forceScheduledForDay: number | null = null;
  stSocket.on("state:public", (s: { phase: string; day: number }) => {
    if (s.phase === "nominations" && forceScheduledForDay !== s.day) {
      forceScheduledForDay = s.day;
      setTimeout(() => stSocket.emit("st:forceAdvance"), s.day === 1 ? 2000 : 500);
    }
  });

  const start = Date.now();
  while (!done && Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 300));
  }

  const checks = { sawTownHallTimerFire, sawPass, sawRepeatRejection, gameCompleted: done };
  console.log("\nChecks:", checks);
  const allGood = Object.values(checks).every(Boolean);
  console.log(allGood ? "\n✅ Full game + new phase protocol completed over real sockets." : "\n❌ Something didn't happen as expected.");

  for (const s of playerSockets.values()) s.close();
  stSocket.close();
  server.kill();
  process.exit(allGood ? 0 : 1);
}

main();
