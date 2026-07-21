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
  assert.doesNotMatch(source, /<a[^>]+href=["']https?:/i);
  assert.doesNotMatch(source, /<a[^>]*href=["']\$\{escapeHtml\(market\.source\.url\)\}["']/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /<form\b[^>]*\baction\s*=\s*(?:(?:["'])?\s*https?:\/\/|(?:["'])?\s*\/\/)/i);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*(?:#ai-question|aiQuestion|activeAiQuestion|input\.value|question\.value)/i);
  assert.match(source, /DEMO_FIXTURES/);
  assert.match(source, /虚构演示数据/);
  assert.match(source, /Fictional demo data/);
  for (const coverage of ["BASIC", "STANDARD", "COMPLETE"]) assert.match(source, new RegExp(coverage));
  for (const moduleKey of ["market-overview", "policy", "risk", "opportunities", "projects", "partners", "chinese-companies", "entry-strategy", "ai-advisor", "reports"]) assert.match(source, new RegExp(moduleKey));
});

test("keeps fictional market coverage aligned with the three aggregation levels", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  const fixtures = await page.evaluate(() => ({
    moduleKeys: MODULES.map(({ key }) => key),
    markets: DEMO_FIXTURES.markets.map(({ id, coverage, modules }) => ({
      id,
      coverage,
      statuses: Object.fromEntries(Object.entries(modules).map(([key, value]) => [key, value.status])),
    })),
  }));
  const expectedModuleKeys = ["market-overview", "policy", "risk", "opportunities", "projects", "partners", "chinese-companies", "entry-strategy", "ai-advisor", "reports"];
  assert.deepEqual(fixtures.moduleKeys, expectedModuleKeys);

  const aurora = fixtures.markets.find(({ id }) => id === "aurora");
  assert.equal(aurora.coverage, "BASIC");
  assert.ok(["PARTIAL", "COMPLETE"].includes(aurora.statuses["market-overview"]));
  assert.deepEqual(
    Object.fromEntries(expectedModuleKeys.filter((key) => key !== "market-overview").map((key) => [key, aurora.statuses[key]])),
    Object.fromEntries(expectedModuleKeys.filter((key) => key !== "market-overview").map((key) => [key, "BUILDING"])),
  );

  const meridian = fixtures.markets.find(({ id }) => id === "meridian");
  assert.equal(meridian.coverage, "STANDARD");
  for (const key of ["market-overview", "policy", "risk", "opportunities", "ai-advisor"]) {
    assert.ok(["PARTIAL", "COMPLETE"].includes(meridian.statuses[key]), `${key} must be at least partial`);
  }
  for (const key of ["projects", "partners", "chinese-companies", "entry-strategy", "reports"]) {
    assert.ok(["BUILDING", "PARTIAL"].includes(meridian.statuses[key]), `${key} must remain a deeper standard module`);
  }

  const solstice = fixtures.markets.find(({ id }) => id === "solstice");
  assert.equal(solstice.coverage, "COMPLETE");
  assert.deepEqual(solstice.statuses, Object.fromEntries(expectedModuleKeys.map((key) => [key, "COMPLETE"])));
});

test("gates deterministic AI answers by the selected market AI coverage", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  await page.locator("#ai-question").fill("这个市场有哪些主要风险？");
  await page.locator("#ai-submit").click();
  await page.waitForTimeout(250);
  const auroraAnswer = await page.locator("#ai-result").innerText();
  assert.match(auroraAnswer, /数据建设中/);
  assert.doesNotMatch(auroraAnswer, /冬季施工窗口短/);
  assert.doesNotMatch(auroraAnswer, /模拟来源/);

  await page.locator('[data-market-id="meridian"]').click();
  await page.locator("#ai-question").fill("这个市场有哪些主要风险？");
  await page.locator("#ai-submit").click();
  await page.locator("#ai-result").getByText(/模拟来源/).waitFor();
  assert.match(await page.locator("#ai-result").innerText(), /并网规则仍在模拟调整/);
});

