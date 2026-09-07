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
    ["exec", "tsx", "src/server.ts", "--players", "5", "--port", String(PORT), "--seed", "12345", "--townhall-seconds", "3", "--vote-seconds", "2"],
    { stdio: "inherit", shell: process.platform === "win32" },
  );

  /** On Windows, `shell: true` makes `server` a cmd.exe wrapper - killing it alone leaves the real tsx/node process (and the port) behind. */
  function killServer() {
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      server.kill();
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  const url = `http://localhost:${PORT}`;
  const playerSockets = new Map<string, Socket>();
  let done = false;
  let sawRepeatRejection = false;
  let sawPass = false;
  let sawTownHallTimerFire = false;
  let sawVoteConcluded = false;
  let sawBlockHolder = false;
  let nominatedOnce = false;
  let passedOnce = false;
  let votingStarted = false;
  let voteConcluded = false;
  let repeatAttempted = false;

  const stSocket = io(url);
  await waitFor(stSocket, "connect");
  stSocket.emit("join-storyteller");
  await waitFor(stSocket, "joined-storyteller");
  log("ST", "connected");

  let sawDraftGrimoire = false;
  let sawSwapTakeEffect = false;
  let confirmedSetup = false;
  let swapRequested: { a: string; before: string } | null = null;
  stSocket.on("lobby:update", (u: { readyToStart: boolean }) => {
    if (u.readyToStart && !confirmedSetup) {
      log("ST", "lobby full -> starting setup draft");
      stSocket.emit("st:startGame");
    }
  });
  stSocket.on("st:draftGrimoire", (d: { players: { id: string; characterId: string }[] }) => {
    sawDraftGrimoire = true;
    log("ST", `draft grimoire: ${d.players.map((p) => `${p.id}=${p.characterId}`).join(", ")}`);
    if (confirmedSetup) return;

    if (swapRequested) {
      const after = d.players.find((p) => p.id === swapRequested!.a);
      sawSwapTakeEffect = !!after && after.characterId !== swapRequested.before;
      confirmedSetup = true;
      log("ST", `confirming setup (swap took effect: ${sawSwapTakeEffect}) -> roles will be sent to players`);
      stSocket.emit("st:confirmSetup");
      return;
    }

    // Swap two players other than alice/bob - the scripted nominate/vote sequence below
    // assumes their character assignments (and alice not becoming the Virgin) are undisturbed.
    const swappable = d.players.filter((p) => p.id !== "alice" && p.id !== "bob");
    const [a, b] = swappable;
    if (a && b && a.characterId !== b.characterId) {
      log("ST", `swapping ${a.id} <-> ${b.id} to exercise the draft-adjustment protocol`);
      swapRequested = { a: a.id, before: a.characterId };
      stSocket.emit("st:swapDraft", { playerA: a.id, playerB: b.id });
      return;
    }

    confirmedSetup = true;
    log("ST", "confirming setup -> roles will be sent to players");
    stSocket.emit("st:confirmSetup");
  });

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

  stSocket.on(
    "state:public",
    (s: {
      phase: string;
      day: number;
      nominationSubPhase: "open" | "discussing" | "voting" | null;
      blockHolder: { nomineeId: string; votes: number } | null;
    }) => {
      if (s.phase === "day") {
        log("ST", `day ${s.day} started -> starting Town Hall (3s timer)`);
        setTimeout(() => stSocket.emit("st:startTownHall", { seconds: 3 }), 300);
      }
      if (s.phase === "townhall") {
        log("ST", "Town Hall started - letting the timer run out naturally this once");
      }
      if (s.phase === "nominations" && s.day === 1 && !sawTownHallTimerFire) {
        sawTownHallTimerFire = true;
        log("ST", "Nominations open (Town Hall timer fired on its own, as intended)");
      }
      if (s.blockHolder) sawBlockHolder = true;
      if (s.phase === "nominations" && s.nominationSubPhase === "discussing" && !votingStarted) {
        votingStarted = true;
        log("ST", "Discussion in progress -> starting the voting clock");
        setTimeout(() => stSocket.emit("st:startVoting"), 200);
      }
      if (s.phase === "nominations" && s.day === 1 && s.nominationSubPhase === "open" && votingStarted && !voteConcluded) {
        voteConcluded = true;
        sawVoteConcluded = true;
        log("ST", "Vote concluded, back to open nominations");
      }
    },
  );

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

    // Scoped to this player's own connection, which delivers events in order -
    // avoids racing against flags set by a *different* socket's handler (e.g. the ST's).
    let sawVotingSubphaseOnThisConnection = false;

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

    // Whenever it's this player's turn on the voting clock, immediately vote yes.
    socket.on("vote:prompt", ({ requestId, nomineeId }: { requestId: string; nomineeId: string }) => {
      log(name, `voting clock: my turn to vote on ${nomineeId} -> yes`);
      socket.emit("vote:submitChoice", { requestId, value: "yes" });
    });

    socket.on(
      "state:public",
      (s: { phase: string; day: number; nominationSubPhase: "open" | "discussing" | "voting" | null }) => {
        if (s.phase !== "nominations" || s.day !== 1) return;
        if (s.nominationSubPhase === "voting") sawVotingSubphaseOnThisConnection = true;

        if (name === "carol" && s.nominationSubPhase === "open" && !passedOnce) {
          passedOnce = true;
          setTimeout(() => socket.emit("player:command", { line: "pass" }), 200);
        }
        if (name === "alice" && s.nominationSubPhase === "open" && !nominatedOnce) {
          nominatedOnce = true;
          setTimeout(() => socket.emit("player:command", { line: "nominate bob" }), 400);
        }
        // Once alice has seen her own nomination go all the way through a voting clock and
        // nominations reopen, she repeats the exact same (nominator, nominee) pair - expected
        // to be rejected as a duplicate. Tracked via this connection's own event order (not a
        // flag set by a different socket, e.g. the ST's, which isn't ordering-safe to rely on).
        if (name === "alice" && s.nominationSubPhase === "open" && sawVotingSubphaseOnThisConnection && !repeatAttempted) {
          repeatAttempted = true;
          setTimeout(() => socket.emit("player:command", { line: "nominate bob" }), 200);
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
      setTimeout(() => stSocket.emit("st:forceAdvance"), s.day === 1 ? 3500 : 500);
    }
  });

  const start = Date.now();
  while (!done && Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 300));
  }

  const checks = {
    sawDraftGrimoire,
    sawSwapTakeEffect,
    sawTownHallTimerFire,
    sawPass,
    sawVoteConcluded,
    sawBlockHolder,
    sawRepeatRejection,
    gameCompleted: done,
  };
  console.log("\nChecks:", checks);
  const allGood = Object.values(checks).every(Boolean);
  console.log(allGood ? "\n✅ Full game + new phase protocol completed over real sockets." : "\n❌ Something didn't happen as expected.");

  for (const s of playerSockets.values()) s.close();
  stSocket.close();
  killServer();
  process.exit(allGood ? 0 : 1);
}

main();
