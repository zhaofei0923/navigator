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

test("keeps language control labels and navigation names in sync", async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(demoUrl);
  assert.equal(await page.locator("nav").getAttribute("aria-label"), "主导航");
  await page.getByRole("button", { name: "EN" }).click();
  assert.equal(await page.locator("nav").getAttribute("aria-label"), "Primary navigation");
});
