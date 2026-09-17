/*! Open Historia — puppet visibility tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/puppets.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { livePuppetsFor, loyaltyBand, visiblePuppetsFor } from "./puppets.js";

// One field, different rows per viewer - the same problem chatVisibility.js
// solves for transcripts. What separates the two: a chat filters on
// PARTICIPATION, answerable from data already present, while a puppet filters
// on ACQUIRED KNOWLEDGE, which accumulates over time and can go stale.

const world = (rows) => ({ puppets: rows });

const openSatellite = {
  id: "p1",
  overlord: "USSR",
  puppet: "Poland",
  kind: "satellite",
  loyalty: 40,
  secrecy: "open",
  knownTo: [],
  status: "active",
  startedDate: "1945-06-28",
};

const covertClient = {
  id: "p2",
  overlord: "USSR",
  puppet: "Finland",
  kind: "client",
  loyalty: 70,
  secrecy: "covert",
  knownTo: [{ polity: "United Kingdom", learnedDate: "1948-03-02" }],
  status: "active",
  startedDate: "1947-11-01",
};

test("an Overlord sees its own Puppet with a Loyalty band", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "USSR");
  assert.equal(row.role, "overlord");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyaltyBand, "Restless");
  assert.equal(row.loyalty, 40);
});

test("a Puppet sees who its Overlord is, but never its own Loyalty", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "Poland");
  assert.equal(row.role, "puppet");
  assert.equal(row.overlord, "USSR");
  assert.equal(row.loyalty, null);
  assert.equal(row.loyaltyBand, null);
});

test("an open Puppet is visible to a third party, without Loyalty", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "United Kingdom");
  assert.equal(row.role, "foreign");
  assert.equal(row.kind, "satellite");
  assert.equal(row.loyalty, null);
  assert.equal(row.loyaltyBand, null);
  assert.equal(row.fromIntelligence, false);
});

test("a covert Puppet is invisible to a third party that has not learned it", () => {
  assert.deepEqual(visiblePuppetsFor(world([covertClient]), "France"), []);
});

test("a covert Puppet learned by a third party carries the date it was learned", () => {
  const [row] = visiblePuppetsFor(world([covertClient]), "United Kingdom");
  assert.equal(row.puppet, "Finland");
  assert.equal(row.fromIntelligence, true);
  assert.equal(row.asOf, "1948-03-02");
  assert.equal(row.loyalty, null);
});

test("Loyalty is withheld even on an open Puppet, from everyone but the Overlord", () => {
  const rows = ["Poland", "United Kingdom", "France"]
    .map((viewer) => visiblePuppetsFor(world([openSatellite]), viewer)[0])
    .filter(Boolean);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.loyalty, null);
});

test("a covert relationship that ended still reads as live to whoever learned it", () => {
  const ended = { ...covertClient, status: "released", endedDate: "1953-04-10" };
  const [stale] = visiblePuppetsFor(world([ended]), "United Kingdom");
  assert.equal(stale.status, "active", "the believed state, not the true one");
  assert.equal(stale.asOf, "1948-03-02");

  const [truth] = visiblePuppetsFor(world([ended]), "USSR");
  assert.equal(truth.status, "released", "the Overlord knows what it did");
});

test("an open relationship that ended is ended for everyone", () => {
  const ended = { ...openSatellite, status: "revolted", endedDate: "1956-10-23" };
  for (const viewer of ["USSR", "Poland", "United Kingdom"]) {
    assert.equal(visiblePuppetsFor(world([ended]), viewer)[0].status, "revolted");
  }
});

test("livePuppetsFor drops what is over, and keeps what a viewer wrongly believes", () => {
  const rows = [
    { ...openSatellite, status: "revolted" },
    { ...covertClient, status: "released" },
  ];
  assert.deepEqual(livePuppetsFor(world(rows), "USSR"), []);
  assert.deepEqual(livePuppetsFor(world(rows), "United Kingdom").map((row) => row.puppet), ["Finland"]);
});

test("viewer matching ignores case and surrounding space", () => {
  const [row] = visiblePuppetsFor(world([openSatellite]), "  ussr  ");
  assert.equal(row.role, "overlord");
});

test("a knownTo entry written as a bare name still grants sight", () => {
  const legacy = { ...covertClient, knownTo: ["United Kingdom"] };
  const [row] = visiblePuppetsFor(world([legacy]), "United Kingdom");
  assert.equal(row.fromIntelligence, true);
  assert.equal(row.asOf, "");
});

test("no viewer, no rows - an unknown viewer is not a licence to see secrets", () => {
  assert.deepEqual(visiblePuppetsFor(world([covertClient]), ""), []);
  assert.deepEqual(visiblePuppetsFor(world([openSatellite]), "").map((row) => row.role), ["foreign"]);
});

test("a world with no ledger answers with no rows rather than throwing", () => {
  assert.deepEqual(visiblePuppetsFor({}, "USSR"), []);
  assert.deepEqual(visiblePuppetsFor(null, "USSR"), []);
});

test("Loyalty bands run Loyal, Content, Restless, Seething", () => {
  assert.equal(loyaltyBand(100), "Loyal");
  assert.equal(loyaltyBand(75), "Loyal");
  assert.equal(loyaltyBand(74), "Content");
  assert.equal(loyaltyBand(50), "Content");
  assert.equal(loyaltyBand(49), "Restless");
  assert.equal(loyaltyBand(25), "Restless");
  assert.equal(loyaltyBand(24), "Seething");
  assert.equal(loyaltyBand(0), "Seething");
});
