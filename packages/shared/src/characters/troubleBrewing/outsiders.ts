import type { CharacterDefinition } from "../../types.js";

export const TROUBLE_BREWING_OUTSIDERS: CharacterDefinition[] = [
  {
    id: "butler",
    name: "Butler",
    team: "outsider",
    script: "trouble-brewing",
    abilityText: "Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.",
  },
  {
    id: "drunk",
    name: "Drunk",
    team: "outsider",
    script: "trouble-brewing",
    abilityText: "You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.",
  },
  {
    id: "recluse",
    name: "Recluse",
    team: "outsider",
    script: "trouble-brewing",
    abilityText: "You might register as evil & as a Minion or Demon, even if dead.",
  },
  {
    id: "saint",
    name: "Saint",
    team: "outsider",
    script: "trouble-brewing",
    abilityText: "If you die by execution, your team loses.",
  },
];
