import type { ScriptDefinition, SetupCounts } from "./types.js";
import {
  TROUBLE_BREWING_TOWNSFOLK,
  TROUBLE_BREWING_OUTSIDERS,
  TROUBLE_BREWING_MINIONS,
  TROUBLE_BREWING_DEMONS,
} from "./characters/troubleBrewing/index.js";

// From the botc-trouble-brewing skill's setup table. 15+ players all reuse the 15 row.
const TROUBLE_BREWING_SETUP_TABLE: Record<number, SetupCounts> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

export const TROUBLE_BREWING: ScriptDefinition = {
  id: "trouble-brewing",
  characters: [
    ...TROUBLE_BREWING_TOWNSFOLK,
    ...TROUBLE_BREWING_OUTSIDERS,
    ...TROUBLE_BREWING_MINIONS,
    ...TROUBLE_BREWING_DEMONS,
  ],
  setupTable: TROUBLE_BREWING_SETUP_TABLE,
  // Dusk / Minion Info / Demon Info / Dawn are engine-level bookend steps, not data.
  firstNightOrder: [
    { characterId: "poisoner" },
    { characterId: "washerwoman" },
    { characterId: "librarian" },
    { characterId: "investigator" },
    { characterId: "chef" },
    { characterId: "empath" },
    { characterId: "fortune-teller" },
    { characterId: "butler" },
    { characterId: "spy", condition: "actsWhileDead" },
  ],
  otherNightOrder: [
    { characterId: "poisoner" },
    { characterId: "monk" },
    { characterId: "scarlet-woman", condition: "becameDemonToday" },
    { characterId: "imp" },
    { characterId: "ravenkeeper", condition: "diedTonight" },
    { characterId: "empath" },
    { characterId: "fortune-teller" },
    { characterId: "undertaker", condition: "executionOccurredToday" },
    { characterId: "butler" },
    { characterId: "spy", condition: "actsWhileDead" },
  ],
};

export const SCRIPTS: Record<string, ScriptDefinition> = {
  "trouble-brewing": TROUBLE_BREWING,
};

/** Highest player count the setup table has an explicit row for; larger counts reuse this row. */
export const TROUBLE_BREWING_MAX_TABLED_PLAYER_COUNT = 15;
