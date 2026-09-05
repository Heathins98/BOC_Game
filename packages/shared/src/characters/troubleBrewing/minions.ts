import type { CharacterDefinition } from "../../types.js";

export const TROUBLE_BREWING_MINIONS: CharacterDefinition[] = [
  {
    id: "poisoner",
    name: "Poisoner",
    team: "minion",
    script: "trouble-brewing",
    abilityText: "Each night, choose a player: they are poisoned tonight and tomorrow day.",
  },
  {
    id: "spy",
    name: "Spy",
    team: "minion",
    script: "trouble-brewing",
    abilityText: "Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.",
  },
  {
    id: "baron",
    name: "Baron",
    team: "minion",
    script: "trouble-brewing",
    abilityText: "There are extra Outsiders in play. [+2 Outsiders]",
    setupModifier: "addsTwoOutsiders",
  },
  {
    id: "scarlet-woman",
    name: "Scarlet Woman",
    team: "minion",
    script: "trouble-brewing",
    abilityText:
      "If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don't count.)",
  },
];