test("simulates matched and no-data AI answers without persisting user content", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  await page.locator('[data-market-id="meridian"]').click();
  assert.equal(await page.locator("[data-prompt-id]").count(), 3);
  assert.deepEqual(await page.evaluate(() => [typeof matchDemoAnswer, typeof renderAiAnswer]), ["function", "function"]);
  await page.locator('[data-prompt-id="risk"]').click();
  assert.match(await page.locator("#ai-question").inputValue(), /风险/);
  await page.locator("#ai-question").fill("这个市场有哪些主要风险？");
  await page.locator("#ai-submit").click();
  assert.equal(await page.locator("#ai-result").getAttribute("aria-busy"), "true");
  await page.locator("#ai-result").getByText(/模拟来源/).waitFor();
  const matchedAnswer = await page.locator("#ai-result").innerText();
  assert.match(matchedAnswer, /风险提示/);
  assert.match(matchedAnswer, /更新时间/);
  assert.match(matchedAnswer, /\.example/);
  assert.equal(await page.locator("#ai-result").getAttribute("aria-busy"), "false");

  await page.locator("#ai-question").fill("完全无法匹配的自定义问题");
  await page.locator("#ai-submit").click();
  await page.locator("#ai-result").getByText(/暂无对应数据/).waitFor();
  const storageSnapshot = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const allowedStorageKeys = ["navigator-demo-locale", "navigator-demo-market-id", "navigator-demo-module-key", "navigator-demo-report-id"];
  assert.equal(Object.keys(storageSnapshot.local).every((key) => allowedStorageKeys.includes(key)), true);
  assert.equal(Object.keys(storageSnapshot.session).length, 0);
  assert.equal(Object.values(storageSnapshot.local).some((value) => value.includes("完全无法匹配的自定义问题") || value.includes("这个市场有哪些主要风险")), false);
  await page.reload();
  assert.equal(await page.locator("#ai-question").inputValue(), "");
  assert.doesNotMatch(await page.locator("#ai-result").innerText(), /完全无法匹配的自定义问题/);
});

test("keeps a pending AI request busy and bound to its submitted market", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  await page.locator('[data-market-id="meridian"]').click();

  const busyAfterRerenders = await page.evaluate(() => {
    document.querySelector("#ai-question").value = "这个市场有哪些主要风险？";
    document.querySelector("#ai-submit").click();
    document.querySelector('[data-action="set-locale"][data-locale="en"]').click();
    document.querySelector('[data-market-id="solstice"]').click();
    return document.querySelector("#ai-result").getAttribute("aria-busy");
  });
  assert.equal(busyAfterRerenders, "true");
  await page.locator("#ai-result").getByText(/Simulated source/).waitFor();
  const answer = await page.locator("#ai-result").innerText();
  assert.match(answer, /Meridian Market Fictional Observatory/);
  assert.doesNotMatch(answer, /Solstice Market Fictional Observatory/);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
});

test("wraps a long unbroken AI query without mobile page overflow", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const query = "x".repeat(600);
  await page.goto(demoUrl);

  await page.locator('[data-market-id="meridian"]').click();
  await page.locator("#ai-question").fill(query);
  await page.locator("#ai-submit").click();
  await page.locator("#ai-result").getByText(/暂无对应数据/).waitFor();
  assert.match(await page.locator("#ai-result").innerText(), new RegExp(query));
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(viewport.scrollWidth, viewport.clientWidth);
});

test("previews fictional reports and keeps the selected locale across reloads", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  assert.deepEqual(await page.evaluate(() => [typeof selectReport, typeof renderReport]), ["function", "function"]);
  assert.equal(await page.locator("[data-report-id]").count(), 3);
  await page.locator('[data-report-id="policy-tracker"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-report-id="policy-tracker"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-report-id="policy-tracker"]').evaluate((element) => document.activeElement === element), true);
  assert.match(await page.locator("#report-preview").innerText(), /政策追踪/);
  assert.equal(await page.locator("#report-preview a").count(), 0);
  assert.match(await page.getByRole("button", { name: "演示预览" }).innerText(), /演示预览/);

  await page.getByRole("button", { name: "EN" }).click();
  assert.match(await page.locator("#report-preview").innerText(), /Policy tracker/);
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.match(await page.locator("#report-preview").innerText(), /Policy tracker/);
  assert.match(await page.getByRole("button", { name: "Demo preview" }).innerText(), /Demo preview/);
});

test("stacks the mobile experience without page-level horizontal overflow", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(demoUrl);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false);
  const dashboardBounds = await page.locator("#dashboard").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { right: Math.round(rect.right), width: Math.round(rect.width), viewportWidth: window.innerWidth };
  });
  assert.ok(dashboardBounds.right <= dashboardBounds.viewportWidth);
  assert.ok(dashboardBounds.width <= dashboardBounds.viewportWidth);
  const horizontalScrollers = await page.evaluate(() => [...document.querySelectorAll("*")].filter((element) => {
    const overflowX = getComputedStyle(element).overflowX;
    return ["auto", "scroll"].includes(overflowX) && element.scrollWidth > element.clientWidth;
  }).map((element) => element.id || element.className));
  assert.equal(horizontalScrollers.every((identifier) => identifier === "report-selectors" || identifier === "module-nav"), true);
  assert.equal(await page.locator("#ai-advisor .demo-note").isVisible(), true);
  assert.equal(await page.locator("#reports .demo-note").isVisible(), true);
  const controlHeights = await page.locator("a:not(.skip-link), button, select, input").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  assert.equal(controlHeights.every((height) => height >= 44), true);
});

