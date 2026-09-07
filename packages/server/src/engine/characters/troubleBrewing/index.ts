import type { CharacterId } from "@boc/shared";
import type { NightActionHandler } from "../../nightAction.js";
import {
  chefHandler,
  empathHandler,
  fortuneTellerHandler,
  investigatorHandler,
  librarianHandler,
  monkHandler,
  ravenkeeperHandler,
  undertakerHandler,
  washerwomanHandler,
} from "./townsfolk.js";
import { butlerHandler } from "./outsiders.js";
import { poisonerHandler, spyHandler } from "./minions.js";
import { impHandler } from "./demons.js";

/**
 * Characters with no entry here (Recluse, Saint, Drunk, Soldier, Mayor, Virgin,
 * Slayer, Baron, Scarlet Woman) have no night action at all - they're either
 * passive (checked elsewhere, e.g. killResolution.ts), a setup-only modifier,
 * or a daytime-only power. Spy has an entry despite not mutating any grimoire
 * state, since it's an informational reveal like Empath/Fortune Teller.
 */
export const TROUBLE_BREWING_NIGHT_HANDLERS: Partial<Record<CharacterId, NightActionHandler>> = {
  washerwoman: washerwomanHandler,
  librarian: librarianHandler,
  investigator: investigatorHandler,
  chef: chefHandler,
  empath: empathHandler,
  "fortune-teller": fortuneTellerHandler,
  undertaker: undertakerHandler,
  monk: monkHandler,
  ravenkeeper: ravenkeeperHandler,
  butler: butlerHandler,
  poisoner: poisonerHandler,
  spy: spyHandler,
  imp: impHandler,
};
