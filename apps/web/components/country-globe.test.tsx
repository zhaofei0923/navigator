import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CountryGlobe, { type CountryGlobeMarker } from "@/components/country-globe";
import type { GlobeMarker } from "@/lib/types";

type WorldCountryFeature = {
  type: "Feature";
  properties: { code: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
};

type MockGlobeProps = {
  polygonsData: WorldCountryFeature[];
  polygonAltitude: number;
  polygonCapColor: (country: WorldCountryFeature) => string;
  polygonStrokeColor: (country: WorldCountryFeature) => string;
  polygonLabel: (country: WorldCountryFeature) => string;
  showPointerCursor: (layer: string, country: WorldCountryFeature) => boolean;
  polygonsTransitionDuration: number;
  pointsData?: unknown[];
  labelsData?: unknown[];
  ringsData?: unknown[];
  onPolygonClick?: (country: WorldCountryFeature, event: MouseEvent) => void;
  onPolygonHover?: (country: WorldCountryFeature | null) => void;
  onGlobeClick?: () => void;
  onGlobeReady?: () => void;
};

const globeMock = vi.hoisted(() => ({
  pointOfView: vi.fn(),
  currentView: null as { lat: number; lng: number; altitude: number } | null,
  deferClicks: false,
  pendingClicks: [] as (() => void)[],
}));

vi.mock("react-globe.gl", () => ({
  default: forwardRef(function MockGlobe(
    {
      polygonsData,
      polygonAltitude,
      polygonCapColor,
      polygonStrokeColor,
      polygonLabel,
      showPointerCursor,
      polygonsTransitionDuration,
      pointsData,
      labelsData,
      ringsData,
      onPolygonClick,
      onPolygonHover,
      onGlobeClick,
      onGlobeReady,
    }: MockGlobeProps,
    ref,
  ) {
    const [view, setView] = useState({ lat: 0, lng: 0, altitude: 1.72 });
    const viewRef = useRef(view);
    const controlsRef = useRef({});
    const readyRef = useRef(onGlobeReady);
    useImperativeHandle(ref, () => ({
      pointOfView(next?: typeof view, duration?: number) {
        if (next) {
          globeMock.pointOfView(next, duration);
          globeMock.currentView = null;
          viewRef.current = next;
          setView(next);
        }
        return globeMock.currentView ?? viewRef.current;
      },
      controls: () => controlsRef.current,
    }));
    useEffect(() => readyRef.current?.(), []);
    return (
      <div
        data-testid="mock-world-globe"
        data-altitude={view.altitude}
        data-latitude={view.lat}
        data-longitude={view.lng}
        data-polygon-altitude={polygonAltitude}
        data-points={Boolean(pointsData)}
        data-labels={Boolean(labelsData)}
        data-rings={Boolean(ringsData)}
        data-transition={polygonsTransitionDuration}
      >
        <button type="button" tabIndex={-1} data-testid="globe-ocean" onPointerUp={onGlobeClick}>
          Ocean
        </button>
        <button type="button" tabIndex={-1} data-testid="globe-background">
          Background
        </button>
        {polygonsData.map((country) => (
          <button
            type="button"
            tabIndex={-1}
            key={country.properties.code}
            data-testid={`polygon-${country.properties.code}`}
            data-color={polygonCapColor(country)}
            data-stroke={polygonStrokeColor(country)}
            data-pointer={showPointerCursor("polygon", country)}
            onMouseEnter={() => onPolygonHover?.(country)}
            onMouseLeave={() => onPolygonHover?.(null)}
            onPointerUp={(event) => {
              const nativeEvent = event.nativeEvent;
              const notify = () => onPolygonClick?.(country, nativeEvent);
              if (globeMock.deferClicks) globeMock.pendingClicks.push(notify);
              else notify();
            }}
            dangerouslySetInnerHTML={{
              __html: polygonLabel(country) || country.properties.code,
            }}
          />
        ))}
      </div>
    );
  }),
}));

vi.mock("three", () => ({
  MeshPhongMaterial: class MeshPhongMaterial {
    dispose() {}
  },
}));

const markers: GlobeMarker[] = [
  {
    data_origin: "synthetic_demo",
    code: "BRA",
    name: "Brazil",
    lat: -10,
    lng: -52,
    summary: "Brazil synthetic market",
    readiness: 72,
  },
  {
    data_origin: "synthetic_demo",
    code: "IDN",
    name: "Indonesia",
    lat: -2,
    lng: 118,
    summary: "Indonesia synthetic market",
    readiness: 66,
  },
];

const countries: WorldCountryFeature[] = [
  {
    type: "Feature",
    properties: { code: "USA" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  {
    type: "Feature",
    properties: { code: "CHN" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  {
    type: "Feature",
    properties: { code: "BRA" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  {
    type: "Feature",
    properties: { code: "IDN" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  ...Array.from({ length: 146 }, (_, index) => ({
    type: "Feature" as const,
    properties: { code: `X${index}` },
    geometry: { type: "Polygon" as const, coordinates: [] },
  })),
];

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function installBrowserStubs(reducedMotion = false) {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: reducedMotion,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } satisfies MediaQueryList),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: "FeatureCollection", features: countries }),
    }),
  );
}

function enableWebGL() {
  vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
}

function SelectedCountryGlobe({
  onSelect,
  onOpenCountry,
  locale = "en",
}: {
  onSelect: (code: string) => void;
  onOpenCountry: (code: string) => void;
  locale?: "zh-CN" | "en";
}) {
  const [selectedCode, setSelectedCode] = useState("");
  return (
    <CountryGlobe
      markers={markers}
      selectedCode={selectedCode}
      focusCode=""
      dataProfile="approved_basic60"
      locale={locale}
      showLocator={false}
      onSelect={(code) => {
        setSelectedCode(code);
        onSelect(code);
      }}
      onOpenCountry={onOpenCountry}
    />
  );
}

function clickPolygonAt(element: HTMLElement, at: number, x = 0, y = 0) {
  const pointer = { pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y };
  fireEvent.pointerDown(element, pointer);
  const event = createEvent.pointerUp(element, pointer);
  Object.defineProperty(event, "timeStamp", { value: at });
  fireEvent(element, event);
}

describe("CountryGlobe", () => {
  beforeEach(() => {
    globeMock.pointOfView.mockClear();
    globeMock.currentView = null;
    globeMock.deferClicks = false;
    globeMock.pendingClicks = [];
    installBrowserStubs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses one keyboard market selector when WebGL is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <CountryGlobe
        markers={markers}
        selectedCode="BRA"
        locale="en"
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("3D map is unavailable");
    const selector = screen.getByRole("combobox", { name: "Demo market" });
    expect(screen.queryByRole("button", { name: /Brazil/ })).not.toBeInTheDocument();

    await user.selectOptions(selector, "IDN");
    expect(onSelect).toHaveBeenCalledWith("IDN");
  });

  it.each(["zh-CN", "en"] as const)("keeps the fallback unselected and exposes keyboard country access in %s", async (locale) => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    const user = userEvent.setup();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} locale={locale} />);

    const selector = await screen.findByRole("combobox", { name: locale === "en" ? "Country" : "国家" });
    const open = screen.getByRole("button", { name: locale === "en" ? "Open country profile" : "进入国家详情" });
    expect(selector).toHaveValue("");
    expect(screen.getByRole("option", { name: locale === "en" ? "Select a country" : "请选择国家" })).toBeInTheDocument();
    expect(open).toBeDisabled();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(onSelect).not.toHaveBeenCalled();

    await user.tab();
    expect(selector).toHaveFocus();
    await user.selectOptions(selector, "IDN");
    expect(selector).toHaveValue("IDN");
    expect(onSelect).toHaveBeenCalledWith("IDN");
    await user.tab();
    expect(open).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpenCountry).toHaveBeenCalledExactlyOnceWith("IDN");

    await user.selectOptions(selector, "");
    expect(selector).toHaveValue("");
    expect(open).toBeDisabled();
    expect(onSelect).toHaveBeenLastCalledWith("");
    expect(onOpenCountry).toHaveBeenCalledTimes(1);
  });

  it("starts and resets at the global view without choosing the first marker", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CountryGlobe markers={markers} selectedCode="" focusCode="" locale="en" onSelect={onSelect} />);

    const globe = await screen.findByTestId("mock-world-globe");
    await waitFor(() => expect(globe).toHaveAttribute("data-latitude", "18"));
    expect(globe).toHaveAttribute("data-longitude", "18");
    expect(screen.getByRole("combobox", { name: "Locate demo market" })).toHaveValue("");
    for (const code of ["BRA", "IDN"]) {
      expect(screen.getByTestId(`polygon-${code}`)).toHaveAttribute("data-color", "rgba(35, 174, 166, 0.86)");
    }
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Reset map view" }));
    expect(globeMock.pointOfView).toHaveBeenLastCalledWith({ lat: 18, lng: 18, altitude: 1.72 }, 420);
  });

  it("selects on a single click without moving the camera and opens once on a same-country double click", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    const user = userEvent.setup();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    const globe = await screen.findByTestId("mock-world-globe");
    globeMock.pointOfView.mockClear();

    await user.click(screen.getByTestId("polygon-IDN"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("IDN");
    expect(onOpenCountry).not.toHaveBeenCalled();
    expect(globeMock.pointOfView).not.toHaveBeenCalled();
    expect(globe).toHaveAttribute("data-latitude", "18");
    expect(globe).toHaveAttribute("data-longitude", "18");
    await user.click(screen.getByTestId("polygon-IDN"));
    expect(onOpenCountry).toHaveBeenCalledExactlyOnceWith("IDN");
    await user.dblClick(screen.getByTestId("polygon-IDN"));
    expect(onOpenCountry).toHaveBeenCalledTimes(1);
    expect(globeMock.pointOfView).not.toHaveBeenCalled();
  });

  it("follows legacy selectedCode changes only when focusCode is omitted", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const { rerender } = render(<CountryGlobe markers={markers} selectedCode="BRA" locale="en" onSelect={onSelect} />);
    const globe = await screen.findByTestId("mock-world-globe");
    await waitFor(() => expect(globe).toHaveAttribute("data-latitude", "-10"));
    expect(globe).toHaveAttribute("data-longitude", "-52");

    rerender(<CountryGlobe markers={markers} selectedCode="IDN" locale="en" onSelect={onSelect} />);
    expect(globeMock.pointOfView).toHaveBeenLastCalledWith({ lat: -2, lng: 118, altitude: 1.72 }, 700);
    expect(globe).toHaveAttribute("data-latitude", "-2");
    expect(globe).toHaveAttribute("data-longitude", "118");
  });

  it("uses explicit focusCode for selector changes while selection-only updates preserve the camera", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const { rerender } = render(<CountryGlobe markers={markers} selectedCode="BRA" focusCode="" locale="en" onSelect={onSelect} />);
    const globe = await screen.findByTestId("mock-world-globe");
    await waitFor(() => expect(globe).toHaveAttribute("data-latitude", "18"));
    expect(globe).toHaveAttribute("data-longitude", "18");

    rerender(<CountryGlobe markers={markers} selectedCode="IDN" focusCode="IDN" locale="en" onSelect={onSelect} />);
    expect(globeMock.pointOfView).toHaveBeenLastCalledWith({ lat: -2, lng: 118, altitude: 1.72 }, 700);
    globeMock.pointOfView.mockClear();
    rerender(<CountryGlobe markers={markers} selectedCode="BRA" focusCode="" locale="en" onSelect={onSelect} />);
    expect(globeMock.pointOfView).not.toHaveBeenCalled();
    expect(globe).toHaveAttribute("data-latitude", "-2");
    expect(globe).toHaveAttribute("data-longitude", "118");
  });

  it.each([
    { animation: "focus", takeover: "pointer" },
    { animation: "focus", takeover: "wheel" },
    { animation: "zoom", takeover: "pointer" },
    { animation: "zoom", takeover: "wheel" },
    { animation: "reset", takeover: "pointer" },
    { animation: "reset", takeover: "wheel" },
  ] as const)("stops an active $animation animation at the current position and zoom on $takeover takeover", async ({ animation, takeover }) => {
    enableWebGL();
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const onSelect = vi.fn();
    const { rerender } = render(<CountryGlobe markers={markers} selectedCode="" focusCode="" locale="en" onSelect={onSelect} />);
    const globe = await screen.findByTestId("mock-world-globe");
    await waitFor(() => expect(globe).toHaveAttribute("data-latitude", "18"));

    if (animation === "focus") {
      rerender(<CountryGlobe markers={markers} selectedCode="BRA" focusCode="BRA" locale="en" onSelect={onSelect} />);
    } else {
      fireEvent.click(screen.getByRole("button", { name: animation === "zoom" ? "Zoom in" : "Reset map view" }));
    }
    expect(globeMock.pointOfView.mock.lastCall?.[1]).toBeGreaterThan(0);
    now += 50;
    const midwayView = { lat: 12, lng: 35, altitude: 1.11 };
    globeMock.currentView = midwayView;
    globeMock.pointOfView.mockClear();

    const country = screen.getByTestId("polygon-IDN");
    const pointer = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 };
    if (takeover === "pointer") fireEvent.pointerDown(country, pointer);
    else fireEvent.wheel(globe, { deltaY: 50 });

    expect(globeMock.pointOfView).toHaveBeenCalledExactlyOnceWith(midwayView, 0);
    expect(globe).toHaveAttribute("data-latitude", "12");
    expect(globe).toHaveAttribute("data-longitude", "35");
    expect(globe).toHaveAttribute("data-altitude", "1.11");

    if (takeover === "pointer") {
      fireEvent.pointerUp(country, pointer);
      fireEvent.pointerDown(country, pointer);
    } else {
      fireEvent.wheel(globe, { deltaY: 50 });
    }
    expect(globeMock.pointOfView).toHaveBeenCalledTimes(1);
  });

  it("does not issue a camera update when the animation has already ended", async () => {
    enableWebGL();
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    render(<CountryGlobe markers={markers} selectedCode="" focusCode="" locale="en" onSelect={vi.fn()} />);
    const globe = await screen.findByTestId("mock-world-globe");
    await waitFor(() => expect(globe).toHaveAttribute("data-latitude", "18"));
    fireEvent.click(screen.getByRole("button", { name: "Reset map view" }));
    now += 1_000;
    globeMock.pointOfView.mockClear();
    fireEvent.pointerDown(screen.getByTestId("polygon-IDN"), { pointerId: 1, button: 0 });
    fireEvent.wheel(globe, { deltaY: 50 });
    expect(globeMock.pointOfView).not.toHaveBeenCalled();
  });

  it("does not combine consecutive clicks on different countries", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    await screen.findByTestId("mock-world-globe");
    clickPolygonAt(screen.getByTestId("polygon-IDN"), 100);
    clickPolygonAt(screen.getByTestId("polygon-BRA"), 200);
    clickPolygonAt(screen.getByTestId("polygon-IDN"), 300);
    expect(onSelect.mock.calls).toEqual([["IDN"], ["BRA"], ["IDN"]]);
    expect(onOpenCountry).not.toHaveBeenCalled();
    clickPolygonAt(screen.getByTestId("polygon-IDN"), 400);
    expect(onOpenCountry).toHaveBeenCalledExactlyOnceWith("IDN");
  });

  it.each([
    { name: "too far apart in time", at: 701, x: 0 },
    { name: "too far apart on screen", at: 200, x: 40 },
  ])("does not combine same-country clicks $name", async ({ at, x }) => {
    enableWebGL();
    const onOpenCountry = vi.fn();
    render(<SelectedCountryGlobe onSelect={vi.fn()} onOpenCountry={onOpenCountry} />);
    await screen.findByTestId("mock-world-globe");
    const country = screen.getByTestId("polygon-IDN");
    clickPolygonAt(country, 100);
    clickPolygonAt(country, at, x);
    expect(onOpenCountry).not.toHaveBeenCalled();
  });

  it.each(["drag", "wheel", "pinch", "cancel", "zoom in", "zoom out", "reset", "ocean", "background", "expand"] as const)("interrupts a pending double click on %s", async (gesture) => {
    enableWebGL();
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    const user = userEvent.setup();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    const globe = await screen.findByTestId("mock-world-globe");
    const country = screen.getByTestId("polygon-IDN");
    clickPolygonAt(country, 100);

    const pointer = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 };
    if (gesture === "drag") {
      fireEvent.pointerDown(country, pointer);
      fireEvent.pointerMove(country, { ...pointer, clientX: 60, buttons: 1 });
      fireEvent.pointerUp(country, { ...pointer, clientX: 60 });
    } else if (gesture === "wheel") {
      fireEvent.wheel(globe, { deltaY: 80 });
    } else if (gesture === "pinch") {
      fireEvent.pointerDown(country, { ...pointer, pointerType: "touch" });
      fireEvent.pointerDown(country, { ...pointer, pointerId: 2, pointerType: "touch", clientX: 50 });
      fireEvent.pointerUp(country, { ...pointer, pointerId: 2, pointerType: "touch", clientX: 75 });
      fireEvent.pointerUp(country, { ...pointer, pointerType: "touch" });
    } else if (gesture === "cancel") {
      fireEvent.pointerDown(country, pointer);
      fireEvent.pointerCancel(country, pointer);
      fireEvent.pointerUp(country, pointer);
    } else if (gesture === "ocean") {
      await user.click(screen.getByTestId("globe-ocean"));
    } else if (gesture === "background") {
      await user.click(screen.getByTestId("globe-background"));
    } else {
      const names = { "zoom in": "Zoom in", "zoom out": "Zoom out", reset: "Reset map view", expand: "Expand world map" };
      await user.click(screen.getByRole("button", { name: names[gesture] }));
    }

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenCountry).not.toHaveBeenCalled();
    clickPolygonAt(country, 200);
    expect(onOpenCountry).not.toHaveBeenCalled();
    clickPolygonAt(country, 300);
    expect(onOpenCountry).toHaveBeenCalledExactlyOnceWith("IDN");
  });

  it("discards a queued pointer-up callback when a zoom happens before its animation frame", async () => {
    enableWebGL();
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    const globe = await screen.findByTestId("mock-world-globe");
    const country = screen.getByTestId("polygon-IDN");
    clickPolygonAt(country, 100);
    globeMock.deferClicks = true;
    clickPolygonAt(country, 200);
    expect(globeMock.pendingClicks).toHaveLength(1);
    fireEvent.wheel(globe, { deltaY: 100 });
    act(() => globeMock.pendingClicks[0]());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenCountry).not.toHaveBeenCalled();
  });

  it("consumes each library click callback only once", async () => {
    enableWebGL();
    globeMock.deferClicks = true;
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    await screen.findByTestId("mock-world-globe");
    const country = screen.getByTestId("polygon-IDN");
    clickPolygonAt(country, 100);
    clickPolygonAt(country, 200);
    act(() => {
      for (const notify of globeMock.pendingClicks) {
        notify();
        notify();
      }
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onOpenCountry).toHaveBeenCalledExactlyOnceWith("IDN");
  });

  it.each(["CHN", "USA"])("does not navigate or select %s when outside the marker scope", async (code) => {
    enableWebGL();
    const onSelect = vi.fn();
    const onOpenCountry = vi.fn();
    render(<SelectedCountryGlobe onSelect={onSelect} onOpenCountry={onOpenCountry} />);
    await screen.findByTestId("mock-world-globe");
    const country = screen.getByTestId(`polygon-${code}`);
    clickPolygonAt(country, 100);
    clickPolygonAt(country, 200);
    expect(country).toHaveAttribute("data-pointer", "false");
    expect(country).toHaveAttribute("data-color", "rgba(24, 72, 108, 0.88)");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenCountry).not.toHaveBeenCalled();
  });

  it("renders complete country polygons without pillars and selects only demo markets", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <CountryGlobe
        markers={markers}
        selectedCode="BRA"
        locale="en"
        onSelect={onSelect}
      />,
    );

    const globe = await screen.findByTestId("mock-world-globe");
    expect(globe).toBeInTheDocument();
    expect(globe).toHaveAttribute("data-polygon-altitude", "0.006");
    expect(globe).toHaveAttribute("data-points", "false");
    expect(globe).toHaveAttribute("data-labels", "false");
    expect(globe).toHaveAttribute("data-rings", "false");
    expect(screen.getAllByTestId(/^polygon-/)).toHaveLength(150);
    expect(screen.getByRole("combobox", { name: "Locate demo market" })).toBeInTheDocument();

    await user.hover(screen.getByTestId("polygon-USA"));
    expect(screen.getByTestId("polygon-USA")).toHaveAttribute("data-color", "rgba(24, 72, 108, 0.88)");
    expect(screen.getByTestId("polygon-USA")).toHaveAttribute("data-pointer", "false");
    await user.click(screen.getByTestId("polygon-USA"));
    expect(onSelect).not.toHaveBeenCalled();

    await user.hover(screen.getByTestId("polygon-IDN"));
    expect(screen.getByTestId("polygon-IDN")).toHaveAttribute("data-color", "rgba(76, 224, 211, 0.96)");
    expect(screen.getByTestId("polygon-IDN")).toHaveAttribute("data-pointer", "true");
    expect(screen.getByTestId("polygon-IDN")).toHaveTextContent("Synthetic demo market");
    expect(screen.getByTestId("polygon-IDN")).toHaveTextContent("Readiness 66/100");
    await user.click(screen.getByTestId("polygon-IDN"));
    expect(onSelect).toHaveBeenCalledWith("IDN");
  });

  it("keeps countries outside the marker scope neutral even with a stale selection", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <CountryGlobe
        dataProfile="approved_basic60"
        markers={[{ code: "IDN", name: "印度尼西亚" }]}
        selectedCode="CHN"
        locale="zh-CN"
        onSelect={onSelect}
      />,
    );

    await screen.findByTestId("mock-world-globe");
    const china = screen.getByTestId("polygon-CHN");
    expect(china).toBeInTheDocument();
    expect(screen.getAllByTestId(/^polygon-/)).toHaveLength(150);
    expect(screen.queryByRole("option", { name: /中国|CHN/ })).not.toBeInTheDocument();

    await user.hover(china);
    expect(china).toHaveAttribute("data-color", "rgba(24, 72, 108, 0.88)");
    expect(china).toHaveAttribute("data-stroke", "rgba(151, 196, 218, 0.34)");
    expect(china).toHaveAttribute("data-pointer", "false");
    expect(china).toHaveTextContent(/^CHN$/);
    expect(china).not.toHaveTextContent("已审核基础数据");
    await user.click(china);
    expect(onSelect).not.toHaveBeenCalled();

    await user.hover(screen.getByTestId("polygon-IDN"));
    expect(screen.getByTestId("polygon-IDN")).toHaveTextContent("国家档案");
    await user.click(screen.getByTestId("polygon-IDN"));
    expect(onSelect).toHaveBeenCalledWith("IDN");
  });

  it("clears presentation of a previously hovered market when it leaves the marker scope", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <CountryGlobe
        markers={markers}
        selectedCode="BRA"
        locale="en"
        onSelect={onSelect}
      />,
    );

    await screen.findByTestId("mock-world-globe");
    await user.hover(screen.getByTestId("polygon-BRA"));
    expect(screen.getByTestId("polygon-BRA")).toHaveAttribute("data-color", "rgba(76, 224, 211, 0.96)");

    rerender(
      <CountryGlobe
        markers={markers.filter((marker) => marker.code !== "BRA")}
        selectedCode="BRA"
        locale="en"
        onSelect={onSelect}
      />,
    );

    const brazil = screen.getByTestId("polygon-BRA");
    expect(brazil).toHaveAttribute("data-color", "rgba(24, 72, 108, 0.88)");
    expect(brazil).toHaveAttribute("data-stroke", "rgba(151, 196, 218, 0.34)");
    expect(brazil).toHaveAttribute("data-pointer", "false");
    expect(brazil).toHaveTextContent(/^BRA$/);
    await user.click(brazil);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("provides zoom, reset and expanded-map controls", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const user = userEvent.setup();

    render(
      <CountryGlobe
        markers={markers}
        selectedCode="BRA"
        locale="zh-CN"
        onSelect={vi.fn()}
      />,
    );

    await screen.findByTestId("mock-world-globe");
    const globe = screen.getByTestId("mock-world-globe");
    const zoomIn = screen.getByRole("button", { name: /^放大地图$/ });
    expect(zoomIn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "缩小地图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置地图视角" })).toBeInTheDocument();

    await user.click(zoomIn);
    await waitFor(() => expect(Number(globe.dataset.altitude)).toBeLessThan(1.72));

    await user.click(screen.getByRole("button", { name: "放大世界地图" }));
    expect(screen.getByRole("dialog", { name: "放大的世界地图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出放大地图" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "退出放大地图" })).toHaveFocus(),
    );

    screen.getByRole("combobox", { name: "定位演示市场" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: /^放大地图$/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "放大的世界地图" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大世界地图" })).toHaveFocus();
  });

  it("disables polygon transitions when reduced motion is requested", async () => {
    installBrowserStubs(true);
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);

    render(
      <CountryGlobe
        markers={markers}
        selectedCode="BRA"
        locale="en"
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("mock-world-globe")).toHaveAttribute(
      "data-transition",
      "0",
    );
  });

  it.each(["zh-CN", "en"] as const)("renders product-facing country facts in %s without internal status labels", async (locale) => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
    const approvedMarkers: CountryGlobeMarker[] = [
      {
        code: "IDN",
        name: "印度尼西亚",
        statusLabel: "已审核基础数据",
        detail: "Asia",
        metric: { label: "Renewable capacity", value: "15,180 MW" },
      },
    ];

    render(
      <CountryGlobe
        dataProfile="approved_basic60"
        markers={approvedMarkers}
        selectedCode="IDN"
        locale={locale}
        onSelect={vi.fn()}
        showLocator={false}
      />,
    );

    await screen.findByTestId("mock-world-globe");
    await userEvent.hover(screen.getByTestId("polygon-IDN"));
    const polygon = screen.getByTestId("polygon-IDN");
    expect(polygon).toHaveTextContent(locale === "en" ? "Country profile" : "国家档案");
    expect(polygon).toHaveTextContent("IDN · Asia");
    expect(polygon).toHaveTextContent("Renewable capacity 15,180 MW");
    expect(polygon).not.toHaveTextContent(/已审核|Basic|reviewed|approved/i);
    expect(polygon).not.toHaveTextContent("合成演示市场");
    expect(polygon).not.toHaveTextContent("进入准备度");
    const locateLabel = locale === "en" ? "Locate country" : "定位国家";
    expect(screen.queryByRole("combobox", { name: locateLabel })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: locale === "en" ? "Expand world map" : "放大世界地图" }));
    expect(screen.queryByRole("combobox", { name: locateLabel })).not.toBeInTheDocument();
  });
});
