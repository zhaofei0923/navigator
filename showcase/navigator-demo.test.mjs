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
  for (const coverage of ["BASIC", "STANDARD", "COMPLETE"]) assert.match(source, new RegExp(coverage));
  for (const moduleKey of ["market-overview", "policy", "risk", "opportunities", "projects", "partners", "chinese-companies", "entry-strategy", "ai-advisor", "reports"]) assert.match(source, new RegExp(moduleKey));
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
});

test("keeps language control labels and navigation names in sync", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);
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
