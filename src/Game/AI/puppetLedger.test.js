/*! Open Historia — puppet ledger tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/puppetLedger.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { applyPuppetUpdates, decodePuppetUpdates } from "./nativeDiplomaticDirector.js";

// A subordination rides the same compact-line transport as wars, relations and
// agreements: the model never writes the ledger, it emits lines that must
// resolve both polities and bind to a real causal event before they persist.

const baseWorld = {
  polityOverrides: {
    USSR: { code: "USSR", name: "USSR" },
    Poland: { code: "Poland", name: "Poland" },
    Finland: { code: "Finland", name: "Finland" },
    Germany: { code: "Germany", name: "Germany" },
    Slovakia: { code: "Slovakia", name: "Slovakia" },
  },
  regionOwnershipOverrides: { r1: "USSR", r2: "Poland", r3: "Finland", r4: "Germany", r5: "Slovakia" },
  relations: [],
  agreements: [],
  puppets: [],
};

const events = (title = "A government is installed") => [{
  id: "e1",
  date: "1945-06-28",
  title,
  description: "Soviet forces install a friendly government in Warsaw.",
  kind: "diplomacy",
}];

const apply = (world, lines, { round = 1 } = {}) => applyPuppetUpdates({
  world,
  updates: lines,
  events: events(),
  stopDate: "1945-06-28",
  round,
});

test("an install line creates the row, bound to its event", () => {
  const { world } = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Provisional government seated");
  assert.equal(world.puppets.length, 1);
  const [row] = world.puppets;
  assert.equal(row.overlord, "USSR");
  assert.equal(row.puppet, "Poland");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, 40);
  assert.equal(row.secrecy, "open");
  assert.equal(row.status, "active");
  assert.deepEqual(row.sourceEventIds, ["e1"]);
  assert.deepEqual(row.knownTo.map((entry) => entry.polity).sort(), ["Poland", "USSR"]);
});

test("an unbound line does not persist", () => {
  const merge = applyPuppetUpdates({
    world: baseWorld,
    updates: "install~USSR~Poland~satellite~40~open~~No event",
    events: [],
    round: 1,
  });
  assert.deepEqual(merge.world.puppets, []);
});

test("a line naming a polity the world does not know is dropped", () => {
  const { world } = apply(baseWorld, "install~USSR~Atlantis~client~50~covert~1~Nowhere");
  assert.deepEqual(world.puppets, []);
});

test("nobody subordinates themselves, and no cycle is allowed", () => {
  const self = apply(baseWorld, "install~USSR~USSR~client~50~open~1~Itself");
  assert.deepEqual(self.world.puppets, []);

  const held = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  const cycle = apply(held, "install~Poland~USSR~client~50~open~1~The tail wags the dog");
  assert.equal(cycle.world.puppets.length, 1, "the cycle is refused, the original stands");
  assert.equal(cycle.world.puppets[0].overlord, "USSR");
});

test("one Overlord per Puppet - a second Overlord is refused", () => {
  const held = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  const { world } = apply(held, "install~Germany~Poland~client~50~open~1~Also ours");
  assert.equal(world.puppets.length, 1);
  assert.equal(world.puppets[0].overlord, "USSR");
});

test("installing a Puppet that already holds one reparents it to the new Overlord", () => {
  let world = apply(baseWorld, "install~Germany~Slovakia~client~60~open~1~Client seated").world;
  world = apply(world, "install~USSR~Germany~satellite~30~open~1~Berlin falls").world;

  const rows = world.puppets.filter((row) => row.status === "active");
  assert.equal(rows.length, 2, "no chain - both are held directly");
  const slovakia = rows.find((row) => row.puppet === "Slovakia");
  assert.equal(slovakia.overlord, "USSR", "reparented one hop up");
  assert.equal(slovakia.kind, "client", "keeps its own kind");
  assert.equal(slovakia.loyalty, 60, "keeps its own Loyalty - it did not choose this");
});

test("reparenting is permanent - releasing the middle party does not give them back", () => {
  let world = apply(baseWorld, "install~Germany~Slovakia~client~60~open~1~Client seated").world;
  world = apply(world, "install~USSR~Germany~satellite~30~open~1~Berlin falls").world;
  world = apply(world, "release~USSR~Germany~~~~1~Let go").world;

  const slovakia = world.puppets.find((row) => row.puppet === "Slovakia" && row.status === "active");
  assert.equal(slovakia.overlord, "USSR", "still held directly by the new Overlord");
});

test("reclassify changes the kind and nothing else", () => {
  const held = apply(baseWorld, "install~USSR~Poland~client~40~open~1~Seated").world;
  const { world } = apply(held, "reclassify~USSR~Poland~satellite~~~1~Tightened into the bloc");
  assert.equal(world.puppets[0].kind, "satellite");
  assert.equal(world.puppets[0].loyalty, 40);
});

test("a loyalty line moves the score and clamps it", () => {
  const held = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  assert.equal(apply(held, "loyalty~USSR~Poland~~12~~1~Grain requisitions").world.puppets[0].loyalty, 12);
  assert.equal(apply(held, "loyalty~USSR~Poland~~900~~1~Adoration").world.puppets[0].loyalty, 100);
});

test("reveal turns a covert arrangement open, and cannot be undone", () => {
  const held = apply(baseWorld, "install~USSR~Finland~client~70~covert~1~Bought").world;
  assert.equal(held.puppets[0].secrecy, "covert");

  const revealed = apply(held, "reveal~USSR~Finland~~~~1~A defector talks").world;
  assert.equal(revealed.puppets[0].secrecy, "open");

  const reconcealed = apply(revealed, "install~USSR~Finland~client~70~covert~1~Back in the dark").world;
  assert.equal(reconcealed.puppets[0].secrecy, "open", "a secret that is out stays out");
});

test("release, annex and revolt each end the row in their own way", () => {
  const seated = () => apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  assert.equal(apply(seated(), "release~USSR~Poland~~~~1~Let go").world.puppets[0].status, "released");
  assert.equal(apply(seated(), "annex~USSR~Poland~~~~1~Absorbed").world.puppets[0].status, "annexed");
  assert.equal(apply(seated(), "revolt~USSR~Poland~~~~1~Thrown off").world.puppets[0].status, "revolted");
});

test("a revolt crashes the pair's relation and ends their agreements", () => {
  const world = {
    ...baseWorld,
    relations: [{ id: "r1", a: "Poland", b: "USSR", score: 60, status: "friendly" }],
    agreements: [{
      id: "a1",
      title: "Treaty of Friendship",
      type: "alliance",
      status: "active",
      parties: ["Poland", "USSR"],
    }],
    puppets: [{
      id: "p1", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 8, secrecy: "open", status: "active",
    }],
  };

  const merge = apply(world, "revolt~USSR~Poland~~~~1~Warsaw rises");
  assert.equal(merge.world.puppets[0].status, "revolted");
  assert.ok(merge.world.relations[0].score <= -40, "bitter enemies, not merely estranged");
  assert.equal(merge.world.agreements[0].status, "ended");
});

test("an update naming a subordination the ledger never recorded is dropped, not invented", () => {
  for (const verb of ["reclassify", "loyalty", "reveal", "release", "annex", "revolt"]) {
    const { world } = apply(baseWorld, `${verb}~USSR~Poland~satellite~40~open~1~Never happened`);
    assert.deepEqual(world.puppets, [], `${verb} should not create a row`);
  }
});

test("a refused demand costs Loyalty deterministically", () => {
  const held = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  const merge = applyPuppetUpdates({
    world: held,
    updates: "",
    events: events(),
    round: 2,
    refusedDemands: [{ overlord: "USSR", puppet: "Poland" }],
  });
  assert.equal(merge.world.puppets[0].loyalty, 30, "a fixed cost, not the model's judgement");
  assert.equal(merge.refusedDemandCount, 1);
});

test("a refused demand against a pair with no subordination changes nothing", () => {
  const merge = applyPuppetUpdates({
    world: baseWorld,
    updates: "",
    events: events(),
    round: 2,
    refusedDemands: [{ overlord: "USSR", puppet: "Poland" }],
  });
  assert.deepEqual(merge.world.puppets, []);
  assert.equal(merge.refusedDemandCount, 0);
});

test("decodePuppetUpdates accepts objects as well as compact lines", () => {
  const [fromLine] = decodePuppetUpdates("install~USSR~Poland~satellite~40~open~1~Seated");
  const [fromObject] = decodePuppetUpdates([{
    op: "install", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 40, secrecy: "open", note: "Seated",
  }]);
  assert.equal(fromLine.op, "install");
  assert.equal(fromObject.op, "install");
  assert.equal(fromLine.overlord, fromObject.overlord);
  assert.equal(fromLine.kind, fromObject.kind);
});

test("an unknown verb is dropped rather than guessed at", () => {
  const held = apply(baseWorld, "install~USSR~Poland~satellite~40~open~1~Seated").world;
  const { world } = apply(held, "obliterate~USSR~Poland~~~~1~Not a verb");
  assert.equal(world.puppets[0].status, "active");
  assert.equal(world.puppets[0].loyalty, 40);
});

// Regressions found in review.

test("a chain cannot be built from the top down either", () => {
  let world = apply(baseWorld, "install~USSR~Germany~satellite~40~open~1~Berlin falls").world;
  world = apply(world, "install~Germany~Slovakia~client~60~open~1~Germany takes a client").world;

  const live = world.puppets.filter((row) => row.status === "active");
  assert.equal(live.length, 2);
  const slovakia = live.find((row) => row.puppet === "Slovakia");
  assert.equal(slovakia.overlord, "USSR", "a Puppet cannot hold a Puppet - it attaches to the real Overlord");
  assert.ok(!live.some((row) => row.overlord === "Germany"), "Germany holds nobody while it is itself held");
});

test("a full ledger evicts what is over, never the install that just arrived", () => {
  const ended = Array.from({ length: 64 }, (_, index) => ({
    id: `done-${index}`,
    overlord: "USSR",
    puppet: `Gone ${index}`,
    status: "released",
    lastUpdatedDate: `19${String(10 + index).padStart(2, "0")}-01-01`,
  }));
  const full = { ...baseWorld, puppets: ended };

  const { world } = apply(full, "install~USSR~Poland~satellite~40~open~1~Seated");
  const live = world.puppets.filter((row) => row.status === "active");
  assert.equal(live.length, 1, "the new subordination survives a full ledger");
  assert.equal(live[0].puppet, "Poland");
});

test("a suppressed coup forces Loyalty up rather than ending the arrangement", () => {
  const world = {
    ...baseWorld,
    puppets: [{ id: "p1", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 10, secrecy: "open", status: "active" }],
  };
  const { world: next } = apply(world, "suppress~USSR~Poland~~~~1~The rising is put down");
  assert.equal(next.puppets[0].status, "active", "the Overlord held on");
  assert.equal(next.puppets[0].loyalty, 35, "obedience at gunpoint, not affection");
});

test("a Puppet whose Loyalty has collapsed is handed a hidden Storyline, once", () => {
  const world = {
    ...baseWorld,
    puppets: [{ id: "p1", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 12, secrecy: "open", status: "active" }],
  };
  const merge = apply(world, "loyalty~USSR~Poland~~12~~1~Grain requisitions bite");
  assert.equal(merge.storylineSeeds.length, 1);
  assert.match(merge.storylineSeeds[0], /^storyline-puppet-poland~active~/);
  assert.match(merge.storylineSeeds[0], /Poland,USSR/);

  const already = applyPuppetUpdates({
    world: {
      ...merge.world,
      storylines: [{
        id: "storyline-puppet-poland",
        kind: "unrest",
        title: "Resentment in Poland",
        status: "active",
        pressure: 76,
        momentum: 35,
        startedDate: "1945-06-28",
        state: "Poland chafes under the USSR.",
        participants: ["Poland", "USSR"],
      }],
    },
    updates: "loyalty~USSR~Poland~~11~~1~Worse",
    events: events(),
    round: 2,
  });
  assert.deepEqual(already.storylineSeeds, [], "never opened twice");
});

test("a contented Puppet gets no Storyline", () => {
  const world = {
    ...baseWorld,
    puppets: [{ id: "p1", overlord: "USSR", puppet: "Poland", kind: "satellite", loyalty: 80, secrecy: "open", status: "active" }],
  };
  assert.deepEqual(apply(world, "loyalty~USSR~Poland~~80~~1~Calm").storylineSeeds, []);
});
