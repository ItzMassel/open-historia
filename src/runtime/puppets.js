/*! Open Historia — puppets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A Puppet is a polity whose will is directed by an Overlord while it stays a
// separate country — it holds its own territory, keeps its own sovereignty and
// paints in its own colour. See the Glossary in docs/world-state.md, and
// docs/adr/0003-puppet-ledger-and-secrecy.md for why this is its own ledger.
//
// This module owns the one rule every surface must agree on: WHAT MAY THIS
// VIEWER SEE. The country panel, the diplomacy markers, the map overlay and the
// advisor's prompt all ask it, because four callers deciding separately is how
// the game ends up contradicting itself about the player's own empire — the
// same reason countryTags.js was extracted.
//
// DELIBERATELY IMPORT-FREE, like chatVisibility.js / countryTags.js: this
// decides what one government is allowed to know about another, and the modules
// that call it reach the whole browser runtime and cannot be unit-tested.
//
// TWO KINDS OF SECRET, and the difference is the whole design:
//
//   secrecy  — whether the arrangement EXISTS publicly. A protectorate is a
//              signed, published treaty; a bought government is not.
//   loyalty  — how far the Puppet actually accepts direction. Hidden from
//              everyone but the Overlord in EVERY case, open ones included, so
//              that an openly-known satellite still has something worth
//              spying on.
//
// And knowledge, once acquired, is never taken away: a polity that learned of a
// covert arrangement in 1948 goes on believing in it after it lapsed in 1953.
// That staleness is deliberate — it is what this feature has instead of letting
// a turned agent fabricate relationships outright (see the ADR).

export const PUPPET_KINDS = ["protectorate", "satellite", "client"];
export const PUPPET_SECRECIES = ["open", "covert"];
export const PUPPET_STATUSES = ["active", "released", "annexed", "revolted"];
export const MAX_PUPPETS = 64;

const str = (value) => String(value ?? "").trim();
const norm = (value) => str(value).toLocaleLowerCase();
const same = (left, right) => Boolean(norm(left)) && norm(left) === norm(right);

// A band, never a number. A visible score is the threshold players optimise
// against whether or not the engine enforces one, and nothing here does.
export const loyaltyBand = (loyalty) => {
  const value = Number(loyalty);
  if (!Number.isFinite(value)) return "Content";
  if (value >= 75) return "Loyal";
  if (value >= 50) return "Content";
  if (value >= 25) return "Restless";
  return "Seething";
};

// knownTo entries are { polity, learnedDate }; a bare string is accepted so a
// row written by hand (or by an older build) still grants sight, just without
// a date to show for it.
const knownEntry = (row, viewer) => {
  if (!Array.isArray(row?.knownTo)) return null;
  for (const entry of row.knownTo) {
    if (typeof entry === "string") {
      if (same(entry, viewer)) return { polity: str(entry), learnedDate: "" };
      continue;
    }
    if (same(entry?.polity, viewer)) {
      return { polity: str(entry.polity), learnedDate: str(entry.learnedDate) };
    }
  }
  return null;
};

const roleOf = (row, viewer) => {
  if (same(row?.overlord, viewer)) return "overlord";
  if (same(row?.puppet, viewer)) return "puppet";
  return "foreign";
};

// What one viewer may see of one row, or null if they may see nothing at all.
// Nothing means NOTHING: not a redacted row, not a disabled control. A greyed
// out entry would announce the existence of the secret it is keeping.
const viewOf = (row, viewer) => {
  const overlord = str(row?.overlord);
  const puppet = str(row?.puppet);
  if (!overlord || !puppet) return null;

  const role = roleOf(row, viewer);
  const covert = norm(row?.secrecy) === "covert";
  const learned = role === "foreign" && covert ? knownEntry(row, viewer) : null;
  if (role === "foreign" && covert && !learned) return null;

  const isOverlord = role === "overlord";
  const loyaltyNumber = Number(row?.loyalty);
  const loyalty = isOverlord && Number.isFinite(loyaltyNumber) ? Math.max(0, Math.min(100, Math.round(loyaltyNumber))) : null;

  // The believed state. A party to the arrangement knows what it did, and an
  // open arrangement ends in public — but a covert one learned through
  // intelligence goes on standing in the viewer's mind until fresh reporting
  // says otherwise, and nothing here tells them it has not.
  const trueStatus = PUPPET_STATUSES.includes(norm(row?.status)) ? norm(row.status) : "active";
  const status = learned ? "active" : trueStatus;

  return {
    id: str(row?.id),
    overlord,
    puppet,
    kind: PUPPET_KINDS.includes(norm(row?.kind)) ? norm(row.kind) : "client",
    secrecy: covert ? "covert" : "open",
    status,
    startedDate: str(row?.startedDate),
    endedDate: learned ? "" : str(row?.endedDate),
    role,
    loyalty,
    loyaltyBand: loyalty === null ? null : loyaltyBand(loyalty),
    fromIntelligence: Boolean(learned),
    asOf: learned ? learned.learnedDate : "",
  };
};

// Every subordination this viewer may see, live or finished, as they believe it
// to stand. Pass the polity's NAME — the same namespace as reputation,
// intelligence and country tags.
export const visiblePuppetsFor = (world, viewer) => {
  const rows = Array.isArray(world?.puppets) ? world.puppets : [];
  return rows.map((row) => viewOf(row, viewer)).filter(Boolean);
};

// Only the arrangements the viewer believes are still standing — which for a
// stale covert row is not the same thing as the arrangements that are.
export const livePuppetsFor = (world, viewer) =>
  visiblePuppetsFor(world, viewer).filter((row) => row.status === "active");

// The viewer's own sphere, and the Overlord over them, for the surfaces that
// only ever care about those two questions.
export const puppetsOf = (world, viewer) =>
  livePuppetsFor(world, viewer).filter((row) => row.role === "overlord");

export const overlordOf = (world, viewer) =>
  livePuppetsFor(world, viewer).find((row) => row.role === "puppet")?.overlord || "";
