/*! Open Historia — Scenario Hub (community tab) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A non-interactive, whole-world preview of a scenario's map for the community
// hub's detail view. This is NOT a hand-rolled approximation of the label
// system — it is the live game's own map pipeline, run once against static
// scenario data instead of a running game:
//   1. derivePolitySurfaces  (Game/Map/vnext/politySurfaces.js)  — the same
//      polygon-union dissolve the live political layer runs, one shape per owner.
//   2. buildPolityLabelCollections (Game/Map/vnext/polityLabels.js) — the live
//      map's own label-geometry solver (core-landmass selection, real area-based
//      priority, anchor placement).
//   3. buildPolityTextPtr1Records (Game/Map/labels/polityTextRecords.js) + the
//      actual <PolityTextLayer> — the live game's real WebGL text renderer
//      (rasterized system fonts, halo, collision-aware placement), mounted on a
//      plain, interaction-disabled MapLibre map instead of the game's own.
// All three are pure/self-contained — built to run inside a worker with no
// MapLibre/DOM/live-game binding — so they work standing alone just as well.
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { loadRegionLabelGeometry } from "../../runtime/countryLabels.js";
import { PMTILES_ARCHIVES, decodeVectorTile, getPmtilesArchive, resolveCountryDisplayName } from "../../runtime/assets.js";
import { foldOwnerTokens } from "../Map/useWorldState.js";
import { buildPolityLabelNames, createOwnerRgbResolver, normalizePoliticalRgb } from "../Map/polityColors.js";
import { derivePolitySurfaces } from "../Map/vnext/politySurfaces.js";
import { buildPolityLabelCollections } from "../Map/vnext/polityLabels.js";
import { buildPolityTextPtr1Records } from "../Map/labels/polityTextRecords.js";
import PolityTextLayer from "../Map/labels/PolityTextLayer.jsx";
import { POLITY_TEXT_RENDERER_LAYER_ID } from "../Map/labels/polityTextCustomLayer.js";
import { loadNatGeoDarkStyle } from "../Map/natGeoDarkStyle.js";

// Same small, bordered-card look as the hub's own ScenarioCard tiles
// (cardSurface in communityHub.jsx) — reused here rather than inventing a new
// frame style, so the preview reads as part of the same design instead of a
// bolted-on widget. Exported so the loading/error placeholders in
// communityHub.jsx match it exactly instead of jumping in size once ready.
export const PREVIEW_FRAME_STYLE = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "16px",
  overflow: "hidden",
  padding: "0.9rem",
  width: "80%",
};
export const PREVIEW_ASPECT_RATIO = "2 / 1";

// The live map's own default label typography (Nations.jsx's labelFontStack /
// textColor / haloColor with no scenario or player override) — reused as-is,
// not reinvented, so the preview's type matches what a game actually shows.
const LABEL_FONT_STACK = ["Georgia", "Times New Roman", "Palatino Linotype", "serif"];
const LABEL_TEXT_COLOR = "rgba(250, 249, 244, 0.995)";
const LABEL_HALO_COLOR = "rgba(4, 6, 9, 0.96)";

const FILL_SOURCE_ID = "scenario-preview-fills";
const FILL_LAYER_ID = "scenario-preview-fill";
const OUTLINE_LAYER_ID = "scenario-preview-outline";

const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0f0f11" } }],
};

const WORLD_BOUNDS = [[-180, -80], [180, 80]];

// A region's `owner` may arrive as a resolved display name, a bare GADM code,
// or (for the stock z0 tile) a `country` field — derivePolitySurfaces only
// reads `properties.owner`, so normalize every region onto that before the
// dissolve, or an authored scenario whose regions only carry `gid0` would
// silently drop every one of its regions from the map.
const normalizeRegionOwners = (collection) => ({
  type: "FeatureCollection",
  features: (collection?.features ?? []).map((feature) => ({
    ...feature,
    properties: {
      ...feature?.properties,
      owner: feature?.properties?.owner || feature?.properties?.gid0 || feature?.properties?.country || "",
    },
  })),
});

// loadRegionLabelGeometry (countryLabels.js) reads a single z0/0/0 tile — the
// whole world in one go, but at the coarsest resolution the regions archive
// has, which is why zooming in on it never reveals finer coastline/border
// detail: there IS no finer detail in that one tile, so the same coarse
// shapes just scale up. This reads a higher, still whole-world zoom tier of
// the SAME archive (many tiles instead of one) for a real resolution step-up,
// applied once the fast z0 pass is already on screen — the "coarse first,
// then refines" behaviour, done as a one-time quality upgrade rather than a
// continuous per-zoom refetch (that needs the live game's own incremental
// per-region worker state to avoid regions vanishing between tiles, which is
// a materially bigger change than this preview warrants).
const REFINED_REGION_ZOOM = 3; // 8x8 = 64 tiles world-wide; still a bounded, one-time fetch

// One retry per tile: 64 requests fired at once occasionally drops one to a
// transient network hiccup, and a silently-dropped tile is a whole tile-sized
// rectangle of land that just vanishes from the map — the "big coherent
// unoccupied part" failure mode, as opposed to the tile-seam one above.
const fetchTileWithRetry = async (pmtiles, z, x, y) => {
  try {
    return await pmtiles.getZxy(z, x, y);
  } catch {
    try {
      return await pmtiles.getZxy(z, x, y);
    } catch (error) {
      console.warn(`Scenario map preview: tile ${z}/${x}/${y} failed twice; that patch of the map will be blank:`, error);
      return null;
    }
  }
};

const loadRefinedStockRegions = async () => {
  const pmtiles = getPmtilesArchive(PMTILES_ARCHIVES.regions);
  const span = 2 ** REFINED_REGION_ZOOM;
  const coords = [];
  for (let x = 0; x < span; x += 1) {
    for (let y = 0; y < span; y += 1) coords.push([x, y]);
  }
  const tiles = await Promise.all(
    coords.map(([x, y]) => fetchTileWithRetry(pmtiles, REFINED_REGION_ZOOM, x, y)),
  );

  const features = [];
  for (let index = 0; index < tiles.length; index += 1) {
    const tileData = tiles[index];
    if (!tileData?.data) continue;
    const [x, y] = coords[index];
    const tile = await decodeVectorTile(tileData.data);
    const layer = tile.layers.regions;
    if (!layer) continue;
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
      const feature = layer.feature(featureIndex);
      const props = feature.properties ?? {};
      // A region whose polygon crosses a tile boundary is CLIPPED per tile —
      // each tile holds only the fragment of it that falls inside that tile,
      // not a duplicate of the whole thing. Keeping only the "first" tile's
      // copy (as this used to) throws away every other fragment, which is
      // exactly "unoccupied land cutting through the middle of a country" at
      // tile seams. Every fragment is kept here and pushed through as its own
      // feature; derivePolitySurfaces unions all of one owner's polygons
      // together regardless of how many pieces they arrive in, so the region
      // ends up whole again downstream.
      const id = props.GID_1 || props.gid_1 || props.HASC_1 || props.fid;
      if (!id) continue;
      // VectorTileFeature#toGeoJSON is (x, y, z) — NOT (z, x, y). Swapping
      // those args is exactly what scattered every tile's geometry away from
      // where it actually belongs.
      const geojson = feature.toGeoJSON(x, y, REFINED_REGION_ZOOM);
      if (!geojson?.geometry) continue;
      // Resolve the display name from the GADM code when the tile carries no
      // country property, exactly as loadRegionLabelGeometry does — otherwise
      // those regions arrive owner-less and paint as unclaimed grey.
      const gid0 = String(props.GID_0 || props.gid_0 || "");
      const country = resolveCountryDisplayName(props.COUNTRY || props.Country || props.country, gid0);
      features.push({
        type: "Feature",
        geometry: geojson.geometry,
        properties: { id: String(id), gid0, country, owner: country },
      });
    }
  }
  return { type: "FeatureCollection", features };
};

// Dissolve solves + a pure-function label geometry pass — normally fast on the
// coarse stock tile, but a large authored scenario or network trouble must
// never leave the skeleton spinning forever.
const BUILD_TIMEOUT_MS = 10000;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms)),
]);

const SkeletonBlock = () => (
  <div
    style={{
      background: "#16161a",
      borderRadius: "10px",
      height: "100%",
      inset: 0,
      overflow: "hidden",
      position: "absolute",
    }}
  >
    <div
      style={{
        animation: "scenarioMapPreviewShimmer 1.4s ease-in-out infinite",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
        inset: 0,
        position: "absolute",
      }}
    />
  </div>
);

const ScenarioMapPreview = ({ regionsGeojson, ownerOverrides = null, polityOverrides = null, colors = null }) => {
  const containerRef = useRef(null);
  // The map instance lives in state (not a ref) so it can be passed to
  // <PolityTextLayer> and read during render without touching a ref's
  // `.current` outside an effect/handler.
  const [mapInstance, setMapInstance] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  // "loading" | "ready" | "error" — error covers a failed/timed-out build, an
  // empty dissolve, and the label layer itself reporting a mount failure.
  const [status, setStatus] = useState("loading");
  const [scene, setScene] = useState(null); // { fillCollection, records }

  // The map instance itself: created once, on the SAME dark basemap the live
  // game renders (loadNatGeoDarkStyle — a pure, stateless style fetch/build,
  // unlike the live map's own World/Nations components, which read a single
  // global active-game store and can't safely run twice at once). Pan/zoom
  // are on (scroll, pinch, drag, double-click) so the picture can be
  // explored; rotate/pitch stay off — it's a flat map preview.
  useEffect(() => {
    let cancelled = false;
    let map = null;

    loadNatGeoDarkStyle()
      .catch((styleError) => {
        console.error("Scenario map preview: failed to load the basemap style; using a plain background:", styleError);
        return FALLBACK_STYLE;
      })
      .then((style) => {
        if (cancelled) return;
        map = new maplibregl.Map({
          attributionControl: false,
          bounds: WORLD_BOUNDS,
          container: containerRef.current,
          dragRotate: false,
          fadeDuration: 0,
          pitchWithRotate: false,
          // A small, always-zoomed-out preview otherwise tiles the whole
          // world 2-3x side by side instead of showing it once.
          renderWorldCopies: false,
          style,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        setMapInstance(map);
        map.on("load", () => { if (!cancelled) setMapReady(true); });
      });

    return () => {
      cancelled = true;
      map?.remove();
      setMapInstance(null);
      setMapReady(false);
    };
  }, []);

  // Build the scene: dissolved per-owner shapes (for fill colour) and the live
  // renderer's flat PTR label records (for text).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setScene(null);

    // These scenarios are artificial, not the real world: a polity is keyed by
    // a stable token while the registry gives it whatever name the author
    // wants. Fold every owner onto its token first (the same fold the live map
    // store applies), or "Germany" and "German Reich" both own ground and the
    // map paints — and labels — them as two separate countries.
    const folded = foldOwnerTokens({
      regionOwnershipOverrides: ownerOverrides ?? {},
      polityOverrides: polityOverrides ?? {},
    });
    const resolveRgb = createOwnerRgbResolver({
      colorMap: colors ?? {},
      polityOverrides: polityOverrides ?? {},
    });

    // Pure: geometry in, {fillCollection, records} out — or null if there's
    // nothing usable. Never touches status/scene itself, so it's safe to call
    // twice (the fast pass, then the background resolution upgrade below).
    const buildScene = (regionsCollection) => {
      if (!regionsCollection?.features?.length) return null;
      const surfaces = derivePolitySurfaces(normalizeRegionOwners(regionsCollection), folded.overrides);
      if (!surfaces.data.features.length) return null;

      // One label per polity, from the scenario's own registry — so the merged
      // polity prints "German Reich" once rather than its token twice.
      const labelNames = buildPolityLabelNames({
        owners: surfaces.data.features.map((feature) => feature?.properties?.owner),
        polityOverrides: polityOverrides ?? {},
        resolveDisplayName: (raw, owner) => resolveCountryDisplayName(raw, owner),
      });
      const collections = buildPolityLabelCollections(surfaces.data, {
        nameResolver: (owner) => labelNames[owner] ?? owner,
      });
      const records = buildPolityTextPtr1Records({
        ptrLabelData: collections.ptrLabelData,
        labelData: collections.labelData,
      });

      const fillCollection = {
        type: "FeatureCollection",
        features: surfaces.data.features.map((feature) => {
          // The live map's own resolution chain: colors.json, then the polity
          // registry's authored colour, then a folded-key match, then the
          // procedural fallback — never a flat "unclaimed" grey for a polity
          // that simply isn't in colors.json.
          const rgb = normalizePoliticalRgb(resolveRgb(feature.properties?.owner));
          return {
            ...feature,
            properties: {
              ...feature.properties,
              fillColor: Array.isArray(rgb) ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "rgba(66,66,70,0.35)",
            },
          };
        }),
      };
      return { fillCollection, records };
    };

    const isCustomGeometry = Boolean(regionsGeojson?.features?.length);
    const regionsPromise = isCustomGeometry
      ? Promise.resolve(regionsGeojson)
      // No custom geometry — fall back to the stock world's coarse z0 tile
      // for an instant first paint (same small cached fetch the in-game
      // country picker uses), then upgrade to a properly detailed pass below.
      : loadRegionLabelGeometry();

    withTimeout(regionsPromise, BUILD_TIMEOUT_MS)
      .then((collection) => {
        if (cancelled) return;
        try {
          const built = buildScene(collection);
          if (!built) {
            setStatus("error");
            return;
          }
          setScene(built);
        } catch (buildError) {
          console.error("Scenario map preview: failed to build the map:", buildError);
          setStatus("error");
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error("Scenario map preview: failed to load region geometry:", loadError);
        setStatus("error");
      });

    // The resolution upgrade: silently skipped on any failure — the coarse
    // pass above is already on screen, so this is strictly a nicety.
    if (!isCustomGeometry) {
      loadRefinedStockRegions()
        .then((refined) => {
          if (cancelled) return;
          const built = buildScene(refined);
          if (built) setScene(built);
        })
        .catch((refineError) => {
          console.error("Scenario map preview: resolution upgrade skipped:", refineError);
        });
    }

    return () => { cancelled = true; };
  }, [regionsGeojson, ownerOverrides, polityOverrides, colors]);

  // Wire the dissolved-shape fill layer once the map style and the scene data
  // are both ready.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !mapReady || !scene) return;
    const existingSource = map.getSource(FILL_SOURCE_ID);
    if (existingSource) {
      existingSource.setData(scene.fillCollection);
      return;
    }
    map.addSource(FILL_SOURCE_ID, { type: "geojson", data: scene.fillCollection });
    map.addLayer({
      id: FILL_LAYER_ID,
      type: "fill",
      source: FILL_SOURCE_ID,
      // Translucent, same as the live political layer over its basemap — an
      // opaque fill would just paint over the relief/terrain underneath.
      paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.62 },
    });
    map.addLayer({
      id: OUTLINE_LAYER_ID,
      type: "line",
      source: FILL_SOURCE_ID,
      paint: { "line-color": "rgba(255,255,255,0.32)", "line-width": 0.5 },
    });

    // Click a country to see its name, styled like the live game's own
    // selection popup (Selection/Regions.jsx's RegionPopup: dark blurred
    // card, rounded corners, the same border/shadow) — a look, not an
    // action: no flag, no controller/territory panel, no orders.
    const popup = new maplibregl.Popup({
      className: "scenario-preview-popup",
      closeButton: false,
      closeOnClick: true,
      maxWidth: "220px",
    });
    const onClick = (event) => {
      const owner = event.features?.[0]?.properties?.owner;
      if (!owner) return;
      const label = document.createElement("div");
      label.textContent = owner;
      popup.setLngLat(event.lngLat).setDOMContent(label).addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", FILL_LAYER_ID, onClick);
    map.on("mouseenter", FILL_LAYER_ID, onEnter);
    map.on("mouseleave", FILL_LAYER_ID, onLeave);
  }, [mapInstance, mapReady, scene]);

  // The live text renderer reports its own mount lifecycle; "mounted" fires
  // once its fast placement pass has painted (the slower background optimizer
  // refines the same labels in place afterward, invisibly) — that's the "few
  // seconds, not longer" moment to reveal the picture, matching how quickly
  // the live map itself shows labels on a fresh scenario.
  const handleLabelStatusChange = (labelStatus) => {
    if (labelStatus.mounted) {
      // The label layer always belongs on top, regardless of which effect
      // (this one or the fill-wiring effect above) happened to run first.
      try { mapInstance?.moveLayer?.(POLITY_TEXT_RENDERER_LAYER_ID); } catch { /* layer not present yet */ }
      setStatus("ready");
    } else if (labelStatus.failed) {
      setStatus("error");
    }
  };

  return (
    <div style={PREVIEW_FRAME_STYLE}>
      <style>{`
        @keyframes scenarioMapPreviewShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .scenario-preview-popup .maplibregl-popup-content {
          background: rgba(24, 24, 27, 0.95);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
          color: #fff;
          font-family: sans-serif;
          font-size: 13px;
          font-weight: 700;
          padding: 8px 12px;
        }
        .scenario-preview-popup .maplibregl-popup-tip { display: none; }
      `}</style>
      <div style={{ aspectRatio: PREVIEW_ASPECT_RATIO, position: "relative", width: "100%" }}>
        {status === "loading" && <SkeletonBlock />}
        {status === "error" && (
          <div
            style={{
              alignItems: "center",
              background: "#16161a",
              borderRadius: "10px",
              color: "rgba(255,255,255,0.4)",
              display: "flex",
              fontSize: "0.75rem",
              inset: 0,
              justifyContent: "center",
              position: "absolute",
              textAlign: "center",
              padding: "0 0.5rem",
            }}
          >
            No map preview available.
          </div>
        )}
        <div
          ref={containerRef}
          style={{
            background: "#0f0f11",
            borderRadius: "10px",
            height: "100%",
            inset: 0,
            opacity: status === "ready" ? 1 : 0,
            overflow: "hidden",
            position: "absolute",
            transition: "opacity 0.2s ease",
            width: "100%",
          }}
        />
        {scene && mapInstance && (
          <PolityTextLayer
            map={mapInstance}
            enabled
            mode="ptr1"
            records={scene.records}
            fontFamilies={LABEL_FONT_STACK}
            textColor={LABEL_TEXT_COLOR}
            haloColor={LABEL_HALO_COLOR}
            debugBaseline={false}
            onStatusChange={handleLabelStatusChange}
          />
        )}
      </div>
    </div>
  );
};

export default ScenarioMapPreview;
