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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MeshPhongMaterial } from "three";

export type CountryGlobeMarker = Readonly<{
  code: string;
  name: string;
  lat?: number;
  lng?: number;
  summary?: string;
  readiness?: number;
  statusLabel?: string;
  detail?: string;
  metric?: Readonly<{ label: string; value: string }>;
}>;

type CountryGlobeProps = {
  markers: readonly CountryGlobeMarker[];
  selectedCode: string;
  // Omit for legacy selection-following behavior; "" keeps the current camera.
  focusCode?: string;
  locale: "zh-CN" | "en";
  onSelect: (code: string) => void;
  onOpenCountry?: (code: string) => void;
  height?: number;
  dataProfile?: "synthetic_demo" | "approved_basic60";
  showLocator?: boolean;
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
const DOUBLE_CLICK_WINDOW_MS = 500;
const CLICK_DISTANCE_PX = 8;

type PointerGesture = {
  pointerId: number;
  x: number;
  y: number;
  cancelled: boolean;
};

type CountryClick = {
  code: string;
  sequence: number;
  at: number;
  x: number;
  y: number;
};

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

function collectCoordinatePairs(value: unknown, output: [number, number][]) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    output.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectCoordinatePairs(item, output);
}

function geographicCenter(country: WorldCountryFeature): { lat: number; lng: number } | null {
  const coordinates: [number, number][] = [];
  collectCoordinatePairs(country.geometry.coordinates, coordinates);
  if (!coordinates.length) return null;

  let x = 0;
  let y = 0;
  let z = 0;
  for (const [longitude, latitude] of coordinates) {
    const latRadians = (latitude * Math.PI) / 180;
    const lngRadians = (longitude * Math.PI) / 180;
    x += Math.cos(latRadians) * Math.cos(lngRadians);
    y += Math.cos(latRadians) * Math.sin(lngRadians);
    z += Math.sin(latRadians);
  }
  const count = coordinates.length;
  x /= count;
  y /= count;
  z /= count;
  const longitude = Math.atan2(y, x);
  const hypotenuse = Math.sqrt(x * x + y * y);
  const latitude = Math.atan2(z, hypotenuse);
  return {
    lat: (latitude * 180) / Math.PI,
    lng: (longitude * 180) / Math.PI,
  };
}

