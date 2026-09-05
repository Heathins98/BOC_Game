import type { CharacterDefinition } from "../../types.js";

export const TROUBLE_BREWING_DEMONS: CharacterDefinition[] = [
  {
    id: "imp",
    name: "Imp",
    team: "demon",
    script: "trouble-brewing",
    abilityText: "Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.",
  },
];
