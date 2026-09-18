/*! Open Historia — refusal round-trip tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatRefusalPersistence.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { chargeRefusals, normalizeChats, normalizeWorldState } from "./gameState.js";

// The one deterministic Loyalty rule reads refusals back off the SAVED
// transcript a turn later, so the refusal has to survive every way a chat is
// written and read. It has died three ways already: normalizeChatMessage
// dropping the field, the thread log dropping it, and a "charged" stamp on the
// message being erased by a chat panel saving its older copy. These pin all three.

const chatWith = (message) => [{
  id: "c1",
  countries: [{ code: "POL", name: "Poland" }],
  messages: [message],
}];

// Threads grew an EVENT LOG on beta (chatThreads.js). A logged thread has its
// messages rebuilt from the log's projection, which carries only the fields it
// lists — the path the unlogged fixture above never exercises.
const loggedThread = (extraMessage) => ({
  id: "t1",
  countries: [{ code: "POL", name: "Poland" }],
  events: [
    { id: "t1-created", kind: "chat_created", time: "1952-01-01", title: "Warsaw and Moscow" },
    { id: "t1-join", kind: "member_joined", time: "1952-01-01", name: "Poland", code: "POL" },
  ],
  messages: [extraMessage],
});

const refusal = (extra = {}) => ({
  id: "m1",
  role: "leader",
  speaker: "Poland",
  text: "Warsaw will not send divisions east.",
  time: "1952-03-04",
  refusedOverlord: "USSR",
  refusedPuppet: "Poland",
  ...extra,
});

test("a refusal survives being written and read back", () => {
  const [chat] = normalizeChats(chatWith(refusal()));
  assert.equal(chat.messages[0].refusedOverlord, "USSR");
  assert.equal(chat.messages[0].refusedPuppet, "Poland");
});

test("a refusal survives a thread that keeps an event log", () => {
  const [chat] = normalizeChats([loggedThread(refusal())]);
  assert.ok(Array.isArray(chat.events) && chat.events.length > 0, "the thread really is logged");
  const message = chat.messages.find((entry) => entry.text.startsWith("Warsaw"));
  assert.equal(message.refusedOverlord, "USSR");
  assert.equal(message.refusedPuppet, "Poland");
});

test("half a refusal is no refusal", () => {
  const [chat] = normalizeChats(chatWith(refusal({ refusedPuppet: "" })));
  assert.equal(chat.messages[0].refusedOverlord, "");
  assert.equal(chat.messages[0].refusedPuppet, "");
});

test("an ordinary message carries an empty refusal rather than none at all", () => {
  const [chat] = normalizeChats(chatWith({ role: "leader", speaker: "Poland", text: "We will consider it." }));
  assert.equal(chat.messages[0].refusedOverlord, "");
  assert.equal(chat.messages[0].refusedPuppet, "");
});

test("a message stored as a bare string has the same shape as any other", () => {
  const [chat] = normalizeChats(chatWith("A note from the archives."));
  assert.deepEqual(Object.keys(chat.messages[0]).sort(), Object.keys(
    normalizeChats(chatWith({ role: "leader", speaker: "Poland", text: "x" }))[0].messages[0],
  ).sort());
});

test("a refusal is charged once, however many times the turn runs", () => {
  const chats = normalizeChats([loggedThread(refusal())]);

  const first = chargeRefusals(chats, []);
  assert.deepEqual(first.refusedDemands, [{ overlord: "USSR", puppet: "Poland" }]);

  // A retried jump, or a reloaded save jumped again: same chats, same record.
  const second = chargeRefusals(chats, first.charged);
  assert.deepEqual(second.refusedDemands, [], "already charged");
  assert.deepEqual(second.charged, first.charged);
});

test("a stale chat panel saving over the transcript cannot un-charge a refusal", () => {
  // The reason the record is not on the message: the panel re-saves the copy it
  // holds, which never saw the charge. The record in the world is untouched.
  const charged = chargeRefusals(normalizeChats([loggedThread(refusal())]), []).charged;
  const panelSavesItsOldCopy = normalizeChats([loggedThread(refusal())]);
  assert.deepEqual(chargeRefusals(panelSavesItsOldCopy, charged).refusedDemands, []);
});

test("the charge record survives the world's round trip, and is capped", () => {
  const world = normalizeWorldState({ chargedRefusals: ["m1", "m2", "m1", "", null] });
  assert.deepEqual(world.chargedRefusals, ["m1", "m2"]);

  const many = Array.from({ length: 600 }, (_, index) => `m${index}`);
  const capped = normalizeWorldState({ chargedRefusals: many }).chargedRefusals;
  assert.equal(capped.length, 512);
  assert.equal(capped.at(-1), "m599", "the most recent are the ones kept");
});

test("charging does not touch the chats it was given", () => {
  const chats = normalizeChats([loggedThread(refusal())]);
  const before = JSON.stringify(chats);
  chargeRefusals(chats, []);
  assert.equal(JSON.stringify(chats), before);
});

test("an unlogged thread's refusal is charged too", () => {
  assert.deepEqual(chargeRefusals(normalizeChats(chatWith(refusal())), []).refusedDemands,
    [{ overlord: "USSR", puppet: "Poland" }]);
});
