/*! Open Historia — refused-demand signal tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/diplomaticRefusal.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { parseDiplomaticEnvelope } from "./diplomaticEnvelope.js";

// A demand is negotiable text, so the engine cannot see a refusal by reading the
// reply. REFUSED_DEMAND is the signal that makes the one deterministic Loyalty
// rule possible — and, like REACTION and DIPLOMATIC_MEMORY, it must never reach
// the chat bubble.

test("a refusal names the Overlord and is stripped from the reply", () => {
  const { reply, refusedOverlord } = parseDiplomaticEnvelope(
    "Warsaw will not send divisions east. We have given enough.\nREFUSED_DEMAND: USSR",
  );
  assert.equal(refusedOverlord, "USSR");
  assert.equal(reply, "Warsaw will not send divisions east. We have given enough.");
});

test("a reply that refuses nothing carries no signal", () => {
  const { reply, refusedOverlord } = parseDiplomaticEnvelope("We will consider it.");
  assert.equal(refusedOverlord, "");
  assert.equal(reply, "We will consider it.");
});

test("the refusal survives alongside the reaction and the durable memory", () => {
  const { reply, reaction, memorySummary, refusedOverlord } = parseDiplomaticEnvelope(
    ["We decline.", "REFUSED_DEMAND: USSR", "DIPLOMATIC_MEMORY: Moscow demanded troops; Warsaw refused.", "REACTION: 😠"].join("\n"),
  );
  assert.equal(reply, "We decline.");
  assert.equal(refusedOverlord, "USSR");
  assert.equal(reaction, "😠");
  assert.match(memorySummary, /Warsaw refused/);
  assert.doesNotMatch(reply, /REFUSED_DEMAND|DIPLOMATIC_MEMORY|REACTION/);
});
