import { describe, expect, it } from "vitest";
import { buildGrimoire } from "../src/testUtils/buildGrimoire.js";
import { ScriptedDecisionProvider } from "../src/testUtils/scriptedProviders.js";
import { applyDeath, resolveDemonNightKill } from "../src/engine/killResolution.js";

describe("resolveDemonNightKill", () => {
  it("is blocked by the Monk's protection", async () => {
    const grimoire = buildGrimoire([
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("empath").protectedTonight = true;
    const died = await resolveDemonNightKill(grimoire, "empath", new ScriptedDecisionProvider(grimoire));
    expect(died).toBeNull();
    expect(grimoire.getPlayer("empath").alive).toBe(true);
  });

  it("is blocked by the Soldier's immunity", async () => {
    const grimoire = buildGrimoire([
      { id: "soldier", characterId: "soldier" },
      { id: "imp", characterId: "imp" },
    ]);
    const died = await resolveDemonNightKill(grimoire, "soldier", new ScriptedDecisionProvider(grimoire));
    expect(died).toBeNull();
    expect(grimoire.getPlayer("soldier").alive).toBe(true);
  });

  it("does not immunize a Soldier who is poisoned", async () => {
    const grimoire = buildGrimoire([
      { id: "soldier", characterId: "soldier" },
      { id: "imp", characterId: "imp" },
    ]);
    grimoire.getPlayer("soldier").poisoned = true;
    const died = await resolveDemonNightKill(grimoire, "soldier", new ScriptedDecisionProvider(grimoire));
    expect(died).toBe("soldier");
    expect(grimoire.getPlayer("soldier").alive).toBe(false);
  });

  it("redirects the Mayor's kill when the Storyteller chooses to", async () => {
    const grimoire = buildGrimoire([
      { id: "mayor", characterId: "mayor" },
      { id: "empath", characterId: "empath" },
      { id: "imp", characterId: "imp" },
    ]);
    const decisionProvider = new ScriptedDecisionProvider(grimoire, { wantsMayorRedirect: async () => "empath" });
    const died = await resolveDemonNightKill(grimoire, "mayor", decisionProvider);
    expect(died).toBe("empath");
    expect(grimoire.getPlayer("mayor").alive).toBe(true);
    expect(grimoire.getPlayer("empath").alive).toBe(false);
  });

  it("kills the Mayor normally when the Storyteller does not redirect", async () => {
    const grimoire = buildGrimoire([
      { id: "mayor", characterId: "mayor" },
      { id: "imp", characterId: "imp" },
    ]);
    const died = await resolveDemonNightKill(grimoire, "mayor", new ScriptedDecisionProvider(grimoire));
    expect(died).toBe("mayor");
    expect(grimoire.getPlayer("mayor").alive).toBe(false);
  });
});

describe("applyDeath", () => {
  it("promotes a living Scarlet Woman to Demon when 5+ players remain alive after the Demon dies", () => {
    const grimoire = buildGrimoire([
      { id: "sw", characterId: "scarlet-woman" },
      { id: "imp", characterId: "imp" },
      { id: "p3", characterId: "empath" },
      { id: "p4", characterId: "monk" },
      { id: "p5", characterId: "butler" },
      { id: "p6", characterId: "washerwoman" },
    ]);
    applyDeath(grimoire, "imp", "execution");
    expect(grimoire.getPlayer("sw").characterId).toBe("imp");
    expect(grimoire.newlyDemonPlayerId).toBe("sw");
  });

  it("does not promote the Scarlet Woman below 5 living players", () => {
    const grimoire = buildGrimoire([
      { id: "sw", characterId: "scarlet-woman" },
      { id: "imp", characterId: "imp" },
      { id: "p3", characterId: "empath" },
    ]);
    applyDeath(grimoire, "imp", "execution");
    expect(grimoire.getPlayer("sw").characterId).toBe("scarlet-woman");
  });

  it("does not double-promote the Scarlet Woman on an Imp self-kill", () => {
    const grimoire = buildGrimoire([
      { id: "sw", characterId: "scarlet-woman" },
      { id: "imp", characterId: "imp" },
      { id: "p3", characterId: "empath" },
      { id: "p4", characterId: "monk" },
      { id: "p5", characterId: "butler" },
      { id: "p6", characterId: "washerwoman" },
    ]);
    applyDeath(grimoire, "imp", "imp-self-kill");
    expect(grimoire.getPlayer("sw").characterId).toBe("scarlet-woman");
    expect(grimoire.newlyDemonPlayerId).toBeNull();
  });
});
