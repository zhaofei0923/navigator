# Navigator Static Showcase Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished bilingual, interactive Navigator investor/partner showcase as one offline-capable HTML file containing only fictional demo data.

**Architecture:** `showcase/navigator-demo.html` owns the complete deliverable: semantic HTML, one embedded stylesheet, one embedded script, bilingual demo fixtures, and inline SVG. A focused Node test file validates offline purity and fixture boundaries, then launches Playwright directly against a `file://` URL to exercise the rendered experience without a server.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, inline SVG, Node.js built-in test runner, existing `@playwright/test` package.

## Global Constraints

- The distributable surface is exactly one file: `showcase/navigator-demo.html`.
- Do not add dependencies or modify the unified data model, AI retrieval boundaries, permissions, billing, or production data paths.
- Do not read, copy, import, or expose any real country seed, canonical publication, API response, or existing production fixture.
- All business examples use clearly fictional market, organization, source, metric, and report data.
- Support `zh-CN` and `en`; default to `zh-CN`; keep UI and fictional business content aligned in both languages.
- No external fonts, images, stylesheets, scripts, analytics, network requests, or service worker.
- All interactive text derived from user input must be rendered through `textContent`, never HTML interpolation.
- BASIC, STANDARD, and COMPLETE change content depth only; all ten fixed modules remain present.
- Preserve the visible disclaimer: fictional demo data and not investment or market-entry advice.
- Use system fonts, semantic HTML, visible keyboard focus, text alternatives, and `prefers-reduced-motion`.

## File Map

- Create `showcase/navigator-demo.html`: the only distributable artifact; contains presentation narrative, dashboard, workbench, AI simulation, report preview, fixtures, styles, state, and rendering.
- Create `showcase/navigator-demo.test.mjs`: static contract and Playwright tests for the offline file; not part of the distributed page.

---

### Task 1: Offline Bilingual Showcase Shell

**Files:**
- Create: `showcase/navigator-demo.html`
- Create: `showcase/navigator-demo.test.mjs`

**Interfaces:**
- Consumes: none.
- Produces: DOM landmarks `#capabilities`, `#demo`, `#ai-advisor`, `#reports`, `#partnership`; controls `[data-action="set-locale"]`; global render entry point `renderApp()`; state keys `locale`, `marketId`, `moduleKey`, and `reportId`.

- [ ] **Step 1: Write failing offline and bilingual shell tests**

Create `showcase/navigator-demo.test.mjs` with Node built-ins and the installed Playwright package. Resolve `navigator-demo.html` with `pathToFileURL`, launch Chromium with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when provided, collect console errors, and include these assertions:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const demoPath = join(currentDir, "navigator-demo.html");
const demoUrl = pathToFileURL(demoPath).href;

