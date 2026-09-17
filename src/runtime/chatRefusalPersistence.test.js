/*! Open Historia — refusal round-trip tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatRefusalPersistence.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChats } from "./gameState.js";

// The one deterministic Loyalty rule reads refusals back off the SAVED
// transcript a turn later, so the flag has to survive the round trip. It did not
// for two commits: normalizeChatMessage returns a fixed object, so every write
// quietly dropped the field and the rule never fired once.

const chatWith = (message) => [{
  id: "c1",
  countries: [{ code: "POL", name: "Poland" }],
  messages: [message],
}];

test("a refusal survives being written and read back", () => {
  const [chat] = normalizeChats(chatWith({
    role: "leader",
    speaker: "Poland",
    text: "Warsaw will not send divisions east.",
    time: "1952-03-04",
    refusedOverlord: "USSR",
  }));
  assert.equal(chat.messages[0].refusedOverlord, "USSR");
});

test("an ordinary message carries an empty refusal rather than none at all", () => {
  const [chat] = normalizeChats(chatWith({ role: "leader", speaker: "Poland", text: "We will consider it." }));
  assert.equal(chat.messages[0].refusedOverlord, "");
});

test("a message stored as a bare string has the same shape as any other", () => {
  const [chat] = normalizeChats(chatWith("A note from the archives."));
  assert.deepEqual(Object.keys(chat.messages[0]).sort(), Object.keys(
    normalizeChats(chatWith({ role: "leader", speaker: "Poland", text: "x" }))[0].messages[0],
  ).sort());
});
