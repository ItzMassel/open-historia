/*! Open Historia — Scenario Hub (community tab) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Shared by CountryPickerMap (the new-game/faction country picker) and
// ScenarioMapPreview (the community hub's zoomed-out preview): loading a
// scenario's region GeoJSON into OL features, painted with the scenario's
// actual ownership instead of the stock modern-day owners.
import GeoJSON from "ol/format/GeoJSON";
import { toCountryName } from "../../runtime/ownerNames.js";

export const codeToColor = (code) => {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 52%, 42%)`;
};

// Repaint stock geometry with the scenario's owners. A re-ownership scenario
// (Fallout, WWII, Rome — anything that reassigns real regions instead of drawing
// its own map) ships no geometry of its own, so this falls back to the modern
// Earth seed, whose features carry GADM owners: "DEU", "FRA", "GBR". Those match
// nothing in the scenario's playable set unless repainted with
// world.regionOwnershipOverrides, the same region-id -> owner lookup the game
// map resolves through.
export const applyOwnerOverrides = (features, overrides) => {
  if (!overrides) return features;
  for (const feature of features) {
    const id = feature.getId();
    if (id == null) continue;
    const owner = overrides[String(id)];
    // "" is a real value — an explicitly unclaimed region — so only skip undefined.
    if (owner !== undefined) feature.set("owner", owner);
  }
  return features;
};

// Geometry finer than this is invisible at a whole-world, never-zoomed-in view
// and only costs the draw.
export const PICKER_SIMPLIFY_TOLERANCE_M = 2000;

export const parseGeoJSONFeatures = (geojson, { stock = false } = {}) => {
  const fmt = new GeoJSON();
  const features = fmt.readFeatures(geojson, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
  for (const feature of features) {
    const props = feature.getProperties();
    if (props.id != null) feature.setId(String(props.id));
    // The stock tile carries the modern country as `owner`; resolve it from the
    // GADM code the way the seed did, so the playable set matches by name.
    if (stock) feature.set("owner", toCountryName(props.gid0) || props.owner || null);
    else if (feature.get("owner") == null) feature.set("owner", props.gid0 || props.owner || null);
    if (feature.get("typeId") == null) feature.set("typeId", "land");
    const geometry = feature.getGeometry();
    if (!stock && geometry?.simplify) feature.setGeometry(geometry.simplify(PICKER_SIMPLIFY_TOLERANCE_M));
  }
  return features;
};
