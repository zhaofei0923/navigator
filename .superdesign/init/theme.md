# Theme Context

## Part 1 — Compact Token Summary

Source of truth: `apps/web/app/globals.css`. Styling is vanilla global CSS imported by the
Next.js root layout. There is no Tailwind dependency/configuration, CSS-in-JS theme, CSS Modules
theme, external font request, or runtime theme provider. The application is explicitly light-only
(`color-scheme: light`); no `.dark`, `[data-theme]`, or alternate-theme token block exists.

### Color palette (`:root`)

| Token | Value | Primary role |
| --- | --- | --- |
| `--navy-950` | `#071c3f` | Header, deepest headings, dark globe stage |
| `--navy-900` | `#0a254c` | Deep institutional surface/text |
| `--navy-800` | `#12335e` | Emphasized text and controls |
| `--teal-700` | `#087e7c` | Primary-action hover |
| `--teal-600` | `#079b98` | Primary action, active state, positive signal |
| `--teal-100` | `#dff5f3` | Selected/positive tint |
| `--teal-050` | `#f0fbfa` | Very light teal section tint |
| `--coral-600` | `#ef4f45` | Risk and negative trend |
| `--coral-100` | `#fff0ee` | Risk tint |
| `--amber-500` | `#e8a12d` | Demo-boundary emphasis |
| `--amber-100` | `#fff7e9` | Demo-boundary background |
| `--blue-600` | `#1768d4` | Focus ring and comparison series |
| `--surface` | `#ffffff` | Main surface/background |
| `--surface-subtle` | `#f7f9fc` | Quiet section background |
| `--border` | `#d7dee8` | Standard border/grid |
| `--border-strong` | `#bdc9d8` | Strong input/control border |
| `--muted` | `#607086` | Secondary text |
| `--text` | `#213550` | Body text |
| `--shadow-frame` | `0 8px 24px rgba(7, 28, 63, 0.08)` | Shared elevated frame shadow |
| `--font-sans` | `Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif` | Application font stack |

Dark mode: none. All palette variables are defined only in `:root`.

### Typography

- Family: `var(--font-sans)`; Inter is named but not downloaded, so the installed system/CJK
  fallbacks are used.
- Body baseline: `15px / 1.6`; optimized legibility and antialiasing are enabled.
- Observed fixed size set: `9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 28, 29, 30, 32, 34, 38, 40px`.
- Responsive display sizes: `clamp(22px, 2vw, 30px)`, `clamp(24px, 3vw, 34px)`,
  `clamp(28px, 2.3vw, 34px)`, `clamp(30px, 2.7vw, 40px)`,
  `clamp(30px, 3.3vw, 46px)`, `clamp(34px, 4vw, 52px)`,
  `clamp(36px, 4vw, 54px)`, and `clamp(42px, 4.8vw, 66px)`.
- Observed weights: `500, 550, 600, 650, 680, 700, 720, 750, 760, 780, 800`.
- Common line heights: `1.12–1.4` for headings, `1.55–1.85` for body/supporting copy,
  with `18px`, `20px`, and `24px` used in compact controls.

### Spacing and sizing

- No centralized spacing variables exist. Reused scalar steps observed in gaps/padding are
  `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20, 22, 24, 28, 30, 32, 34, 36, 38,
  42, 48, 52, 60, 62, 84px`; component-specific composed values remain in the raw CSS.
- Key responsive gutters: content uses
  `24px clamp(32px, 3.8vw, 60px) 8px`; the persistent warning uses
  `8px clamp(24px, 3.5vw, 60px)`.
- Core control heights: `40px` button minimum; `42–48px` for larger fields/actions.
- Shell heights: desktop header `72px`; mobile header `64px`; demo warning minimum `44px`.
- Main content cap in current CSS: `1586px` for `.app-content`; many page sections apply their
  own narrower `590–960px` text/form caps.

### Border radius

- No radius variables exist.
- Observed radii: `3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20px`, plus `99px`
  pills and `50%` circles.
- Frequent defaults: buttons `5px`; compact controls/cards `5–8px`; larger panels
  `10–18px`.

### Shadows

- Tokenized elevation: `--shadow-frame: 0 8px 24px rgba(7, 28, 63, 0.08)`.
- Other observed light elevations: `0 8px 24px rgba(7, 28, 63, 0.04)`,
  `0 9px 24px rgba(7, 28, 63, 0.07)`,
  `0 16px 36px rgba(7, 28, 63, 0.08)`, and
  `0 22px 60px rgba(6, 26, 53, 0.16)`.
- Dark/overlay elevations: `0 12px 28px rgba(0, 0, 0, 0.22)`,
  `0 16px 34px rgba(0, 0, 0, 0.34)`, and
  `0 24px 80px rgba(0, 8, 24, 0.54)`.
- Focus/selection effects include `0 0 0 3px white` and
  `inset 0 0 0 1.5px var(--teal-600)`.

### Breakpoints and motion

- Primary layout thresholds: `1180px` (wide layouts), `840px` (mobile navigation/single-column
  transition), and `680px` (compact mobile content).
- All observed max-width queries: `1500, 1279, 1180, 1140, 1100, 1050, 980, 900, 840, 760,
  720, 680, 560, 480px`.
- `@media (prefers-reduced-motion: reduce)` disables smooth scrolling, animation, and
  non-essential transitions.
- Horizontal overflow is clipped at `html`, `body`, and the app frame; wide tables use local
  scroll containers.

## Part 2 — Raw Theme Sources

### Tailwind configuration

None. `apps/web/package.json` contains no Tailwind dependency, the application imports no Tailwind
entrypoint, and no `tailwind.config.*` file exists.

### Theme providers and separate token files

None. `apps/web/app/layout.tsx` imports `globals.css` and a locale provider only; it does not
install a visual theme provider. All visual tokens and theme rules are in the single stylesheet
below.

### `apps/web/app/globals.css` (complete current source)

