/*! Open Historia — puppet visibility architecture tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/puppetVisibilityArchitecture.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// THE DRIFT GUARD. Four surfaces answer "is this country a Puppet, and what am
// I allowed to know about it": the country panel, the diplomacy markers, the map
// overlay and the advisor's prompt. Four callers deciding that separately is how
// the game ends up contradicting itself about the player's own empire — showing
// a satellite on the map that the panel denies, or briefing the advisor on a
// secret the player never discovered.
//
// So: nothing but runtime/puppets.js and the world normalizer may read
// world.puppets directly. This test is what keeps the fifth surface honest when
// somebody adds one later.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const SURFACES = [
    ["the country panel", "../Game/Selection/CountryPanel.jsx"],
    ["the diplomacy markers", "../Game/GameUI/chat.jsx"],
    ["the map overlay", "../Game/Map/Nations.jsx"],
    ["the advisor's world summary", "../Game/AI/promptContext.js"],
];

test("every player-facing surface asks the shared resolver", () => {
    for (const [label, path] of SURFACES) {
        assert.match(
            read(path),
            /from "\.{2}\/\.{2}\/runtime\/puppets\.js"/,
            `${label} must import the shared visibility rule`,
        );
    }
});

test("no player-facing surface reads world.puppets for itself", () => {
    for (const [label, path] of SURFACES) {
        assert.doesNotMatch(
            read(path),
            /\.puppets\b/,
            `${label} must go through visiblePuppetsFor / livePuppetsFor, never the raw ledger`,
        );
    }
});

test("the visibility rule stays import-free so it can be unit tested", () => {
    // Same convention, same reason, as chatVisibility.js and countryTags.js:
    // this decides what one government may know about another, and every module
    // that calls it reaches the whole browser runtime.
    assert.doesNotMatch(read("./puppets.js"), /^\s*import\s/m);
});

test("Loyalty never reaches a surface as a bare number", () => {
    // A visible score is the threshold players optimise against whether or not
    // the engine enforces one — and nothing in the engine does.
    assert.match(read("../Game/Selection/CountryPanel.jsx"), /loyaltyBand/);
    assert.doesNotMatch(read("../Game/Selection/CountryPanel.jsx"), /row\.loyalty\b(?!Band)/);
});

test("the advisor's puppet section is filtered by the player, not handed the world", () => {
    const source = read("../Game/AI/promptContext.js");
    assert.match(source, /livePuppetsFor\(world, bundle\.game\.country\)/);
});

test("the simulator and chat read the truth instead, from the canonical ledger context", () => {
    // The advisor is filtered; the jump and the chat task are NOT. A covert
    // Puppet talking to a third party has to know which way to lie.
    const director = read("../Game/AI/nativeDiplomaticDirector.js");
    assert.match(director, /SUBORDINATIONS \(who directs whom\)/);
    assert.doesNotMatch(director, /livePuppetsFor|visiblePuppetsFor/);
});
