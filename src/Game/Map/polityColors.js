/*! Open Historia — polity colour resolution © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// How a polity's fill colour is decided, in one place. Extracted from
// Nations.jsx so the live map and the community hub's scenario preview cannot
// drift apart: a scenario that paints "British Empire" from its polity
// registry rather than colors.json must look the same in both.
import { toCountryName } from "../../runtime/ownerNames.js";

// NOTE this is the JS twin of buildFallbackColorExpression in Nations.jsx,
// which reads GID_0 off the stock tiles and must keep hashing the CODE — tile
// properties are baked GADM and never become names.
export const fallbackRgbFromOwner = (owner = "") => {
  const normalized = String(owner ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length < 3) {
    return [96, 96, 96];
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[2]));
  return [64 + a * 5, 64 + c * 5, 64 + b * 5];
};

// "#c0507a" / "#c07" / "rgb(192, 80, 122)" -> [r,g,b]; null when unparseable.
// world.polityOverrides stores colours as CSS strings while colors.json stores
// RGB triplets, so the two namespaces need a bridge before they can be merged.
export const parseColorToRgb = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(`${hex[0]}${hex[0]}`, 16),
      parseInt(`${hex[1]}${hex[1]}`, 16),
      parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])].map((c) => Math.max(0, Math.min(255, c)));
};

// Display-only palette shaping. Scenario/save colours remain canonical; the map
// merely reins in extreme saturation/lightness so neighbouring polities read as
// one designed atlas rather than unrelated UI swatches.
export const normalizePoliticalRgb = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length !== 3) return rgb;
  let [r, g, b] = rgb.map((value) => Math.max(0, Math.min(255, Number(value) || 0)));

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  // Release-map pass: preserve authored identity but give ordinary polity fills
  // enough chroma to survive the translucent physical basemap. The previous
  // atlas normalizer always pulled colors toward grey, which combined with the
  // low regional fill opacity to make neighboring countries look washed out.
  const saturationBoost = chroma < 18 ? 0.05 : chroma < 150 ? 0.18 : 0.09;
  r = luminance + (r - luminance) * (1 + saturationBoost);
  g = luminance + (g - luminance) * (1 + saturationBoost);
  b = luminance + (b - luminance) * (1 + saturationBoost);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 510;

  if (lightness < 0.30) {
    const mix = Math.min(0.22, (0.30 - lightness) * 0.7);
    r += (255 - r) * mix;
    g += (255 - g) * mix;
    b += (255 - b) * mix;
  } else if (lightness > 0.64) {
    const mix = Math.min(0.18, (lightness - 0.64) * 0.75);
    r *= 1 - mix;
    g *= 1 - mix;
    b *= 1 - mix;
  }

  return [r, g, b].map((value) => Math.round(Math.max(0, Math.min(255, value))));
};

// Case/diacritic/punctuation-folded owner key, so "Côte d'Ivoire", "cote divoire"
// and "COTE D'IVOIRE" all reach the same palette entry.
export const ownerFoldKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// A polity can be correctly NAMED by the registry while colors.json has no key
// for it — shipped example: "British Empire" owns 426 regions in
// world-war-ii-1939-copy with its colour (#c0507a) only in polityOverrides.
// Resolving the name but not the colour painted those regions a muddy
// procedural fallback, which reads to a player as "the map didn't annex it".
export const createOwnerRgbResolver = ({ colorMap = {}, polityOverrides = {} } = {}) => (rawOwner) => {
  if (!rawOwner) return null;
  // Canonicalize an owner CODE ("ESP" from a transfer override) to the NAME the palette
  // is keyed by ("Spain") so a captured region takes its true owner's colour.
  const owner = toCountryName(rawOwner);
  const exact = colorMap[owner];
  if (exact) return exact;
  const registry = parseColorToRgb(polityOverrides?.[owner]?.color);
  if (registry) return registry;
  const fold = ownerFoldKey(owner);
  if (fold) {
    for (const [key, rgb] of Object.entries(colorMap)) {
      if (ownerFoldKey(key) === fold) return rgb;
    }
    for (const [key, entry] of Object.entries(polityOverrides ?? {})) {
      const names = [key, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])];
      if (!names.some((name) => ownerFoldKey(name) === fold)) continue;
      const rgb = parseColorToRgb(entry?.color);
      if (rgb) return rgb;
      const palette = colorMap[key];
      if (palette) return palette;
    }
  }
  return fallbackRgbFromOwner(owner);
};

// owner -> the display label the map prints for it. Mirrors Nations.jsx's
// workerLabelNames: the polity registry's authored map label wins, and two
// polities that would print the SAME label both fall back to their own stable
// identity so they stay distinguishable.
export const buildPolityLabelNames = ({ owners = [], polityOverrides = {}, resolveDisplayName = (name) => name } = {}) => {
  const canonicalOwner = (value) => toCountryName(String(value ?? "").trim());
  const ownerSet = new Set();
  for (const value of owners) {
    const owner = canonicalOwner(value);
    if (owner) ownerSet.add(owner);
  }

  const overrideByCanonical = new Map();
  for (const [rawOwner, entry] of Object.entries(polityOverrides ?? {})) {
    const owner = canonicalOwner(rawOwner);
    if (!owner) continue;
    ownerSet.add(owner);
    if (!overrideByCanonical.has(owner) || rawOwner === owner) overrideByCanonical.set(owner, entry ?? {});
  }

  const labels = new Map();
  for (const owner of ownerSet) {
    const override = overrideByCanonical.get(owner) ?? {};
    const raw = String(override.mapLabel || override.mapDistinctLabel || override.name || owner).trim();
    labels.set(owner, resolveDisplayName(raw, owner) || owner);
  }

  const counts = new Map();
  for (const label of labels.values()) {
    const key = ownerFoldKey(label);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [owner, label] of labels) {
    if ((counts.get(ownerFoldKey(label)) ?? 0) > 1) labels.set(owner, owner);
  }

  return Object.fromEntries(labels);
};
