/*! Open Historia — refusal round-trip tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatRefusalPersistence.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { chargeRefusals, normalizeChats } from "./gameState.js";

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
    refusedPuppet: "Poland",
  }));
  assert.equal(chat.messages[0].refusedOverlord, "USSR");
  assert.equal(chat.messages[0].refusedPuppet, "Poland");
  assert.equal(chat.messages[0].refusalChargedRound, 0, "not counted yet");
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

test("a refusal already charged remembers the round that charged it", () => {
  // Dates cannot answer "has this been counted?" - a retried jump lands on the
  // same game date, and without the stamp the same refusal costs Loyalty twice.
  const [chat] = normalizeChats(chatWith({
    role: "leader",
    speaker: "Poland",
    text: "No.",
    time: "1952-03-04",
    refusedOverlord: "USSR",
    refusedPuppet: "Poland",
    refusalChargedRound: 7,
  }));
  assert.equal(chat.messages[0].refusalChargedRound, 7);
});

// Threads grew an EVENT LOG on beta (chatThreads.js), and a thread with one has
// its messages REBUILT from the log's projection — which carries only the fields
// it knows. The fixtures above have no log, so they never exercised that path.
// This is the same drop the normalizer made before, one layer further down.

const loggedThread = (extraMessage) => ({
  id: "t1",
  countries: [{ code: "POL", name: "Poland" }],
  events: [
    { id: "t1-created", kind: "chat_created", time: "1952-01-01", title: "Warsaw and Moscow" },
    { id: "t1-join", kind: "member_joined", time: "1952-01-01", name: "Poland", code: "POL" },
  ],
  messages: [extraMessage],
});

test("a refusal survives a thread that keeps an event log", () => {
  const [chat] = normalizeChats([loggedThread({
    id: "m1",
    role: "leader",
    speaker: "Poland",
    text: "Warsaw will not send divisions east.",
    time: "1952-03-04",
    refusedOverlord: "USSR",
    refusedPuppet: "Poland",
  })]);
  assert.ok(Array.isArray(chat.events) && chat.events.length > 0, "the thread really is logged");
  const message = chat.messages.find((entry) => entry.text.startsWith("Warsaw"));
  assert.equal(message.refusedOverlord, "USSR");
  assert.equal(message.refusedPuppet, "Poland");
});

test("the charge stamp survives a logged thread too, or a retried jump re-charges", () => {
  const once = normalizeChats([loggedThread({
    id: "m1",
    role: "leader",
    speaker: "Poland",
    text: "No.",
    time: "1952-03-04",
    refusedOverlord: "USSR",
    refusedPuppet: "Poland",
    refusalChargedRound: 7,
  })]);
  // Read back what was written, the way the next load does.
  const [again] = normalizeChats(once);
  const message = again.messages.find((entry) => entry.text === "No.");
  assert.equal(message.refusalChargedRound, 7);
});

// The turn's own flow, which the fixtures above only approximate: the refusal is
// ALREADY in the thread's log when the jump charges it. Stamping the projected
// message alone is not enough there — on save the log's unstamped copy wins, the
// projection is rebuilt from it, and the next jump charges the same refusal again.

test("charging a logged refusal stamps it for good, and it is never charged twice", () => {
  const [logged] = normalizeChats([loggedThread({
    id: "m1", role: "leader", speaker: "Poland", text: "No.", time: "1952-03-04",
    refusedOverlord: "USSR", refusedPuppet: "Poland",
  })]);

  const first = chargeRefusals([logged], 5);
  assert.deepEqual(first.refusedDemands, [{ overlord: "USSR", puppet: "Poland" }]);

  // Saved and loaded, as the next jump would find it.
  const reloaded = normalizeChats(first.chats);
  const second = chargeRefusals(reloaded, 6);
  assert.deepEqual(second.refusedDemands, [], "already charged in round 5");
  assert.equal(reloaded[0].messages.find((entry) => entry.text === "No.").refusalChargedRound, 5);
});

test("an uncharged refusal in an unlogged thread is charged too", () => {
  const { refusedDemands } = chargeRefusals(normalizeChats(chatWith({
    role: "leader", speaker: "Poland", text: "No.", time: "1952-03-04",
    refusedOverlord: "USSR", refusedPuppet: "Poland",
  })), 5);
  assert.deepEqual(refusedDemands, [{ overlord: "USSR", puppet: "Poland" }]);
});

test("charging does not touch the chats it was given", () => {
  const chats = normalizeChats([loggedThread({
    id: "m1", role: "leader", speaker: "Poland", text: "No.", time: "1952-03-04",
    refusedOverlord: "USSR", refusedPuppet: "Poland",
  })]);
  const before = JSON.stringify(chats);
  chargeRefusals(chats, 5);
  assert.equal(JSON.stringify(chats), before);
});