```css
:root {
  --navy-950: #071c3f;
  --navy-900: #0a254c;
  --navy-800: #12335e;
  --teal-700: #087e7c;
  --teal-600: #079b98;
  --teal-100: #dff5f3;
  --teal-050: #f0fbfa;
  --coral-600: #ef4f45;
  --coral-100: #fff0ee;
  --amber-500: #e8a12d;
  --amber-100: #fff7e9;
  --blue-600: #1768d4;
  --surface: #ffffff;
  --surface-subtle: #f7f9fc;
  --border: #d7dee8;
  --border-strong: #bdc9d8;
  --muted: #607086;
  --text: #213550;
  --shadow-frame: 0 8px 24px rgba(7, 28, 63, 0.08);
  --font-sans: Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  max-width: 100%;
  overflow-x: clip;
  color-scheme: light;
  background: var(--surface);
  scroll-behavior: smooth;
}

body {
  margin: 0;
  max-width: 100%;
  min-width: 320px;
  overflow-x: clip;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select {
  color: inherit;
  font: inherit;
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

a {
  color: inherit;
  text-decoration: none;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--blue-600);
  outline-offset: 2px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1,
h2,
h3 {
  color: var(--navy-950);
}

.app-frame {
  width: 100%;
  max-width: 100%;
  overflow-x: clip;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

.app-header {
  position: sticky;
  z-index: 50;
  top: 0;
  display: grid;
  grid-template-columns: minmax(310px, 1.2fr) minmax(580px, 1.8fr) auto;
  align-items: stretch;
  min-height: 72px;
  padding: 0 24px;
  color: white;
  background: var(--navy-950);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  color: white;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.app-brand b {
  font-size: 16px;
  font-weight: 650;
}

.main-nav {
  display: flex;
  justify-content: center;
  align-items: stretch;
  gap: 12px;
}

.main-nav a {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 13px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.main-nav a::after {
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  height: 4px;
  background: var(--teal-600);
  content: "";
  opacity: 0;
  transform: scaleX(0.4);
  transition: opacity 180ms ease, transform 180ms ease;
}

.main-nav a:hover,
.main-nav a[aria-current="page"] {
  color: white;
}

.main-nav a[aria-current="page"]::after {
  opacity: 1;
  transform: scaleX(1);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 20px;
}

.mobile-menu-button {
  display: none;
  align-self: center;
  border: 0;
  background: transparent;
  color: white;
}

.demo-warning {
  position: sticky;
  z-index: 45;
  top: 72px;
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 8px clamp(24px, 3.5vw, 60px);
  border-bottom: 1px solid #f0dcc0;
  background: var(--amber-100);
  color: #ad6500;
  font-size: 14px;
}

.demo-warning span {
  color: #846b49;
}

.app-content {
  width: min(100%, 1586px);
  flex: 1;
  margin: 0 auto;
  padding: 24px clamp(32px, 3.8vw, 60px) 8px;
}

.app-footer {
  display: flex;
  justify-content: center;
  gap: 14px;
  padding: 14px 24px 18px;
  color: var(--muted);
  font-size: 13px;
}

.button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 9px 16px;
  font-size: 14px;
  font-weight: 650;
  line-height: 20px;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease;
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.button-primary {
  border-color: var(--teal-600);
  background: var(--teal-600);
  color: white;
}

.button-primary:hover:not(:disabled) {
  border-color: var(--teal-700);
  background: var(--teal-700);
}

.button-secondary {
  border-color: var(--border-strong);
  background: var(--surface);
  color: var(--navy-800);
}

.button-secondary:hover:not(:disabled) {
  border-color: var(--teal-600);
  color: var(--teal-700);
}

.button-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--teal-700);
}

.button-wide {
  width: 100%;
}

.icon-button {
  display: inline-grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.header-compare {
  min-width: 124px;
}

.header-logout {
  color: rgba(255, 255, 255, 0.82);
}

.header-logout:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}

.page-heading h1 {
  margin-bottom: 4px;
  font-size: clamp(28px, 2.3vw, 34px);
  line-height: 1.24;
  letter-spacing: -0.03em;
}

.page-heading p {
  margin-bottom: 0;
  color: var(--muted);
}

.hero-heading {
  margin-bottom: 12px;
}

.hero-heading h1 {
  margin-bottom: 4px;
  font-size: clamp(30px, 2.7vw, 40px);
  line-height: 1.2;
  letter-spacing: -0.035em;
}

.hero-heading p {
  margin-bottom: 12px;
  color: var(--muted);
  font-size: 16px;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}

.selection-count {
  color: var(--navy-800);
  font-size: 15px;
}

.selection-count strong {
  padding: 0 4px;
  color: var(--teal-700);
  font-size: 21px;
}

.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.panel-header {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}

.panel-header h2,
.panel-header h3 {
  margin: 0;
  font-size: 17px;
  line-height: 24px;
}

.section-tabs {
  display: flex;
  width: fit-content;
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 5px;
}

.section-tabs a {
  min-width: 82px;
  padding: 7px 16px;
  border-right: 1px solid var(--border);
  background: white;
  color: var(--navy-800);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.section-tabs a:last-child {
  border-right: 0;
}

.section-tabs a[aria-current="page"] {
  background: var(--teal-600);
  color: white;
}

.page-state {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--muted);
  text-align: left;
}

.page-state p {
  margin: 0;
}

.page-state strong {
  color: var(--navy-950);
}

.page-state-error {
  border-color: #f0c4bf;
  background: var(--coral-100);
  color: #a53028;
}

.spin {
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 28px;
  background:
    linear-gradient(90deg, var(--navy-950) 0 34%, transparent 34%),
    var(--surface-subtle);
}

.login-panel {
  width: min(100%, 470px);
  margin-left: min(32vw, 380px);
  padding: 42px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: white;
  box-shadow: var(--shadow-frame);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 32px;
  color: var(--navy-950);
  font-size: 20px;
  font-weight: 750;
}

.brand-icon {
  display: grid;
  width: 45px;
  height: 45px;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-950);
  color: white;
}

.login-panel h1 {
  margin-bottom: 8px;
  font-size: 30px;
  line-height: 1.3;
}

.login-panel > p {
  color: var(--muted);
}

.login-notice {
  margin: 24px 0;
  padding: 10px 12px;
  border-left: 3px solid var(--amber-500);
  background: var(--amber-100);
  color: #9a5a00;
  font-weight: 650;
}

.login-form label {
  display: block;
  margin-bottom: 6px;
  color: var(--navy-800);
  font-size: 14px;
  font-weight: 650;
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}

.input-with-icon svg {
  position: absolute;
  left: 13px;
  color: var(--muted);
}

.input-with-icon input {
  width: 100%;
  height: 44px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  padding: 9px 12px 9px 42px;
  background: white;
  font-size: 16px;
}

.form-error {
  margin: -2px 0 12px;
  color: #b02d25;
  font-size: 13px;
}

.login-boundary {
  margin: 20px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.country-rail {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin-bottom: 14px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: white;
  scrollbar-width: thin;
}

.country-rail-item {
  display: flex;
  min-width: 180px;
  min-height: 62px;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border: 0;
  border-right: 1px solid var(--border);
  padding: 12px 20px;
  background: white;
  color: var(--navy-950);
  font-size: 17px;
  font-weight: 650;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.country-rail-item:last-child {
  border-right: 0;
}

.country-rail-item:hover {
  background: var(--surface-subtle);
}

.country-rail-item-selected {
  box-shadow: inset 0 0 0 1.5px var(--teal-600);
  background: var(--teal-050);
}

.country-rail-action {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--muted);
  border-radius: 50%;
  color: var(--navy-800);
}

.country-rail-item-selected .country-rail-action {
  border-color: var(--teal-600);
  background: var(--teal-600);
  color: white;
}

.score-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(125px, 1fr));
  overflow: hidden;
  border: 1px solid #e1e7ee;
  border-radius: 8px;
  background: white;
}

.score-cell {
  position: relative;
  min-height: 118px;
  padding: 16px 15px 12px;
}

.score-cell + .score-cell::before {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 0;
  border-left: 1px dashed var(--border);
  content: "";
}

.score-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--navy-800);
  font-weight: 650;
  white-space: nowrap;
}

.score-label svg {
  color: var(--teal-600);
}

.score-label-risk svg,
.score-value-risk strong {
  color: var(--coral-600);
}

.score-value {
  margin: 5px 0 0 26px;
  color: var(--muted);
  line-height: 1.25;
}

.score-value strong {
  color: var(--teal-700);
  font-size: 25px;
  line-height: 1;
}

.score-value span {
  margin-left: 3px;
  font-size: 13px;
}

.score-trend {
  margin: 7px 0 0 26px;
  color: var(--teal-700);
  font-size: 12px;
}

.score-trend-down {
  color: var(--coral-600);
}

.score-trend-muted {
  color: var(--muted);
}

.radar-chart {
  width: 100%;
  height: 320px;
  min-height: 260px;
}

.radar-chart-compact {
  height: 210px;
  min-height: 180px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--text);
  font-size: 13px;
}

.data-table th {
  height: 38px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--navy-950);
  font-weight: 650;
  text-align: left;
  white-space: nowrap;
}

.data-table td {
  padding: 9px 12px;
  border-bottom: 1px solid #e5eaf0;
  vertical-align: top;
}

.data-table tbody tr:last-child td {
  border-bottom: 0;
}

.data-table tbody tr:hover {
  background: var(--teal-050);
}

.data-table td strong {
  display: block;
  color: var(--navy-800);
  font-weight: 600;
}

.data-table td small {
  display: -webkit-box;
  margin-top: 2px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 18px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.table-scroll {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.timeline-table {
  min-width: 720px;
}

.timeline-date {
  position: relative;
  padding-left: 24px !important;
  white-space: nowrap;
}

.timeline-date > span {
  position: absolute;
  top: 16px;
  left: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--teal-600);
  box-shadow: 0 0 0 3px white;
}

.type-tag,
.capability-tag,
.status-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 1px 7px;
  background: var(--teal-100);
  color: var(--teal-700);
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.table-action {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 4px;
  color: var(--navy-800);
}

.table-action:hover {
  background: var(--teal-100);
  color: var(--teal-700);
}

.inline-empty {
  margin: 0;
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

.decision-panel {
  align-self: stretch;
  padding: 0 18px;
}

.decision-section {
  padding: 20px 0 17px;
  border-bottom: 1px solid var(--border);
}

.decision-section:last-child {
  border-bottom: 0;
}

.decision-section h2 {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
  color: var(--teal-700);
  font-size: 17px;
  line-height: 24px;
}

.decision-section-danger h2 {
  color: var(--coral-600);
}

.decision-section ul {
  margin: 0;
  padding-left: 20px;
}

.decision-section ul li {
  margin-bottom: 7px;
  font-size: 13px;
  line-height: 1.7;
}

.decision-section ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.decision-section ol li {
  display: grid;
  grid-template-columns: 22px 1fr;
  align-items: start;
  gap: 8px;
  font-size: 13px;
}

.decision-section ol span {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 3px;
  background: var(--teal-600);
  color: white;
  font-size: 11px;
  font-weight: 700;
}

.home-dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 370px);
  gap: 18px;
}

.country-workspace {
  min-width: 0;
  padding: 0 18px 10px;
}

.country-overview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 0 10px;
}

.country-overview-header h2 {
  margin-bottom: 6px;
  font-size: 24px;
  line-height: 1.3;
}

.country-overview-header h2 span {
  margin-left: 12px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
}

.country-overview-header p {
  max-width: 760px;
  margin-bottom: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}

.overview-score-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  align-items: center;
  gap: 6px;
}

.synthetic-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 2px 0 10px;
  color: var(--muted);
  font-size: 12px;
}

.timeline-section {
  border-top: 1px solid var(--border);
}

.timeline-toolbar {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.timeline-toolbar h2 {
  margin: 0;
  font-size: 17px;
}

.timeline-toolbar select,
.filter-bar select,
.filter-bar input {
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 6px 32px 6px 10px;
  background: white;
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 550;
}

.chart-loading {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: var(--muted);
  font-size: 12px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-subtle);
}

.filter-search {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
}

.filter-search svg {
  position: absolute;
  left: 11px;
  color: var(--muted);
}

.filter-bar .filter-search input {
  width: 100%;
  padding-left: 36px;
}

.result-count {
  margin-left: auto;
  padding-right: 8px;
  color: var(--muted);
  font-size: 13px;
}

.country-list {
  overflow: hidden;
}

.country-list-head,
.country-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.05fr) minmax(440px, 2fr) 130px 125px;
  align-items: center;
  gap: 20px;
}

.country-list-head {
  min-height: 42px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 650;
}

.country-row {
  min-height: 112px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  transition: background 180ms ease;
}

.country-row:last-child {
  border-bottom: 0;
}

.country-row:hover {
  background: var(--teal-050);
}

.country-row-name {
  display: flex;
  align-items: center;
  gap: 13px;
}

.country-code {
  display: inline-grid;
  min-width: 48px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: white;
  color: var(--navy-800);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.08em;
}

.country-row h2 {
  margin: 0;
  font-size: 18px;
}

.country-row p {
  margin: 1px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.mini-score-set {
  display: grid;
  gap: 4px;
}

.mini-score {
  display: grid;
  grid-template-columns: 36px minmax(70px, 1fr) 26px;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.mini-score small {
  color: var(--muted);
}

.mini-score b {
  color: var(--navy-800);
  font-size: 11px;
  text-align: right;
}

.progress-track {
  display: block;
  height: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: #e6eaf0;
}

.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--teal-600);
}

.readiness-score {
  color: var(--muted);
}

.readiness-score strong {
  color: var(--teal-700);
  font-size: 26px;
}

.readiness-score span {
  margin-left: 3px;
  font-size: 12px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 12px;
  color: var(--teal-700);
  font-size: 13px;
  font-weight: 600;
}

.country-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.country-detail-heading > div {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 0 14px;
}

.country-detail-heading h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.25;
}

.country-detail-heading p {
  grid-column: 2;
  margin: 0;
  color: var(--muted);
}

.country-code-large {
  grid-row: 1 / span 2;
  min-width: 60px;
  height: 48px;
  border-color: var(--teal-600);
  color: var(--teal-700);
  font-size: 14px;
}

.country-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 18px 0 8px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.country-facts > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
}

.country-facts svg {
  color: var(--teal-600);
}

.country-facts strong {
  color: var(--navy-800);
}

.country-summary {
  max-width: 960px;
  margin-bottom: 16px;
  color: var(--text);
}

.detail-score-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  align-items: center;
  gap: 18px;
  margin-bottom: 18px;
}

.detail-radar-panel {
  overflow: hidden;
}

.detail-radar-panel .panel-header span {
  color: var(--muted);
  font-size: 12px;
}

.detail-radar-panel .radar-chart {
  height: 250px;
}

.country-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
}

.signal-panel {
  min-width: 0;
  overflow: hidden;
}

.signal-panel .panel-header a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--teal-700);
  font-size: 12px;
  font-weight: 600;
}

.compare-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  overflow-x: auto;
  padding: 2px;
}

.selected-country {
  display: flex;
  min-width: 240px;
  min-height: 44px;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 12px;
  background: white;
  color: var(--navy-950);
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
}

.selected-country > span {
  flex: 1;
  text-align: left;
}

.selected-country svg:nth-of-type(1) {
  padding: 2px;
  border-radius: 50%;
  background: var(--teal-600);
  color: white;
}

.selected-country svg:nth-of-type(2) {
  color: var(--muted);
}

.add-country {
  position: relative;
  display: flex;
  min-width: 170px;
  min-height: 44px;
  align-items: center;
  border: 1px dashed var(--blue-600);
  border-radius: 5px;
  background: white;
  color: var(--blue-600);
}

.add-country svg {
  position: absolute;
  left: 28px;
  pointer-events: none;
}

.add-country select {
  width: 100%;
  height: 42px;
  appearance: none;
  border: 0;
  padding: 8px 20px 8px 54px;
  background: transparent;
  color: var(--blue-600);
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.compare-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 12px;
}

.compare-tabs {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 5px;
}

.compare-tabs button {
  min-width: 80px;
  min-height: 38px;
  border: 0;
  border-right: 1px solid var(--border);
  padding: 7px 14px;
  background: white;
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.compare-tabs button:last-child {
  border-right: 0;
}

.compare-tabs button[aria-selected="true"] {
  background: var(--teal-600);
  color: white;
}

.compare-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}

.compare-meta > span {
  height: 18px;
  border-left: 1px solid var(--border);
  margin: 0 5px;
}

.compare-primary-grid,
.compare-secondary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(350px, 0.9fr);
  gap: 18px;
  margin-bottom: 14px;
}

.comparison-matrix,
.compare-radar-panel,
.differences-panel,
.recommendation-panel {
  min-width: 0;
  overflow: hidden;
}

.matrix-table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  font-size: 13px;
}

.matrix-table th,
.matrix-table td {
  height: 47px;
  padding: 8px 14px;
  border-right: 1px solid #e4e9ef;
  border-bottom: 1px solid #e4e9ef;
  text-align: left;
}

.matrix-table tr:last-child th,
.matrix-table tr:last-child td {
  border-bottom: 0;
}

.matrix-table th:last-child,
.matrix-table td:last-child {
  border-right: 0;
}

.matrix-table thead th {
  background: var(--surface-subtle);
  color: var(--navy-950);
}

.matrix-table tbody th {
  min-width: 154px;
  color: var(--navy-800);
  font-weight: 600;
}

.matrix-score {
  display: grid;
  grid-template-columns: 28px minmax(70px, 1fr) 42px;
  align-items: center;
  gap: 8px;
}

.matrix-score strong {
  color: var(--navy-950);
  font-size: 15px;
}

.matrix-score em {
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.positive { color: var(--teal-700); }
.negative { color: var(--coral-600); }

.matrix-note {
  padding: 8px 14px 10px;
}

.compare-radar-panel .radar-chart {
  height: 290px;
}

.differences-panel .data-table {
  min-width: 680px;
}

.evidence-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--blue-600);
  font-weight: 600;
  white-space: nowrap;
}

.recommendation-panel {
  padding-bottom: 14px;
}

.recommendation-panel ol {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 14px 16px 4px;
  list-style: none;
}

.recommendation-panel li {
  display: grid;
  grid-template-columns: 26px 1fr;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.recommendation-panel li > span {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: var(--teal-600);
  color: white;
  font-size: 12px;
  font-weight: 750;
}

.recommendation-panel li:nth-child(2) > span {
  background: var(--blue-600);
}

.recommendation-panel li strong {
  color: var(--navy-950);
  font-size: 14px;
}

.recommendation-panel li p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.recommendation-summary {
  margin: 10px 16px 12px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.65;
}

.recommendation-panel > .button {
  width: calc(100% - 32px);
  margin: 0 16px;
}

.methodology-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.intelligence-table-wrap {
  overflow: hidden;
}

.intelligence-table {
  min-width: 920px;
}

.intelligence-table th:first-child,
.intelligence-table td:first-child {
  width: 145px;
}

.intelligence-table th:nth-child(2),
.intelligence-table td:nth-child(2) {
  min-width: 250px;
}

.intelligence-table td {
  padding-block: 13px;
}

.country-table-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--navy-800);
  font-weight: 600;
}

.country-table-link > span {
  display: inline-grid;
  min-width: 38px;
  height: 25px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: white;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.status-inline {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}

.risk-title {
  display: flex !important;
  align-items: center;
  gap: 6px;
  color: #a53028 !important;
}

.risk-level {
  color: var(--coral-600);
  font-size: 12px;
  font-weight: 650;
}

.list-score {
  color: var(--teal-700);
  font-size: 22px;
  font-weight: 750;
}

.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

@media (max-width: 720px) {
  .intelligence-table-wrap {
    margin-right: -16px;
    border-right: 0;
    border-radius: 8px 0 0 8px;
  }
}

@media (max-width: 1050px) {
  .compare-primary-grid,
  .compare-secondary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .compare-selector {
    align-items: stretch;
  }

  .selected-country {
    min-width: 180px;
  }

  .compare-tools {
    align-items: flex-start;
    flex-direction: column;
  }

  .compare-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .compare-tabs button {
    min-width: max-content;
    flex: 1;
  }
}

@media (max-width: 1140px) {
  .country-list-head,
  .country-row {
    grid-template-columns: minmax(210px, 1fr) minmax(340px, 2fr) 100px;
  }

  .country-list-head span:last-child,
  .country-row > .button {
    display: none;
  }

  .detail-score-layout,
  .country-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .filter-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .result-count {
    margin-left: 0;
  }

  .country-list-head {
    display: none;
  }

  .country-row {
    grid-template-columns: 1fr 72px;
    gap: 14px;
  }

  .country-row-name {
    grid-column: 1;
  }

  .mini-score-set {
    grid-column: 1 / -1;
  }

  .readiness-score {
    grid-column: 2;
    grid-row: 1;
    text-align: right;
  }

  .country-detail-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 1279px) {
  .home-dashboard {
    grid-template-columns: 1fr;
  }

  .decision-panel {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .decision-section {
    padding-inline: 16px;
    border-right: 1px solid var(--border);
    border-bottom: 0;
  }

  .decision-section:last-child {
    border-right: 0;
  }
}

@media (max-width: 980px) {
  .overview-score-grid {
    grid-template-columns: 1fr;
  }

  .overview-score-grid .radar-chart {
    height: 260px;
  }
}

@media (max-width: 760px) {
  .country-overview-header {
    flex-direction: column;
  }

  .decision-panel {
    display: block;
  }

  .decision-section {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}

@media (max-width: 1100px) {
  .score-strip {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  .score-cell:nth-child(4),
  .score-cell:nth-child(5) {
    border-top: 1px solid var(--border);
  }

  .score-cell:nth-child(4)::before {
    display: none;
  }
}

@media (max-width: 680px) {
  .score-strip {
    grid-template-columns: 1fr;
  }

  .score-cell {
    min-height: auto;
    padding: 13px 16px;
  }

  .score-cell + .score-cell::before {
    top: 0;
    right: 16px;
    bottom: auto;
    left: 16px;
    border-top: 1px dashed var(--border);
    border-left: 0;
  }

  .score-cell:nth-child(4),
  .score-cell:nth-child(5) {
    border-top: 0;
  }

  .country-rail-item {
    min-width: 162px;
  }
}

@media (max-width: 1180px) {
  .app-header {
    grid-template-columns: auto 1fr auto;
  }

  .app-brand b {
    display: none;
  }

  .main-nav {
    gap: 2px;
  }

  .main-nav a {
    padding-inline: 10px;
    font-size: 14px;
  }

  .header-compare {
    min-width: 104px;
    padding-inline: 11px;
  }
}

@media (max-width: 840px) {
  .app-header {
    grid-template-columns: 1fr auto auto;
    min-height: 64px;
    padding-inline: 18px;
  }

  .app-brand {
    font-size: 18px;
  }

  .app-brand svg {
    width: 32px;
  }

  .mobile-menu-button {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
  }

  .main-nav {
    position: absolute;
    top: 64px;
    right: 0;
    left: 0;
    display: none;
    flex-direction: column;
    gap: 0;
    padding: 8px 18px 14px;
    background: var(--navy-950);
    box-shadow: 0 12px 18px rgba(7, 28, 63, 0.2);
  }

  .main-nav-open {
    display: flex;
  }

  .main-nav a {
    min-height: 44px;
  }

  .main-nav a::after {
    top: 8px;
    right: auto;
    bottom: 8px;
    left: 0;
    width: 3px;
    height: auto;
  }

  .header-compare {
    display: none;
  }

  .demo-warning {
    top: 64px;
  }

  .app-content {
    padding: 20px 20px 8px;
  }

  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .login-page {
    background: var(--navy-950);
  }

  .login-panel {
    margin-left: 0;
    padding: 32px 26px;
  }
}

@media (max-width: 560px) {
  .app-brand span {
    font-size: 17px;
  }

  .demo-warning {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 3px 8px;
    padding-inline: 18px;
  }

  .demo-warning span {
    width: 100%;
    padding-left: 26px;
    font-size: 12px;
  }

  .app-content {
    padding-inline: 16px;
  }

  .hero-actions {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .section-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .section-tabs a {
    min-width: max-content;
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

/* V2 bilingual expansion workbench */
.app-frame {
  background: #f5f8fb;
}

.app-header {
  grid-template-columns: minmax(250px, 0.9fr) minmax(480px, 1.35fr) auto;
  min-height: 76px;
  padding-inline: clamp(22px, 3vw, 48px);
  background: #061a35;
}

@media (max-width: 1500px) {
  .app-brand b {
    display: none;
  }
}

.app-content {
  width: min(100%, 1280px);
  padding: 36px clamp(24px, 3.2vw, 44px) 24px;
}

.demo-warning {
  top: 76px;
}

.header-actions {
  gap: 10px;
}

.header-actions > .button-secondary {
  min-width: 72px;
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.button-large {
  min-height: 48px;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 15px;
}

.button-light {
  border-color: rgba(255, 255, 255, 0.36);
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.button-light:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.68);
  background: rgba(255, 255, 255, 0.14);
}

.section-kicker {
  display: block;
  margin-bottom: 12px;
  color: var(--teal-700);
  font-size: 12px;
  font-weight: 780;
  letter-spacing: 0.14em;
  line-height: 1.4;
  text-transform: uppercase;
}

.landing-page {
  display: grid;
  gap: 84px;
}

.landing-hero {
  display: grid;
  grid-template-columns: minmax(360px, 0.86fr) minmax(540px, 1.14fr);
  align-items: stretch;
  overflow: hidden;
  border: 1px solid #163d67;
  border-radius: 20px;
  background: #082447;
  box-shadow: 0 22px 60px rgba(6, 26, 53, 0.16);
}

.landing-hero-copy {
  display: flex;
  min-height: 670px;
  flex-direction: column;
  justify-content: center;
  padding: clamp(48px, 5vw, 78px);
  color: rgba(255, 255, 255, 0.82);
}

.landing-hero-copy .section-kicker {
  color: #68d9d0;
}

.landing-hero-copy h1 {
  max-width: 620px;
  margin-bottom: 24px;
  color: white;
  font-size: clamp(42px, 4.8vw, 66px);
  font-weight: 720;
  letter-spacing: -0.05em;
  line-height: 1.08;
}

.landing-hero-copy > p {
  max-width: 590px;
  margin-bottom: 30px;
  font-size: 17px;
  line-height: 1.85;
}

.landing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.landing-proof {
  display: flex;
  flex-wrap: wrap;
  gap: 9px 20px;
  margin-top: 34px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

.landing-proof span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.landing-proof svg {
  color: #5fd8cf;
}

.landing-globe-card {
  min-width: 0;
  padding: 34px 34px 28px;
  border-left: 1px solid rgba(255, 255, 255, 0.12);
  background: #061a35;
  color: white;
}

.landing-globe-heading > span {
  color: #56d1c8;
  font-size: 11px;
  font-weight: 780;
  letter-spacing: 0.15em;
}

.landing-globe-heading h2 {
  margin: 7px 0 3px;
  color: white;
  font-size: clamp(22px, 2vw, 30px);
}

.landing-globe-heading p {
  margin-bottom: 0;
  color: rgba(255, 255, 255, 0.64);
  font-size: 13px;
}

.landing-globe-loading {
  min-height: 470px;
}

.country-globe {
  position: relative;
  min-width: 0;
}

.country-globe.is-expanded {
  position: fixed;
  z-index: 1000;
  inset: 18px;
  overflow: hidden;
  border: 1px solid rgba(123, 211, 208, 0.28);
  border-radius: 16px;
  padding: 6px;
  background: #061a35;
  box-shadow: 0 24px 80px rgba(0, 8, 24, 0.54);
}

.country-globe-stage {
  position: relative;
  display: grid;
  min-width: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
}

.country-globe-canvas {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.country-globe-canvas canvas {
  cursor: grab;
}

.country-globe-canvas:active canvas {
  cursor: grabbing;
}

.globe-fallback {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 12px;
  max-width: 360px;
  padding: 30px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.76);
  text-align: center;
}

.globe-fallback strong {
  display: block;
  margin-bottom: 8px;
  color: white;
}

.globe-fallback p {
  margin: 0;
}

.globe-fallback label {
  display: grid;
  gap: 6px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 11px;
  text-align: left;
}

.globe-fallback select,
.globe-fallback button {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 8px 11px;
  background: #0d3155;
  color: white;
}

.globe-toolbar {
  position: absolute;
  z-index: 4;
  top: 16px;
  right: 12px;
  display: grid;
  gap: 5px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 11px;
  background: rgba(6, 26, 53, 0.9);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
}

.globe-toolbar button {
  display: grid;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 7px;
  place-items: center;
  background: rgba(255, 255, 255, 0.06);
  color: white;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.globe-toolbar button:hover,
.globe-toolbar button[aria-pressed="true"] {
  background: rgba(52, 200, 190, 0.22);
  color: #86eee6;
}

.globe-toolbar button:focus-visible,
.globe-market-selector select:focus-visible {
  outline: 2px solid #83e9e1;
  outline-offset: 2px;
}

.globe-market-selector {
  position: absolute;
  z-index: 4;
  right: 12px;
  bottom: 14px;
  display: grid;
  gap: 5px;
  width: min(210px, calc(100% - 24px));
  padding: 9px 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  background: rgba(6, 26, 53, 0.9);
}

.globe-market-selector span {
  color: rgba(255, 255, 255, 0.58);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.globe-market-selector select {
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 5px 8px;
  background: #0d3155;
  color: white;
  cursor: pointer;
}

.country-globe .float-tooltip-kap {
  max-width: min(300px, calc(100vw - 32px));
  border: 1px solid rgba(142, 227, 220, 0.28);
  border-radius: 10px;
  padding: 0;
  background: rgba(4, 22, 44, 0.96);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.34);
  color: white;
  white-space: normal;
}

.globe-country-tooltip {
  display: grid;
  gap: 5px;
  min-width: 210px;
  padding: 14px 15px;
}

.globe-country-tooltip > span {
  color: #68dcd4;
  font-size: 9px;
  font-weight: 780;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.globe-country-tooltip strong {
  font-size: 16px;
}

.globe-country-tooltip small {
  color: rgba(255, 255, 255, 0.58);
  font-size: 10px;
}

.globe-country-tooltip b {
  color: #f6c86d;
  font-size: 11px;
}

.globe-country-tooltip p {
  margin: 2px 0 0;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.55;
}

.landing-market-summary {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  margin-top: 14px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.13);
}

.landing-market-summary > div:first-child {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 10px;
}

.landing-market-summary > div:first-child > span {
  color: #61d9d0;
  font-size: 11px;
  font-weight: 780;
}

.landing-market-summary > div:first-child > strong {
  font-size: 14px;
}

.landing-market-summary p {
  grid-column: 1 / -1;
  margin: 5px 0 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  line-height: 1.65;
}

.market-summary-action {
  display: grid;
  min-width: 138px;
  justify-items: end;
}

.market-summary-action small {
  color: rgba(255, 255, 255, 0.58);
  font-size: 10px;
}

.market-summary-action b {
  color: white;
  font-size: 28px;
}

.market-summary-action b em {
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  font-style: normal;
}

.market-summary-action a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #61d9d0;
  font-size: 11px;
  font-weight: 700;
}

.landing-section {
  display: grid;
  gap: 34px;
}

.landing-section-heading {
  max-width: 760px;
}

.landing-section-heading h2 {
  margin-bottom: 12px;
  font-size: clamp(30px, 3.3vw, 46px);
  letter-spacing: -0.04em;
  line-height: 1.15;
}

.landing-section-heading p {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.capability-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 18px;
  min-height: 178px;
  border: 1px solid #d8e1ec;
  border-radius: 14px;
  padding: 28px;
  background: white;
  box-shadow: 0 8px 24px rgba(7, 28, 63, 0.04);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.capability-card:hover {
  border-color: #77c8c2;
  box-shadow: 0 16px 36px rgba(7, 28, 63, 0.08);
  transform: translateY(-2px);
}

.capability-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 10px;
  background: var(--teal-100);
  color: var(--teal-700);
}

.capability-card h3 {
  margin-bottom: 8px;
  font-size: 21px;
}

.capability-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.75;
}

.capability-card > svg {
  margin-top: 12px;
  color: var(--teal-700);
}

.workflow-section {
  border-radius: 18px;
  padding: 52px;
  background: #eaf4f4;
}

.landing-section-heading.compact {
  max-width: 680px;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid #c5dedd;
  border-radius: 12px;
  background: #c5dedd;
  list-style: none;
}

.workflow-grid li {
  min-height: 190px;
  padding: 28px 24px;
  background: #f8fbfb;
}

.workflow-grid li > span {
  color: var(--teal-700);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.workflow-grid h3 {
  margin: 28px 0 8px;
  font-size: 19px;
}

.workflow-grid p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}

.landing-trust {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 22px;
  border-radius: 18px;
  padding: 38px 42px;
  background: #0a625f;
  color: rgba(255, 255, 255, 0.78);
}

.trust-icon {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.13);
  color: white;
}

.landing-trust h2 {
  margin-bottom: 5px;
  color: white;
  font-size: 24px;
}

.landing-trust p {
  max-width: 760px;
  margin: 0;
}

.tools-hub,
.tool-page,
.compare-page-v2 {
  display: grid;
  gap: 30px;
}

.tools-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  align-items: end;
  gap: 60px;
  padding: 48px;
  border-radius: 18px;
  background: #082447;
  color: rgba(255, 255, 255, 0.72);
}

.tools-hero .section-kicker {
  color: #62d6ce;
}

.tools-hero h1 {
  max-width: 680px;
  margin-bottom: 16px;
  color: white;
  font-size: clamp(36px, 4vw, 54px);
  letter-spacing: -0.045em;
  line-height: 1.12;
}

.tools-hero > div:first-child p {
  max-width: 720px;
  margin: 0;
  font-size: 16px;
  line-height: 1.8;
}

.tools-hero-note {
  border-left: 2px solid #37bdb4;
  padding-left: 22px;
}

.tools-hero-note svg {
  margin-bottom: 11px;
  color: #62d6ce;
}

.tools-hero-note strong {
  display: block;
  color: white;
}

.tools-hero-note p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.tool-hub-card {
  display: flex;
  min-height: 250px;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid #d8e1ec;
  border-radius: 14px;
  padding: 28px;
  background: white;
  box-shadow: 0 8px 24px rgba(7, 28, 63, 0.04);
}

.tool-hub-card:hover {
  border-color: #77c8c2;
  box-shadow: 0 16px 36px rgba(7, 28, 63, 0.08);
}

.tool-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tool-card-top span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 780;
  letter-spacing: 0.1em;
}

.tool-card-top svg {
  color: var(--teal-700);
}

.tool-hub-card h2 {
  margin: 34px 0 9px;
  font-size: 24px;
}

.tool-hub-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.75;
}

.tool-card-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 24px;
  color: var(--teal-700);
  font-weight: 700;
}

.tool-page-heading {
  max-width: 820px;
}

.tool-page-heading h1,
.compare-hero-v2 h1 {
  margin-bottom: 12px;
  font-size: clamp(34px, 4vw, 52px);
  letter-spacing: -0.045em;
  line-height: 1.12;
}

.tool-page-heading p,
.compare-hero-v2 p {
  margin: 0;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.8;
}

.tool-boundary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid #ead5af;
  border-radius: 10px;
  padding: 12px 15px;
  background: #fff8e9;
  color: #826130;
  font-size: 13px;
}

.tool-workspace {
  display: grid;
  grid-template-columns: minmax(310px, 0.72fr) minmax(0, 1.28fr);
  align-items: start;
  gap: 20px;
}

.tool-form {
  display: grid;
  gap: 20px;
  padding: 24px;
}

.tool-form > label,
.tool-form-columns > label {
  display: grid;
  gap: 7px;
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 680;
}

.tool-form select,
.tool-form input,
.tender-filter select,
.tender-filter input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  background: white;
  color: var(--navy-950);
}

.tool-form select:focus,
.tool-form input:focus,
.tender-filter select:focus,
.tender-filter input:focus {
  border-color: var(--teal-600);
}

.tool-form-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tool-choice-group {
  display: grid;
  gap: 8px;
  margin: 0;
  border: 0;
  padding: 0;
}

.tool-choice-group legend {
  margin-bottom: 9px;
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 680;
}

.tool-choice {
  display: flex;
  min-height: 43px;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 11px;
  background: white;
  color: var(--text);
  cursor: pointer;
}

.tool-choice.active {
  border-color: #79c9c3;
  background: var(--teal-050);
  color: var(--teal-700);
}

.tool-choice input {
  width: 16px;
  min-height: 16px;
  accent-color: var(--teal-600);
}

.concept-preview-line {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--surface-subtle);
  color: var(--muted);
  font-size: 12px;
}

.form-error {
  margin: 0;
  color: #a53028;
  font-size: 13px;
}

.tool-result {
  min-height: 440px;
  overflow: hidden;
  padding: 28px;
}

.tool-result-empty {
  display: grid;
  min-height: 370px;
  place-items: center;
  align-content: center;
  gap: 14px;
  color: var(--muted);
  text-align: center;
}

.tool-result-empty svg {
  color: var(--teal-600);
}

.tool-result-hero {
  margin: -28px -28px 24px;
  padding: 28px;
  background: #082447;
  color: rgba(255, 255, 255, 0.72);
}

.tool-result-hero span {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #66d9d1;
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.06em;
}

.tool-result-hero h2 {
  margin: 18px 0 0;
  color: white;
  font-size: 23px;
  line-height: 1.55;
}

.compact-result h2 {
  font-size: 32px;
}

.tool-result-section {
  padding: 18px 0;
  border-bottom: 1px solid var(--border);
}

.tool-result-section:last-child {
  border-bottom: 0;
}

.tool-result-section h3 {
  margin-bottom: 10px;
  font-size: 15px;
}

.tool-result-section ul,
.tool-result-section ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
}

.tool-result-section li {
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}

.report-preview {
  padding: 38px;
}

.report-preview-heading {
  padding-bottom: 24px;
  border-bottom: 2px solid var(--navy-950);
}

.report-preview-heading > span {
  color: var(--teal-700);
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.12em;
}

.report-preview-heading h2 {
  margin: 12px 0 7px;
  font-size: 29px;
}

.report-preview-heading p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.report-sections > section {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  padding: 24px 0;
  border-bottom: 1px solid var(--border);
}

.report-sections > section > span {
  color: var(--teal-700);
  font-size: 11px;
  font-weight: 800;
}

.report-sections h3 {
  margin-bottom: 8px;
  font-size: 17px;
}

.report-sections p {
  margin: 0;
  color: var(--text);
  line-height: 1.75;
}

.tender-filter {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(150px, 0.55fr)) auto;
  gap: 10px;
  padding: 12px;
}

.tender-filter .filter-search input {
  padding-left: 36px;
}

.tender-result-count {
  margin-bottom: 12px;
  color: var(--muted);
  font-size: 13px;
}

.tender-result-count strong {
  color: var(--teal-700);
  font-size: 22px;
}

.tender-workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.tender-workspace.detail-open {
  grid-template-columns: minmax(0, 1fr) minmax(310px, 0.5fr);
}

.tender-card-list {
  display: grid;
  gap: 10px;
}

.tender-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  background: white;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.tender-card:hover,
.tender-card.active {
  border-color: #78c9c3;
  box-shadow: 0 9px 24px rgba(7, 28, 63, 0.07);
}

.tender-card-code {
  display: grid;
  width: 52px;
  height: 40px;
  place-items: center;
  border-radius: 7px;
  background: var(--teal-100);
  color: var(--teal-700);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.tender-card-copy > span:first-child {
  color: var(--teal-700);
  font-size: 10px;
  font-weight: 700;
  text-transform: capitalize;
}

.tender-card-copy > strong {
  display: block;
  margin: 5px 0;
  font-size: 17px;
}

.tender-card-copy .tender-card-summary {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tender-card-meta {
  display: grid;
  min-width: 190px;
  gap: 6px;
  justify-items: end;
}

.tender-card-meta span,
.tender-card-meta em {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 11px;
  font-style: normal;
}

.tender-card-meta em {
  margin-top: 5px;
  color: var(--teal-700);
  font-weight: 700;
}

.tender-detail {
  position: sticky;
  top: 142px;
  min-width: 0;
  padding: 28px;
}

.tender-detail-close {
  position: absolute;
  top: 12px;
  right: 12px;
}

.tender-detail h2 {
  margin: 12px 0;
  padding-right: 20px;
  font-size: 22px;
}

.tender-detail > p {
  color: var(--muted);
  line-height: 1.75;
}

.tender-detail dl {
  display: grid;
  gap: 0;
  margin: 22px 0;
}

.tender-detail dl > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}

.tender-detail dt {
  color: var(--muted);
  font-size: 12px;
}

.tender-detail dd {
  margin: 0;
  color: var(--navy-950);
  font-size: 12px;
  font-weight: 680;
  text-align: right;
}

.tender-action-box {
  border-left: 3px solid var(--teal-600);
  padding: 12px 14px;
  background: var(--teal-050);
}

.tender-action-box strong {
  color: var(--teal-700);
  font-size: 13px;
}

.tender-action-box p {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.65;
}

.compare-hero-v2 {
  max-width: 820px;
}

.two-country-selector {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  padding: 0;
  overflow: hidden;
  background: var(--border);
}

.two-country-selector > label {
  display: grid;
  gap: 5px;
  padding: 24px 30px;
  background: white;
}

.two-country-selector > label > span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.two-country-selector > label > strong {
  font-size: 24px;
}

.two-country-selector select {
  margin-top: 8px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--teal-700);
  font-size: 13px;
  font-weight: 680;
}

.compare-versus {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 5px solid #f5f8fb;
  border-radius: 50%;
  background: var(--navy-950);
  color: white;
  transform: translate(-50%, -50%);
}

.compare-versus svg {
  display: none;
}

.compare-versus b {
  font-size: 11px;
  letter-spacing: 0.08em;
}

.compare-overview-v2 {
  display: grid;
  grid-template-columns: minmax(0, 1.28fr) minmax(360px, 0.72fr);
  gap: 18px;
}

.compare-score-panel,
.compare-radar-v2 {
  min-width: 0;
  overflow: hidden;
}

.compare-dimensions {
  padding: 4px 20px 18px;
}

.compare-dimension-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) repeat(2, minmax(120px, 1fr));
  align-items: center;
  gap: 18px;
  min-height: 62px;
  border-bottom: 1px solid var(--border);
}

.compare-dimension-row:last-child {
  border-bottom: 0;
}

.compare-dimension-row > span {
  color: var(--navy-800);
  font-size: 13px;
  font-weight: 650;
}

.dimension-score {
  display: grid;
  grid-template-columns: 30px 1fr;
  align-items: center;
  gap: 9px;
}

.dimension-score b {
  color: var(--muted);
  font-size: 15px;
}

.dimension-score.leader b {
  color: var(--teal-700);
}

.dimension-score.leader .progress-track i {
  background: var(--teal-600);
}

.compare-radar-v2 .radar-chart {
  height: 340px;
}

.compare-recommendation-v2 {
  display: grid;
  grid-template-columns: minmax(280px, 0.72fr) minmax(0, 1.28fr);
  gap: 34px;
  border-radius: 16px;
  padding: 36px;
  background: #082447;
  color: rgba(255, 255, 255, 0.72);
}

.compare-recommendation-v2 .section-kicker {
  color: #62d6ce;
}

.compare-recommendation-v2 h2 {
  color: white;
  font-size: 24px;
  line-height: 1.45;
}

.compare-country-insights {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.compare-country-insights article {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 11px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.06);
}

.compare-country-insights article > span {
  color: #62d6ce;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

.compare-country-insights h3 {
  margin: 8px 0;
  color: white;
}

.compare-country-insights p {
  min-height: 82px;
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
}

.compare-country-insights a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #62d6ce;
  font-size: 12px;
  font-weight: 700;
}

.markets-page {
  display: grid;
  gap: 28px;
}

.markets-page .page-heading,
.markets-page .filter-bar {
  margin-bottom: 0;
}

.markets-explorer {
  overflow: hidden;
  border: 1px solid #123a61;
  border-radius: 16px;
  padding: 30px 32px 28px;
  background: #061a35;
  color: white;
}

.markets-explorer-heading {
  max-width: 660px;
}

.markets-explorer-heading .section-kicker {
  color: #56d1c8;
}

.markets-explorer-heading h2 {
  margin: 8px 0 4px;
  color: white;
  font-size: clamp(24px, 3vw, 34px);
}

.markets-explorer-heading p {
  margin: 0;
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}

.markets-globe-loading {
  min-height: 410px;
}

.markets-explorer-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 28px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  margin-top: 16px;
  padding-top: 24px;
}

.markets-explorer-summary > div:first-child {
  min-width: 0;
}

.markets-explorer-summary span,
.markets-explorer-summary small {
  display: block;
  color: #56d1c8;
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.markets-explorer-summary strong {
  display: block;
  margin-top: 5px;
  color: white;
  font-size: 20px;
}

.markets-explorer-summary p {
  max-width: 720px;
  margin: 7px 0 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 13px;
  line-height: 1.65;
}

.markets-explorer-summary > div:last-child {
  display: grid;
  min-width: 160px;
  justify-items: end;
  gap: 4px;
}

.markets-explorer-summary b {
  color: white;
  font-size: 28px;
}

.markets-explorer-summary em {
  color: rgba(255, 255, 255, 0.48);
  font-size: 12px;
  font-style: normal;
}

.markets-explorer-summary a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  color: #6be0d7;
  font-size: 12px;
  font-weight: 720;
}

@media (max-width: 1180px) {
  .app-header {
    grid-template-columns: auto 1fr auto;
  }

  .header-compare {
    display: none;
  }

  .landing-hero {
    grid-template-columns: 1fr;
  }

  .landing-hero-copy {
    min-height: auto;
  }

  .landing-globe-card {
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    border-left: 0;
  }

  .tender-filter {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tender-workspace.detail-open {
    grid-template-columns: 1fr;
  }

  .tender-detail {
    position: static;
  }
}

@media (max-width: 900px) {
  .landing-page {
    gap: 62px;
  }

  .capability-grid,
  .tools-grid,
  .tool-workspace,
  .compare-overview-v2,
  .compare-recommendation-v2 {
    grid-template-columns: 1fr;
  }

  .workflow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .landing-trust,
  .tools-hero {
    grid-template-columns: 1fr;
  }

  .tools-hero {
    gap: 34px;
  }

  .landing-trust > .button {
    width: fit-content;
  }
}

@media (max-width: 840px) {
  .app-header {
    min-height: 64px;
  }

  .demo-warning {
    top: 64px;
  }
}

@media (max-width: 680px) {
  .app-content {
    padding: 22px 16px 12px;
  }

  .landing-page {
    gap: 52px;
  }

  .landing-hero {
    border-radius: 14px;
  }

  .landing-hero-copy {
    padding: 38px 24px;
  }

  .landing-hero-copy h1 {
    font-size: 40px;
  }

  .landing-hero-copy > p {
    font-size: 15px;
  }

  .landing-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .landing-actions .button {
    width: 100%;
  }

  .landing-globe-card {
    padding: 26px 18px 22px;
  }

  .markets-explorer {
    padding: 26px 18px 22px;
  }

  .markets-explorer-summary {
    grid-template-columns: 1fr;
  }

  .markets-explorer-summary > div:last-child {
    justify-items: start;
  }

  .country-globe-stage {
    max-height: 360px;
  }

  .country-globe.is-expanded {
    inset: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
  }

  .country-globe.is-expanded .country-globe-stage {
    max-height: none;
    border-radius: 0;
  }

  .globe-toolbar {
    top: 10px;
    right: 8px;
  }

  .globe-market-selector {
    right: 8px;
    bottom: 8px;
    width: min(184px, calc(100% - 16px));
  }

  .landing-market-summary,
  .capability-grid,
  .tools-grid,
  .tool-form-columns,
  .two-country-selector,
  .compare-country-insights {
    grid-template-columns: 1fr;
  }

  .market-summary-action {
    justify-items: start;
  }

  .capability-card {
    grid-template-columns: auto 1fr;
    min-height: 0;
    padding: 22px;
  }

  .capability-card > svg {
    display: none;
  }

  .workflow-section {
    padding: 30px 18px;
  }

  .workflow-grid {
    grid-template-columns: 1fr;
  }

  .workflow-grid li {
    min-height: 0;
  }

  .landing-trust,
  .tools-hero,
  .compare-recommendation-v2 {
    padding: 28px 22px;
  }

  .tools-hero h1 {
    font-size: 38px;
  }

  .tool-hub-card {
    min-height: 220px;
  }

  .tool-result,
  .report-preview {
    padding: 22px;
  }

  .tool-result-hero {
    margin: -22px -22px 20px;
    padding: 22px;
  }

  .tender-filter {
    grid-template-columns: 1fr;
  }

  .tender-card {
    grid-template-columns: auto 1fr;
  }

  .tender-card-meta {
    grid-column: 1 / -1;
    justify-items: start;
    padding-left: 70px;
  }

  .two-country-selector > label {
    padding: 24px;
  }

  .compare-versus {
    top: 50%;
  }

  .compare-dimension-row {
    grid-template-columns: 1fr repeat(2, minmax(80px, 1fr));
    gap: 10px;
  }

  .dimension-score {
    grid-template-columns: 28px 1fr;
  }
}

@media (max-width: 480px) {
  .app-brand span {
    display: none;
  }
}

```