test("is a self-contained offline document with explicit demo boundaries", async () => {
  const source = await readFile(demoPath, "utf8");
  assert.match(source, /<!doctype html>/i);
  assert.doesNotMatch(source, /<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.match(source, /DEMO_FIXTURES/);
  assert.match(source, /虚构演示数据/);
  assert.match(source, /Fictional demo data/);
});

test("renders the bilingual narrative shell from a file URL", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(demoUrl);
  await assert.doesNotReject(() => page.locator("h1").waitFor());
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  assert.match(await page.locator("h1").innerText(), /出海决策/);
  await page.getByRole("button", { name: "EN" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.match(await page.locator("h1").innerText(), /market intelligence/i);
  assert.deepEqual(consoleErrors, []);
});
```

- [ ] **Step 2: Run tests and confirm the missing artifact fails**

Run: `pnpm exec node --test showcase/navigator-demo.test.mjs`

Expected: FAIL with `ENOENT` for `showcase/navigator-demo.html`.

- [ ] **Step 3: Implement the semantic shell and design system**

Create `showcase/navigator-demo.html` with:

- `<!doctype html>`, `lang="zh-CN"`, responsive viewport metadata, and a descriptive title.
- A skip link, sticky header, brand, five anchor links, and two locale buttons.
- `<main>` sections with the exact IDs in the interface block.
- A restrained first viewport containing the approved value proposition, two CTA links, inline SVG intelligence visual, and persistent demo disclaimer.
- Narrative sections for platform problems, ten-module model, and partnership value.
- A partnership contact action using a replaceable `mailto:` address only; no form submission, tracking, or visitor-data storage.
- One embedded `<style>` defining named tokens (`--ink`, `--navy`, `--blue`, `--green`, `--amber`, `--red`, `--line`, `--surface`, `--muted`), open layouts, visible `:focus-visible`, mobile breakpoints at `960px` and `640px`, and reduced-motion overrides.
- One embedded `<script>` containing `const COPY = { "zh-CN": ..., en: ... }`, safe storage helpers, `state`, `setLocale(locale)`, `applyCopy()`, and `renderApp()`.
- `data-i18n` attributes for every fixed UI string; no production locale imports or real business data.

The locale handler must update `document.documentElement.lang`, button `aria-pressed`, all `data-i18n` nodes through `textContent`, and safely persist only the locale string.

- [ ] **Step 4: Run the shell tests**

Run: `pnpm exec node --test showcase/navigator-demo.test.mjs`

Expected: both tests PASS and browser console error list is empty.

- [ ] **Step 5: Review and commit the shell slice**

Run: `git diff --check && git status --short`

Expected: only the two showcase files are uncommitted and `git diff --check` prints nothing.

Commit:

```bash
git add showcase/navigator-demo.html showcase/navigator-demo.test.mjs
git commit -m "feat: add offline bilingual showcase shell"
```

---

### Task 2: Interactive Market Dashboard and Ten-Module Workbench

**Files:**
- Modify: `showcase/navigator-demo.html`
- Modify: `showcase/navigator-demo.test.mjs`

**Interfaces:**
- Consumes: `renderApp()`, shell section `#demo`, and state keys from Task 1.
- Produces: `DEMO_FIXTURES`, `filterMarkets(filters)`, `selectMarket(marketId)`, `selectModule(moduleKey)`, `renderDashboard()`, `renderWorkbench()`, controls `#region-filter`, `#industry-filter`, `#technology-filter`, `#coverage-filter`, `[data-market-id]`, and `[data-module-key]`.

- [ ] **Step 1: Add failing dashboard and workbench tests**

Extend the browser test after locale verification, or add a second browser test using the same launch pattern, with these assertions:

```js
await page.getByRole("button", { name: "中文" }).click();
assert.equal(await page.locator("[data-market-id]").count(), 3);
await page.locator("#coverage-filter").selectOption("COMPLETE");
assert.equal(await page.locator("[data-market-id]").count(), 1);
await page.getByRole("button", { name: /重置筛选/ }).click();
await page.locator("[data-market-id]").nth(1).click();
assert.equal(await page.locator("[data-market-id]").nth(1).getAttribute("aria-pressed"), "true");
assert.equal(await page.locator("[data-module-key]").count(), 10);
await page.locator('[data-module-key="policy"]').click();
assert.match(await page.locator("#module-panel").innerText(), /政策|数据建设中/);
await page.locator("#region-filter").selectOption("north-arc");
await page.locator("#industry-filter").selectOption("wind");
await assert.doesNotReject(() => page.getByText(/没有匹配市场/).waitFor());
```

Add static assertions that the source includes all three coverage values and all ten exact module keys.

- [ ] **Step 2: Run the focused test and verify missing controls fail**

Run: `pnpm exec node --test --test-name-pattern="bilingual narrative shell" showcase/navigator-demo.test.mjs`

Expected: FAIL because `#coverage-filter` and dashboard controls do not exist.

- [ ] **Step 3: Implement fictional fixtures and dashboard state**

Add `DEMO_FIXTURES` with exactly three fictional markets: `aurora` (`north-arc`, `solar`, `pv`), `meridian` (`central-corridor`, `storage`, `bess`), and `solstice` (`southern-belt`, `wind`, `onshore-wind`). Use BASIC, STANDARD, and COMPLETE respectively. Each fixture must contain:

- localized name, region label, summary, opportunities, risks, and recommended entry text;
- non-real region/industry/technology codes used only by this page;
- one of BASIC, STANDARD, COMPLETE;
- fictional metrics and a seven-point trend series;
- ten module entries keyed by the fixed module keys, each with `BUILDING`, `PARTIAL`, or `COMPLETE` and localized summaries;
- fictional source names using the `.example` reserved domain when a URL-like value is shown;
- an explicit `fictional: true` marker.

Implement pure filtering and selected-state functions. Render filter options from localized demo metadata. Use `aria-pressed` for market and module choices. When filters exclude all markets, render a localized empty state and reset action. Preserve the selected market only while it remains in the filtered result.

- [ ] **Step 4: Implement the decision workbench**

Render selected-market metrics, opportunity/risk summaries, the fixed ten-module navigation, selected module content, source/update metadata, coverage state, and a small inline SVG trend chart. BUILDING modules must always render the localized Data Building explanation. Use text plus icon/label for semantic states; color alone is insufficient.

Persist only fictional selection identifiers through guarded storage helpers. Do not persist user-entered text.

- [ ] **Step 5: Run dashboard tests and inspect both languages**

Run: `pnpm exec node --test showcase/navigator-demo.test.mjs`

Expected: all tests PASS; console errors remain empty.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: Review and commit the dashboard slice**

Commit:

```bash
git add showcase/navigator-demo.html showcase/navigator-demo.test.mjs
git commit -m "feat: add interactive fictional market workbench"
```

---

### Task 3: AI Simulation, Report Preview, Responsive and Accessibility QA

**Files:**
- Modify: `showcase/navigator-demo.html`
- Modify: `showcase/navigator-demo.test.mjs`

**Interfaces:**
- Consumes: selected fictional market, locale state, `#ai-advisor`, and `#reports`.
- Produces: `matchDemoAnswer(question, marketId, locale)`, `renderAiAnswer(answer)`, `selectReport(reportId)`, `renderReport()`, controls `#ai-question`, `#ai-submit`, `[data-prompt-id]`, `[data-report-id]`, result regions `#ai-result` and `#report-preview`.

- [ ] **Step 1: Add failing AI, report, persistence, and mobile tests**

Add assertions covering the full local experience:

```js
await page.locator("#ai-question").fill("这个市场有哪些主要风险？");
await page.locator("#ai-submit").click();
await page.locator("#ai-result").getByText(/模拟来源/).waitFor();
assert.match(await page.locator("#ai-result").innerText(), /风险提示/);

await page.locator("#ai-question").fill("完全无法匹配的自定义问题");
await page.locator("#ai-submit").click();
await page.locator("#ai-result").getByText(/暂无对应数据/).waitFor();

await page.locator('[data-report-id="policy-tracker"]').click();
assert.match(await page.locator("#report-preview").innerText(), /政策追踪/);

await page.getByRole("button", { name: "EN" }).click();
await page.reload();
assert.equal(await page.locator("html").getAttribute("lang"), "en");

await page.setViewportSize({ width: 390, height: 844 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
assert.equal(overflow, false);
```

Add a static assertion rejecting `innerHTML` assignment from `#ai-question` values and rejecting any form `action` with an HTTP URL.

- [ ] **Step 2: Run tests and verify missing AI/report controls fail**

Run: `pnpm exec node --test showcase/navigator-demo.test.mjs`

Expected: FAIL because `#ai-question`, `#ai-submit`, and report controls are absent.

- [ ] **Step 3: Implement deterministic local AI simulation**

Add three localized prompt buttons for market opportunity, policy conditions, and risk. `matchDemoAnswer` must normalize the query and match a small bilingual keyword table. A match returns localized fictional analysis, fictional `.example` sources, fictional updated date, and localized risk notice. No match returns the localized demo no-data state.

On submit, set `aria-busy="true"`, render a localized analysis label, and complete after a short local timer. Place user text and answer content only with `textContent`. Keep the global disclaimer visible beside the result. Do not persist the query or answer.

- [ ] **Step 4: Implement report product preview**

Add three fictional report fixtures: `market-entry`, `policy-tracker`, and `opportunity-pipeline`. Each contains localized title, subtitle, contents list, three insights, delivery format, and a fictional date. Report selectors use `aria-pressed`; the preview updates without navigation. The action button reads “演示预览 / Demo preview” and never links to a file or endpoint.

- [ ] **Step 5: Finish responsive, reduced-motion, and no-script behavior**

Ensure the mobile layout stacks dashboard regions, permits local horizontal scrolling only for module/report selector rails, never causes page-level horizontal overflow, retains visible disclaimers, and preserves 44px minimum control height where practical. Add a bilingual `<noscript>` notice. Verify focus order follows DOM order and every icon-only visual is hidden from assistive technology or labelled.

- [ ] **Step 6: Run automated verification**

Run:

```bash
pnpm exec node --test showcase/navigator-demo.test.mjs
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all test suites PASS; lint and typecheck exit 0; `git diff --check` prints nothing.

- [ ] **Step 7: Capture desktop and mobile screenshots for visual review**

Use Playwright to open the file URL at `1440x1000` and `390x844`, capture full-page screenshots to a temporary directory outside the repository, and inspect both. Verify at least: first-viewport hierarchy, palette, typography, disclaimer visibility, dashboard density, module navigation, AI answer, report preview, mobile overflow, and English copy fit. Remove the temporary screenshots after review.

- [ ] **Step 8: Independent review and final commit**

Request an independent reviewer to inspect the full branch diff for data leakage, security, i18n alignment, accessibility, responsive behavior, and test adequacy. Address every confirmed issue and rerun Step 6.

Commit:

```bash
git add showcase/navigator-demo.html showcase/navigator-demo.test.mjs
git commit -m "feat: complete static showcase experience"
```

---

### Task 4: Merge, Push, and CI Confirmation

**Files:**
- No content changes expected.

**Interfaces:**
- Consumes: reviewed branch with all verification green.
- Produces: updated `main`, aligned local and remote SHA, successful GitHub Actions run.

- [ ] **Step 1: Verify branch readiness**

Run:

```bash
git status --short --branch
git log --oneline main..HEAD
git diff --check main...HEAD
```

Expected: clean branch, only the approved design/plan/showcase commits ahead of `main`, and no diff-check errors.

- [ ] **Step 2: Merge into main without rewriting history**

Switch to `main`, fast-forward merge `feat/static-showcase-demo`, and rerun the complete verification commands from Task 3 Step 6 on merged `main`. Do not force push, reset, delete branches, or modify unrelated work.

- [ ] **Step 3: Push and confirm CI**

Push `main` normally to `origin`. Confirm local `main`, `origin/main`, remote `main`, and the successful workflow `headSha` all match the merged commit. If CI fails, diagnose and fix it as a separate bounded correction before claiming completion.
