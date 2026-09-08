import { createInterface } from "node:readline/promises";
import { cursorTo, clearLine } from "node:readline";
import { stdin, stdout } from "node:process";
import { io } from "socket.io-client";

function parseArgs() {
  const args = process.argv.slice(2);
  const takeFlag = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, value !== undefined ? 2 : 1);
    return value;
  };
  const playerName = takeFlag("--player-name");
  const code = takeFlag("--code");
  return { url: args[0] ?? "http://localhost:3131", playerName, code };
}

const { url, playerName, code: codeFlag } = parseArgs();
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

async function main() {
  console.log(`Connecting to ${url}...`);
  const socket = io(url, { reconnection: false });

  socket.on("disconnect", (reason: string) => {
    console.log(`\n❌ Server session ended (${reason}). Exiting.`);
    process.exit(1);
  });
  socket.on("connect_error", (err: Error) => {
    console.log(`\n❌ Could not reach the server (${err.message}). Exiting.`);
    process.exit(1);
  });

  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

  const code = codeFlag !== undefined ? codeFlag : (await rl.question("Session code: ")).trim();

  let joined = false;
  while (!joined) {
    const name = playerName !== undefined ? playerName : (await rl.question("Your name (letters/numbers/-/_ only, no spaces): ")).trim();
    console.log(`Connected. Joining as ${name}...`);
    socket.emit("join", { name, code });
    const result = await new Promise<{ ok: boolean; message?: string; reason?: string | undefined }>((resolve) => {
      socket.once("joined", () => resolve({ ok: true }));
      socket.once("error", (e: { message: string; reason?: string }) => resolve({ ok: false, message: e.message, reason: e.reason }));
    });
    if (result.ok) {
      joined = true;
      console.log("Joined! Waiting for the rest of the table...");
    } else {
      console.log(`Could not join: ${result.message}`);
      if (result.reason === "invalid-code") {
        console.log("The session code was rejected - exiting instead of retrying.");
        process.exit(1);
      }
      if (playerName !== undefined) {
        console.log(`--player-name "${playerName}" was rejected - exiting instead of retrying.`);
        process.exit(1);
      }
    }
  }

  let pendingNightPrompt: { requestId: string } | null = null;
  let pendingVotePrompt: { requestId: string } | null = null;
  let currentPhase = "setup";
  let currentTownHallEndsAt: number | null = null;
  let hasReadied = false;
  let lastPrintedLobby = "";
  let lastPrintedReadyStatus = "";
  let lastPrintedState = "";

  socket.on("lobby:update", (u: { playersJoined: number; playersExpected: number; storytellerJoined: boolean; readyToStart: boolean }) => {
    const snapshot = JSON.stringify(u);
    if (snapshot === lastPrintedLobby) return;
    lastPrintedLobby = snapshot;
    console.log(`Lobby: ${u.playersJoined}/${u.playersExpected} players joined. Storyteller ${u.storytellerJoined ? "present" : "MISSING"}.`);
    if (u.readyToStart) console.log("Everyone's here - waiting for the Storyteller to build and confirm the grimoire...");
  });

  socket.on("lobby:readyStatus", (r: { readyIds: string[]; waitingOnIds: string[] }) => {
    const snapshot = JSON.stringify(r);
    if (snapshot === lastPrintedReadyStatus) return;
    lastPrintedReadyStatus = snapshot;
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
    const r = p.result as
      | {
          kind: "grimoire";
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
        }
      | undefined;
    if (r?.kind === "grimoire" && Array.isArray(r.players)) {
      console.log("\n=== YOU SEE THE GRIMOIRE ===");
      for (const pl of r.players) {
        const flags = [
          pl.alive ? "alive" : "DEAD",
          pl.poisoned && "poisoned",
          pl.drunk && "drunk",
          pl.protectedTonight && "monk-protected",
          pl.usedSlayerPower && "used-slayer",
          pl.butlerMasterId && `master:${pl.butlerMasterId}`,
          pl.drunkShowsAsCharacterId && `shows-as:${pl.drunkShowsAsCharacterId}`,
        ]
          .filter(Boolean)
          .join(", ");
        console.log(`  ${pl.id}: ${pl.characterId} (${pl.alignment}) [${flags}]`);
      }
      if (r.redHerringId) console.log(`  Red Herring: ${r.redHerringId}`);
      console.log("");
      return;
    }
    console.log(`\n[YOUR NIGHT INFO] ${JSON.stringify(p.result)}\n`);
  });

  socket.on("vote:prompt", (p: { requestId: string; nominatorId: string; nomineeId: string; secondsLeft: number }) => {
    pendingVotePrompt = { requestId: p.requestId };
    console.log(
      `\n[VOTE] Your turn! Vote to execute ${p.nomineeId} (nominated by ${p.nominatorId})? ~${p.secondsLeft}s - type "yes" to vote, anything else (or nothing) = not voting.`,
    );
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
      nominationSubPhase: "open" | "discussing" | "voting" | null;
      activeVote: { nominatorId: string; nomineeId: string; currentVoterId: string | null; turnEndsAt: number | null; votesSoFar: number } | null;
      blockHolder: { nominatorId: string; nomineeId: string; votes: number } | null;
      nominationHistory: { nominatorId: string; nomineeId: string; votes: number; metThreshold: boolean }[];
    }) => {
      currentPhase = s.phase;
      currentTownHallEndsAt = s.townHallEndsAt;
      const secondsLeft = s.phase === "townhall" && s.townHallEndsAt ? Math.max(0, Math.round((s.townHallEndsAt - Date.now()) / 1000)) : null;
      const snapshot = JSON.stringify({ s, secondsLeft });
      if (snapshot === lastPrintedState) return;
      lastPrintedState = snapshot;

      const phaseLabel = s.phase === "townhall" ? "Town Hall" : s.phase === "nominations" ? "Nominations" : s.phase;
      console.log(`\n[STATE] phase=${phaseLabel} night=${s.night} day=${s.day}`);
      if (s.phase === "townhall" && secondsLeft !== null) {
        console.log(`Town Hall ends in ~${secondsLeft}s (or when the Storyteller forces it).`);
      }
      console.log("Players: " + s.players.map((p) => `${p.id}${p.alive ? "" : " (dead)"}`).join(", "));
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
      if (s.phase === "day") console.log('Discuss freely. Waiting on the Storyteller to start Town Hall.');
      if (s.phase === "townhall") console.log('Discuss freely. Nominations open once Town Hall ends.');
      if (s.phase === "nominations" && s.nominationSubPhase === "open") console.log('cmd (nominate <name> | pass | slayer <name> | status)>');
      if (s.phase === "nominations" && s.nominationSubPhase === "discussing") console.log("Discuss freely. Waiting on the Storyteller to start voting.");
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
    if (pendingVotePrompt) {
      socket.emit("vote:submitChoice", { requestId: pendingVotePrompt.requestId, value: trimmed });
      pendingVotePrompt = null;
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
    if (pendingNightPrompt || pendingVotePrompt) return;
    if (rl.line.length > 0) return; // don't clobber a command the user is mid-typing
    socket.emit("status:poll");

    let label: string | null = null;
    if (!hasReadied) {
      label = 'Still waiting on you to read your role and type "ready".';
    } else if (currentPhase === "night" || currentPhase === "setup") {
      label = "Waiting on other players' night actions...";
    } else if (currentPhase === "townhall" && currentTownHallEndsAt) {
      const secondsLeft = Math.max(0, Math.round((currentTownHallEndsAt - Date.now()) / 1000));
      label = `Town Hall ends in ~${secondsLeft}s (or when the Storyteller forces it).`;
    }
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
