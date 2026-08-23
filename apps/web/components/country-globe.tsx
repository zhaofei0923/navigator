"use client";

import {
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MeshPhongMaterial } from "three";
import type { GlobeMarker } from "@/lib/types";

type CountryGlobeProps = {
  markers: GlobeMarker[];
  selectedCode: string;
  locale: "zh-CN" | "en";
  onSelect: (code: string) => void;
  onOpenCountry?: (code: string) => void;
  height?: number;
};

type WorldCountryFeature = {
  type: "Feature";
  properties: {
    code: string;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

type WorldCountryCollection = {
  type: "FeatureCollection";
  features: WorldCountryFeature[];
};

const WORLD_MAP_PATH = "/data/world-countries-110m.geojson";
const MIN_ALTITUDE = 0.55;
const MAX_ALTITUDE = 2.7;
const DEFAULT_ALTITUDE = 1.72;

function canRenderWebGL(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function countryCode(country: WorldCountryFeature) {
  return country.properties.code;
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

class GlobeErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function CountryGlobe({
  markers,
  selectedCode,
  locale,
  onSelect,
  onOpenCountry,
  height = 430,
}: CountryGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pointerInsideRef = useRef(false);
  const [width, setWidth] = useState(640);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  const [webglAvailable] = useState(canRenderWebGL);
  const [worldCountries, setWorldCountries] = useState<WorldCountryFeature[]>([]);
  const [worldMapFailed, setWorldMapFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const material = useMemo(
    () =>
      new MeshPhongMaterial({
        color: "#071f3d",
        emissive: "#03152b",
        shininess: 16,
        transparent: true,
        opacity: 0.99,
      }),
    [],
  );
  const marketByCode = useMemo(
    () => new Map(markers.map((marker) => [marker.code, marker])),
    [markers],
  );
  const selected = marketByCode.get(selectedCode) ?? markers[0];

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(WORLD_MAP_PATH, { cache: "force-cache", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`World map request failed: ${response.status}`);
        return response.json() as Promise<WorldCountryCollection>;
      })
      .then((collection) => {
        if (!Array.isArray(collection.features) || collection.features.length < 150) {
          throw new Error("World map feature collection is incomplete");
        }
        setWorldCountries(collection.features);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWorldMapFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    media.addEventListener("change", syncMotion);
    return () => media.removeEventListener("change", syncMotion);
  }, []);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = !reducedMotion && !pointerInsideRef.current;
  }, [reducedMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const dialog = containerRef.current;
    const previousOverflow = document.body.style.overflow;
    const syncViewportHeight = () => setViewportHeight(window.innerHeight);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    syncViewportHeight();
    requestAnimationFrame(() => expandButtonRef.current?.focus());
    window.addEventListener("resize", syncViewportHeight);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", syncViewportHeight);
      window.removeEventListener("keydown", closeOnEscape);
      previousFocusRef.current?.focus();
    };
  }, [expanded]);

  useEffect(() => {
    const marker = marketByCode.get(selectedCode);
    const globe = globeRef.current;
    if (!marker || !globe) return;
    const current = globe.pointOfView();
    globe.pointOfView(
      {
        lat: marker.lat,
        lng: marker.lng,
        altitude: clamp(current.altitude || DEFAULT_ALTITUDE, MIN_ALTITUDE, MAX_ALTITUDE),
      },
      reducedMotion ? 0 : 700,
    );
  }, [marketByCode, reducedMotion, selectedCode]);

  const polygonColor = useCallback(
    (item: object) => {
      const code = countryCode(item as WorldCountryFeature);
      if (code === hoveredCode) return "rgba(76, 224, 211, 0.96)";
      if (code === selectedCode) return "rgba(246, 184, 77, 0.92)";
      if (marketByCode.has(code)) return "rgba(35, 174, 166, 0.86)";
      return "rgba(24, 72, 108, 0.88)";
    },
    [hoveredCode, marketByCode, selectedCode],
  );

  const polygonStrokeColor = useCallback(
    (item: object) =>
      countryCode(item as WorldCountryFeature) === hoveredCode
        ? "rgba(222, 255, 251, 0.96)"
        : "rgba(151, 196, 218, 0.34)",
    [hoveredCode],
  );

  const polygonTooltip = useCallback(
    (item: object) => {
      const code = countryCode(item as WorldCountryFeature);
      const market = marketByCode.get(code);
      if (!market) return "";
      const status = locale === "en" ? "Synthetic demo market" : "合成演示市场";
      const readiness = locale === "en" ? "Readiness" : "进入准备度";
      return `<div class="globe-country-tooltip"><span>${escapeHtml(status)}</span><strong>${escapeHtml(market.name)}</strong><small>${escapeHtml(code)}</small><b>${escapeHtml(readiness)} ${escapeHtml(market.readiness)}/100</b><p>${escapeHtml(market.summary)}</p></div>`;
    },
    [locale, marketByCode],
  );

  function configureControls() {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.32;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.82;
    controls.enableDamping = true;
    controls.minDistance = 155;
    controls.maxDistance = 370;
    resetView(0);
  }

  function setRotation(paused: boolean) {
    pointerInsideRef.current = paused;
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = !paused && !reducedMotion;
  }

  function toggleExpanded() {
    if (!expanded && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setExpanded((value) => !value);
  }

  function zoomBy(delta: number) {
    const globe = globeRef.current;
    if (!globe) return;
    const current = globe.pointOfView();
    globe.pointOfView(
      {
        lat: current.lat,
        lng: current.lng,
        altitude: clamp(current.altitude + delta, MIN_ALTITUDE, MAX_ALTITUDE),
      },
      reducedMotion ? 0 : 280,
    );
  }

  function resetView(duration = reducedMotion ? 0 : 420) {
    const marker = selected ?? markers[0];
    globeRef.current?.pointOfView(
      marker
        ? { lat: marker.lat, lng: marker.lng, altitude: DEFAULT_ALTITUDE }
        : { lat: 18, lng: 18, altitude: DEFAULT_ALTITUDE },
      duration,
    );
  }

  function selectMarket(code: string) {
    onSelect(code);
    setHoveredCode(code);
  }

  const renderedHeight = expanded
    ? Math.max(420, viewportHeight - (width < 560 ? 20 : 48))
    : width < 560
      ? Math.min(height, 350)
      : height;
  const fallbackLabel =
    locale === "en"
      ? "The 3D map is unavailable. Use the market selector instead."
      : "当前设备无法显示三维地图，请改用演示市场选择器。";
  const fallback = (
    <div className="globe-fallback" role="status">
      <strong>{locale === "en" ? "Accessible market explorer" : "无障碍市场浏览"}</strong>
      <p>{fallbackLabel}</p>
      <label>
        <span>{locale === "en" ? "Demo market" : "演示市场"}</span>
        <select value={selectedCode} onChange={(event) => selectMarket(event.target.value)}>
          {markers.map((marker) => (
            <option value={marker.code} key={marker.code}>
              {marker.name}
            </option>
          ))}
        </select>
      </label>
      {selected && onOpenCountry ? (
        <button type="button" onClick={() => onOpenCountry(selected.code)}>
          {locale === "en" ? "Open market profile" : "进入国家详情"}
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      className={expanded ? "country-globe is-expanded" : "country-globe"}
      ref={containerRef}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? "true" : undefined}
      aria-label={
        expanded ? (locale === "en" ? "Expanded world map" : "放大的世界地图") : undefined
      }
    >
      <div
        className="country-globe-stage"
        style={{ height: renderedHeight }}
        onPointerEnter={() => setRotation(true)}
        onPointerLeave={() => {
          setRotation(false);
          setHoveredCode(null);
        }}
      >
        {webglAvailable && worldCountries.length ? (
          <div className="country-globe-canvas">
            <GlobeErrorBoundary
              resetKey={`${locale}:${worldCountries.length}:${markers.map((item) => item.code).join(",")}`}
              fallback={fallback}
            >
              <Globe
                ref={globeRef}
                width={width}
                height={renderedHeight}
                backgroundColor="rgba(0,0,0,0)"
                globeMaterial={material}
                showAtmosphere
                atmosphereColor="#31c8c0"
                atmosphereAltitude={0.17}
                showGraticules
                polygonsData={worldCountries}
                polygonGeoJsonGeometry="geometry"
                polygonAltitude={0.006}
                polygonCapColor={polygonColor}
                polygonSideColor={() => "rgba(3, 19, 39, 0.3)"}
                polygonStrokeColor={polygonStrokeColor}
                polygonCapCurvatureResolution={4}
                polygonsTransitionDuration={reducedMotion ? 0 : 120}
                polygonLabel={polygonTooltip}
                onPolygonHover={(item) =>
                  setHoveredCode(item ? countryCode(item as WorldCountryFeature) : null)
                }
                onPolygonClick={(item) => {
                  const code = countryCode(item as WorldCountryFeature);
                  if (marketByCode.has(code)) selectMarket(code);
                }}
                showPointerCursor={(layer) => layer === "polygon"}
                onGlobeReady={configureControls}
              />
            </GlobeErrorBoundary>
          </div>
        ) : webglAvailable === false || worldMapFailed ? (
          fallback
        ) : (
          <div className="globe-fallback" role="status">
            <p>{locale === "en" ? "Preparing the world map…" : "正在准备世界地图…"}</p>
          </div>
        )}

        {webglAvailable && worldCountries.length ? (
          <>
            <div
              className="globe-toolbar"
              aria-label={locale === "en" ? "Map controls" : "地图控制"}
            >
              <button
                type="button"
                onClick={() => zoomBy(-0.32)}
                aria-label={locale === "en" ? "Zoom in" : "放大地图"}
                title={locale === "en" ? "Zoom in" : "放大地图"}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy(0.32)}
                aria-label={locale === "en" ? "Zoom out" : "缩小地图"}
                title={locale === "en" ? "Zoom out" : "缩小地图"}
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => resetView()}
                aria-label={locale === "en" ? "Reset map view" : "重置地图视角"}
                title={locale === "en" ? "Reset map view" : "重置地图视角"}
              >
                <RotateCcw size={17} aria-hidden="true" />
              </button>
              <button
                ref={expandButtonRef}
                type="button"
                aria-pressed={expanded}
                onClick={toggleExpanded}
                aria-label={
                  expanded
                    ? locale === "en"
                      ? "Exit expanded map"
                      : "退出放大地图"
                    : locale === "en"
                      ? "Expand world map"
                      : "放大世界地图"
                }
                title={
                  expanded
                    ? locale === "en"
                      ? "Exit expanded map"
                      : "退出放大地图"
                    : locale === "en"
                      ? "Expand world map"
                      : "放大世界地图"
                }
              >
                {expanded ? (
                  <Minimize2 size={18} aria-hidden="true" />
                ) : (
                  <Maximize2 size={18} aria-hidden="true" />
                )}
              </button>
            </div>

            <label className="globe-market-selector">
              <span>{locale === "en" ? "Locate demo market" : "定位演示市场"}</span>
              <select value={selectedCode} onChange={(event) => selectMarket(event.target.value)}>
                {markers.map((marker) => (
                  <option value={marker.code} key={marker.code}>
                    {marker.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}