test("does not serialize an AI question when JavaScript is disabled", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(demoUrl);

  assert.match(await page.locator("main").innerText(), /出海决策/);
  assert.match(await page.locator("noscript").innerText(), /请启用 JavaScript.*Enable JavaScript/);
  const initialUrl = page.url();
  const initialHistoryLength = await page.evaluate(() => history.length);
  await page.locator("#ai-question").fill("private-demo-question");
  await page.locator("#ai-submit").evaluate((element) => element.click());
  await page.waitForTimeout(250);
  assert.equal(page.url(), initialUrl);
  assert.equal(await page.evaluate(() => history.length), initialHistoryLength);
  assert.doesNotMatch(page.url(), /private-demo-question/);
});

test("ignores composing Enter before submitting an ordinary Enter", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);
  await page.locator('[data-market-id="meridian"]').click();

  const input = page.locator("#ai-question");
  const result = page.locator("#ai-result");
  const initialResult = await result.innerText();
  await input.fill("这个市场有哪些主要风险？");
  await input.dispatchEvent("compositionstart", { data: "风险" });
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
  await input.dispatchEvent("compositionend", { data: "风险" });

  assert.equal(await result.getAttribute("aria-busy"), "false");
  assert.equal(await result.innerText(), initialResult);

  await input.press("Enter");
  assert.equal(await result.getAttribute("aria-busy"), "true");
  await result.getByText(/模拟来源/).waitFor();
  assert.equal(await result.getAttribute("aria-busy"), "false");
});

test("restores logical keyboard focus after workbench rerenders", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);

  const regionFilter = page.locator("#region-filter");
  await regionFilter.focus();
  await regionFilter.selectOption("central-corridor");
  assert.equal(await page.locator("#region-filter").evaluate((element) => document.activeElement === element), true);

  const market = page.locator('[data-market-id="meridian"]');
  await market.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-market-id="meridian"]').evaluate((element) => document.activeElement === element), true);

  const module = page.locator('[data-module-key="policy"]');
  await module.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-module-key="policy"]').evaluate((element) => document.activeElement === element), true);

  const reset = page.locator('[data-action="reset-filters"]').first();
  await reset.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-action="reset-filters"]').first().evaluate((element) => document.activeElement === element), true);
});

test("renders the bilingual narrative shell from a file URL", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const networkRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
  });
  await page.goto(demoUrl);
  await assert.doesNotReject(() => page.locator("h1").waitFor());
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  assert.match(await page.locator("h1").innerText(), /出海决策/);
  await page.getByRole("button", { name: "EN" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.match(await page.locator("h1").innerText(), /market intelligence/i);
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
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(networkRequests, []);
});

test("keeps language control labels and navigation names in sync", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);
  const copyKeys = await page.evaluate(() => [Object.keys(COPY["zh-CN"]).sort(), Object.keys(COPY.en).sort()]);
  assert.deepEqual(copyKeys[0], copyKeys[1]);
  assert.equal(await page.locator("nav").getAttribute("aria-label"), "主导航");
  assert.equal(await page.locator(".locale-switcher").getAttribute("aria-label"), "语言选择");
  assert.equal(await page.locator(".intelligence-visual").getAttribute("aria-label"), "抽象全球能源情报图");
  assert.equal(await page.getByRole("button", { name: "中文" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "EN" }).click();
  assert.equal(await page.locator("nav").getAttribute("aria-label"), "Primary navigation");
  assert.equal(await page.locator(".locale-switcher").getAttribute("aria-label"), "Language selection");
  assert.equal(await page.locator(".intelligence-visual").getAttribute("aria-label"), "Abstract global energy intelligence visual");
  assert.equal(await page.locator('[data-action="set-locale"][data-locale="en"]').getAttribute("aria-pressed"), "true");
});

test("keeps fictional source provenance inert and localizes business content", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);
  const provenance = page.locator("#module-panel .metadata");
  assert.equal(await provenance.locator("a").count(), 0);
  assert.match(await provenance.innerText(), /极光市场虚构观察站.*aurora-observatory\.example/);
  assert.match(await page.locator(".metric-grid").innerText(), /12周/);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  assert.match(await provenance.innerText(), /Aurora Market Fictional Observatory.*aurora-observatory\.example/);
  assert.match(await page.locator(".metric-grid").innerText(), /12wk/);
  assert.doesNotMatch(await page.locator(".metric-grid").innerText(), /周/);
});
