import type { CharacterDefinition } from "../../types.js";

export const TROUBLE_BREWING_TOWNSFOLK: CharacterDefinition[] = [
  {
    id: "washerwoman",
    name: "Washerwoman",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "You start knowing that 1 of 2 players is a particular Townsfolk.",
  },
  {
    id: "librarian",
    name: "Librarian",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)",
  },
  {
    id: "investigator",
    name: "Investigator",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "You start knowing that 1 of 2 players is a particular Minion.",
  },
  {
    id: "chef",
    name: "Chef",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "You start knowing how many pairs of evil players there are.",
  },
  {
    id: "empath",
    name: "Empath",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "Each night, you learn how many of your 2 alive neighbors are evil.",
  },
  {
    id: "fortune-teller",
    name: "Fortune Teller",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText:
      "Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.",
  },
  {
    id: "undertaker",
    name: "Undertaker",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "Each night*, you learn which character died by execution today.",
  },
  {
    id: "monk",
    name: "Monk",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "Each night*, choose a player (not yourself): they are safe from the Demon tonight.",
  },
  {
    id: "ravenkeeper",
    name: "Ravenkeeper",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "If you die at night, you are woken to choose a player: you learn their character.",
  },
  {
    id: "virgin",
    name: "Virgin",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.",
  },
  {
    id: "slayer",
    name: "Slayer",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "Once per game, during the day, publicly choose a player: if they are the Demon, they die.",
  },
  {
    id: "soldier",
    name: "Soldier",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText: "You are safe from the Demon.",
  },
  {
    id: "mayor",
    name: "Mayor",
    team: "townsfolk",
    script: "trouble-brewing",
    abilityText:
      "If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.",
  },
];
