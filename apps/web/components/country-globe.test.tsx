import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CountryGlobe from "@/components/country-globe";
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
  polygonLabel: (country: WorldCountryFeature) => string;
  polygonsTransitionDuration: number;
  pointsData?: unknown[];
  labelsData?: unknown[];
  ringsData?: unknown[];
  onPolygonClick?: (country: WorldCountryFeature) => void;
  onPolygonHover?: (country: WorldCountryFeature | null) => void;
};

vi.mock("react-globe.gl", () => ({
  default: forwardRef(function MockGlobe(
    {
      polygonsData,
      polygonAltitude,
      polygonCapColor,
      polygonLabel,
      polygonsTransitionDuration,
      pointsData,
      labelsData,
      ringsData,
      onPolygonClick,
      onPolygonHover,
    }: MockGlobeProps,
    ref,
  ) {
    const [view, setView] = useState({ lat: 0, lng: 0, altitude: 1.72 });
    useImperativeHandle(ref, () => ({
      pointOfView(next?: typeof view) {
        if (next) setView(next);
        return view;
      },
      controls: () => ({}),
    }));
    return (
      <div
        data-testid="mock-world-globe"
        data-altitude={view.altitude}
        data-polygon-altitude={polygonAltitude}
        data-points={Boolean(pointsData)}
        data-labels={Boolean(labelsData)}
        data-rings={Boolean(ringsData)}
        data-transition={polygonsTransitionDuration}
      >
        {polygonsData.map((country) => (
          <button
            type="button"
            tabIndex={-1}
            key={country.properties.code}
            data-testid={`polygon-${country.properties.code}`}
            data-color={polygonCapColor(country)}
            onMouseEnter={() => onPolygonHover?.(country)}
            onMouseLeave={() => onPolygonHover?.(null)}
            onClick={() => onPolygonClick?.(country)}
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
    properties: { code: "BRA" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  {
    type: "Feature",
    properties: { code: "IDN" },
    geometry: { type: "Polygon", coordinates: [] },
  },
  ...Array.from({ length: 147 }, (_, index) => ({
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

describe("CountryGlobe", () => {
  beforeEach(() => {
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
    await waitFor(() =>
      expect(screen.getByTestId("polygon-USA").dataset.color).toContain("76, 224, 211"),
    );
    await user.click(screen.getByTestId("polygon-USA"));
    expect(onSelect).not.toHaveBeenCalled();

    await user.hover(screen.getByTestId("polygon-IDN"));
    expect(screen.getByTestId("polygon-IDN")).toHaveTextContent("Synthetic demo market");
    expect(screen.getByTestId("polygon-IDN")).toHaveTextContent("Readiness 66/100");
    await user.click(screen.getByTestId("polygon-IDN"));
    expect(onSelect).toHaveBeenCalledWith("IDN");
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
});
