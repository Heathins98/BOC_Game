import { describe, expect, it } from "vitest";
import { Rng, TROUBLE_BREWING } from "@boc/shared";
import type { WinResult } from "../src/engine/winConditions.js";
import { GameSession } from "../src/engine/game.js";
import { randomComposition } from "../src/engine/setup.js";
import { RandomDecisionProvider, RandomPlayerChoiceProvider } from "../src/testUtils/randomProviders.js";

const MAX_NIGHT_DAY_CYCLES = 25;

function runSimulatedDay(session: GameSession, rng: Rng): WinResult | null {
  session.startDay();

  const nominationCount = rng.nextInt(3); // 0, 1 or 2 nominations today
  const alreadyNominated = new Set<string>();
  const alreadyNominators = new Set<string>();

  for (let i = 0; i < nominationCount; i++) {
    const livingIds = session.grimoire.livingPlayers().map((p) => p.id);
    const nominators = livingIds.filter((id) => !alreadyNominators.has(id));
    if (nominators.length === 0) break;
    const nominatorId = rng.pick(nominators);
    const nominees = session.grimoire
      .allPlayers()
      .map((p) => p.id)
      .filter((id) => id !== nominatorId && !alreadyNominated.has(id));
    if (nominees.length === 0) break;
    const nomineeId = rng.pick(nominees);

    alreadyNominators.add(nominatorId);
    alreadyNominated.add(nomineeId);

    const outcome = session.nominate(nominatorId, nomineeId);
    if (outcome.kind === "rejected") continue;
    if (outcome.kind === "virgin-triggered") {
      const win = session.checkWin();
      if (win) return win;
      continue;
    }

    for (const voterId of session.grimoire.seatOrder) {
      const voter = session.grimoire.getPlayer(voterId);
      if (!voter.alive && !voter.ghostVoteAvailable) continue;
      if (rng.next() < 0.4) session.castVote(outcome.nomination, voterId);
    }
  }

  session.resolveDayExecutions();
  return session.checkWin();
}

describe("full-game simulation", () => {
  const playerCounts = [5, 7, 8, 10, 12, 15];

  for (const playerCount of playerCounts) {
    it(`terminates with a valid winner for ${playerCount} players (seeded)`, async () => {
      for (let seed = 0; seed < 5; seed++) {
        const rng = new Rng(playerCount * 1000 + seed);
        const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
        const characterIds = randomComposition(TROUBLE_BREWING, playerCount, rng);

        const decisionProvider = new RandomDecisionProvider(rng);
        const session = await GameSession.start({
          players,
          script: TROUBLE_BREWING,
          characterIds,
          decisionProvider,
          playerChoiceProvider: new RandomPlayerChoiceProvider(rng),
          rng,
        });
        decisionProvider.grimoire = session.grimoire;

        let winner: WinResult | null = null;
        for (let cycle = 0; cycle < MAX_NIGHT_DAY_CYCLES && !winner; cycle++) {
          await session.runNight();
          winner = session.checkWin();
          if (winner) break;
          winner = runSimulatedDay(session, rng);
        }

        expect(winner).not.toBeNull();
        expect(["good", "evil"]).toContain(winner!.winner);
      }
    });
  }
});