function markerPosition(
  marker: CountryGlobeMarker,
  countryCenterByCode: ReadonlyMap<string, { lat: number; lng: number }>,
): { lat: number; lng: number } | null {
  if (
    typeof marker.lat === "number" &&
    Number.isFinite(marker.lat) &&
    typeof marker.lng === "number" &&
    Number.isFinite(marker.lng)
  ) {
    return { lat: marker.lat, lng: marker.lng };
  }
  return countryCenterByCode.get(marker.code) ?? null;
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
  focusCode,
  locale,
  onSelect,
  onOpenCountry,
  height = 430,
  dataProfile = "synthetic_demo",
  showLocator = true,
}: CountryGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pointerInsideRef = useRef(false);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const activePointersRef = useRef(new Set<number>());
  const clickGenerationRef = useRef(0);
  const pointerSequenceRef = useRef(0);
  const acceptedPointerClicksRef = useRef(new WeakMap<Event, { generation: number; sequence: number }>());
  const lastCountryClickRef = useRef<CountryClick | null>(null);
  const lastOpenedAtRef = useRef<number | null>(null);
  const cameraAnimationUntilRef = useRef(0);
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
  const countryCenterByCode = useMemo(
    () =>
      new Map(
        worldCountries.flatMap((country) => {
          const center = geographicCenter(country);
          return center ? ([[countryCode(country), center]] as const) : [];
        }),
      ),
    [worldCountries],
  );
  const selected = marketByCode.get(selectedCode);
  const cameraFocusCode = focusCode ?? selectedCode;
  const cancelClickSequence = useCallback(() => {
    lastCountryClickRef.current = null;
    clickGenerationRef.current += 1;
    if (pointerGestureRef.current) pointerGestureRef.current.cancelled = true;
  }, []);

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
    const marker = marketByCode.get(cameraFocusCode);
    const globe = globeRef.current;
    if (!marker || !globe) return;
    const position = markerPosition(marker, countryCenterByCode);
    if (!position) return;
    cancelClickSequence();
    const current = globe.pointOfView();
    const duration = reducedMotion ? 0 : 700;
    cameraAnimationUntilRef.current = Date.now() + duration;
    globe.pointOfView(
      {
        lat: position.lat,
        lng: position.lng,
        altitude: clamp(current.altitude || DEFAULT_ALTITUDE, MIN_ALTITUDE, MAX_ALTITUDE),
      },
      duration,
    );
  }, [cameraFocusCode, cancelClickSequence, countryCenterByCode, marketByCode, reducedMotion]);

  const polygonColor = useCallback(
    (item: object) => {
      const code = countryCode(item as WorldCountryFeature);
      if (!marketByCode.has(code)) return "rgba(24, 72, 108, 0.88)";
      if (code === hoveredCode) return "rgba(76, 224, 211, 0.96)";
      if (code === selectedCode) return "rgba(246, 184, 77, 0.92)";
      return "rgba(35, 174, 166, 0.86)";
    },
    [hoveredCode, marketByCode, selectedCode],
  );

  const polygonStrokeColor = useCallback(
    (item: object) => {
      const code = countryCode(item as WorldCountryFeature);
      return marketByCode.has(code) && code === hoveredCode
        ? "rgba(222, 255, 251, 0.96)"
        : "rgba(151, 196, 218, 0.34)";
    },
    [hoveredCode, marketByCode],
  );

  const polygonTooltip = useCallback(
    (item: object) => {
      const code = countryCode(item as WorldCountryFeature);
      const market = marketByCode.get(code);
      if (!market) return "";
      if (dataProfile === "approved_basic60") {
        const status = locale === "en" ? "Country profile" : "国家档案";
        const detail = market.detail
          ? `<small>${escapeHtml(code)} · ${escapeHtml(market.detail)}</small>`
          : `<small>${escapeHtml(code)}</small>`;
        const metric = market.metric
          ? `<b>${escapeHtml(market.metric.label)} ${escapeHtml(market.metric.value)}</b>`
          : "";
        return `<div class="globe-country-tooltip"><span>${escapeHtml(status)}</span><strong>${escapeHtml(market.name)}</strong>${detail}${metric}</div>`;
      }
      const status = locale === "en" ? "Synthetic demo market" : "合成演示市场";
      const readiness = locale === "en" ? "Readiness" : "进入准备度";
      const readinessValue = market.readiness ?? 0;
      const summary = market.summary
        ? `<p>${escapeHtml(market.summary)}</p>`
        : "";
      return `<div class="globe-country-tooltip"><span>${escapeHtml(status)}</span><strong>${escapeHtml(market.name)}</strong><small>${escapeHtml(code)}</small><b>${escapeHtml(readiness)} ${escapeHtml(readinessValue)}/100</b>${summary}</div>`;
    },
    [dataProfile, locale, marketByCode],
  );

  function configureControls() {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = !reducedMotion && !pointerInsideRef.current;
    controls.autoRotateSpeed = 0.32;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.82;
    controls.enableDamping = true;
    controls.minDistance = 155;
    controls.maxDistance = 370;
    resetView(0, cameraFocusCode);
  }

  function setRotation(paused: boolean) {
    pointerInsideRef.current = paused;
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = !paused && !reducedMotion;
  }

  function toggleExpanded() {
    cancelClickSequence();
    if (!expanded && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setExpanded((value) => !value);
  }

  function zoomBy(delta: number) {
    cancelClickSequence();
    const globe = globeRef.current;
    if (!globe) return;
    const current = globe.pointOfView();
    const duration = reducedMotion ? 0 : 280;
    cameraAnimationUntilRef.current = Date.now() + duration;
    globe.pointOfView(
      {
        lat: current.lat,
        lng: current.lng,
        altitude: clamp(current.altitude + delta, MIN_ALTITUDE, MAX_ALTITUDE),
      },
      duration,
    );
  }

  function resetView(duration = reducedMotion ? 0 : 420, code = selectedCode) {
    cancelClickSequence();
    const marker = marketByCode.get(code);
    const position = marker ? markerPosition(marker, countryCenterByCode) : null;
    cameraAnimationUntilRef.current = Date.now() + duration;
    globeRef.current?.pointOfView(
      position
        ? { lat: position.lat, lng: position.lng, altitude: DEFAULT_ALTITUDE }
        : { lat: 18, lng: 18, altitude: DEFAULT_ALTITUDE },
      duration,
    );
  }

  function selectMarket(code: string) {
    if (code && !marketByCode.has(code)) return;
    onSelect(code);
    setHoveredCode(code || null);
  }

  function changeSelection(code: string) {
    cancelClickSequence();
    selectMarket(code);
  }

  function openCountry(code: string) {
    if (!onOpenCountry || !marketByCode.has(code)) return;
    const now = Date.now();
    if (lastOpenedAtRef.current !== null && now - lastOpenedAtRef.current < DOUBLE_CLICK_WINDOW_MS) {
      return;
    }
    lastOpenedAtRef.current = now;
    cancelClickSequence();
    onOpenCountry(code);
  }

  function beginPointerGesture(event: ReactPointerEvent<HTMLDivElement>) {
    stopCameraAnimation();
    if (!activePointersRef.current.size) {
      pointerGestureRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cancelled: false,
      };
    }
    activePointersRef.current.add(event.pointerId);
    if (event.button !== 0 || activePointersRef.current.size > 1) cancelClickSequence();
  }

  function stopCameraAnimation() {
    const globe = globeRef.current;
    if (!globe || cameraAnimationUntilRef.current <= Date.now()) return;
    cameraAnimationUntilRef.current = 0;
    // The zero-duration setter cancels the old tween at the current view, not its destination.
    globe.pointOfView(globe.pointOfView(), 0);
  }

  function takeWheelControl() {
    stopCameraAnimation();
    cancelClickSequence();
  }

  function movePointerGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = pointerGestureRef.current;
    if (
      gesture &&
      gesture.pointerId === event.pointerId &&
      !gesture.cancelled &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > CLICK_DISTANCE_PX
    ) {
      cancelClickSequence();
    }
  }

  function finishPointerGesture(event: ReactPointerEvent<HTMLDivElement>) {
    pointerSequenceRef.current += 1;
    const gesture = pointerGestureRef.current;
    if (
      gesture &&
      !gesture.cancelled &&
      gesture.pointerId === event.pointerId &&
      activePointersRef.current.size === 1 &&
      event.button === 0 &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= CLICK_DISTANCE_PX
    ) {
      acceptedPointerClicksRef.current.set(event.nativeEvent, {
        generation: clickGenerationRef.current,
        sequence: pointerSequenceRef.current,
      });
    } else {
      cancelClickSequence();
    }
    activePointersRef.current.delete(event.pointerId);
    if (!activePointersRef.current.size) pointerGestureRef.current = null;
  }

  function cancelPointerGesture() {
    cancelClickSequence();
    activePointersRef.current.clear();
    pointerGestureRef.current = null;
  }

  function clickCountry(item: object, event: MouseEvent) {
    // react-globe.gl emits pointerup, not dblclick. Consume each valid gesture once.
    const click = acceptedPointerClicksRef.current.get(event);
    acceptedPointerClicksRef.current.delete(event);
    if (!click || click.generation !== clickGenerationRef.current || event.button !== 0) return;

    const code = countryCode(item as WorldCountryFeature);
    if (!marketByCode.has(code)) {
      cancelClickSequence();
      return;
    }
    const previous = lastCountryClickRef.current;
    const isDoubleClick =
      previous?.code === code &&
      previous.sequence + 1 === click.sequence &&
      event.timeStamp >= previous.at &&
      event.timeStamp - previous.at <= DOUBLE_CLICK_WINDOW_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= CLICK_DISTANCE_PX;
    selectMarket(code);
    if (isDoubleClick) {
      lastCountryClickRef.current = null;
      openCountry(code);
    } else {
      lastCountryClickRef.current = {
        code,
        sequence: click.sequence,
        at: event.timeStamp,
        x: event.clientX,
        y: event.clientY,
      };
    }
  }

  const renderedHeight = expanded
    ? Math.max(420, viewportHeight - (width < 560 ? 20 : 48))
    : width < 560
      ? Math.min(height, 350)
      : height;
  const fallbackLabel =
    dataProfile === "approved_basic60"
      ? locale === "en"
        ? "The 3D map is unavailable. Use the country selector instead."
        : "当前设备无法显示三维地图，请改用国家选择器。"
      : locale === "en"
        ? "The 3D map is unavailable. Use the market selector instead."
        : "当前设备无法显示三维地图，请改用演示市场选择器。";
  const selectorLabel =
    dataProfile === "approved_basic60"
      ? locale === "en"
        ? "Country"
        : "国家"
      : locale === "en"
        ? "Demo market"
        : "演示市场";
  const locateLabel =
    dataProfile === "approved_basic60"
      ? locale === "en"
        ? "Locate country"
        : "定位国家"
      : locale === "en"
        ? "Locate demo market"
        : "定位演示市场";
  const openLabel =
    locale === "en" ? "Open country profile" : "进入国家详情";
  const emptySelectionLabel = locale === "en" ? "Select a country" : "请选择国家";
  const fallback = (
    <div className="globe-fallback" role="status">
      <strong>
        {dataProfile === "approved_basic60"
          ? locale === "en"
            ? "Accessible country explorer"
            : "无障碍国家浏览"
          : locale === "en"
            ? "Accessible market explorer"
            : "无障碍市场浏览"}
      </strong>
      <p>{fallbackLabel}</p>
      <label>
        <span>{selectorLabel}</span>
        <select value={selected?.code ?? ""} onChange={(event) => changeSelection(event.target.value)}>
          <option value="">{emptySelectionLabel}</option>
          {markers.map((marker) => (
            <option value={marker.code} key={marker.code}>
              {marker.name}
            </option>
          ))}
        </select>
      </label>
      {onOpenCountry ? (
        <button type="button" disabled={!selected} onClick={() => selected && openCountry(selected.code)}>
          {openLabel}
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
          cancelPointerGesture();
        }}
      >
        {webglAvailable && worldCountries.length ? (
          <div
            className="country-globe-canvas"
            onPointerDownCapture={beginPointerGesture}
            onPointerMoveCapture={movePointerGesture}
            onPointerUpCapture={finishPointerGesture}
            onPointerCancelCapture={cancelPointerGesture}
            onWheelCapture={takeWheelControl}
          >
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
                onPolygonHover={(item) => {
                  const code = item ? countryCode(item as WorldCountryFeature) : null;
                  setHoveredCode(code && marketByCode.has(code) ? code : null);
                }}
                onPolygonClick={clickCountry}
                onGlobeClick={cancelClickSequence}
                showPointerCursor={(layer, item) =>
                  layer === "polygon" && marketByCode.has(countryCode(item as WorldCountryFeature))
                }
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

            {showLocator ? (
              <label className="globe-market-selector">
                <span>{locateLabel}</span>
                <select
                  value={selected?.code ?? ""}
                  onChange={(event) => changeSelection(event.target.value)}
                >
                  <option value="">{emptySelectionLabel}</option>
                  {markers.map((marker) => (
                    <option value={marker.code} key={marker.code}>
                      {marker.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
