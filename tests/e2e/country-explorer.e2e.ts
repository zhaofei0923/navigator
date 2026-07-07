import { expect, test } from "@playwright/test";

test("country explorer filters coverage and keeps coverage badges visible", async ({
  page,
}) => {
  await page.goto("/en/countries");

  await expect(page.getByRole("heading", { name: "Country data explorer" })).toBeVisible();
  await expect(page.getByRole("article", { name: /Indonesia/ })).toContainText(
    "Complete",
  );
  await expect(
    page.getByRole("img", { name: "Global renewable energy data map" }),
  ).toBeVisible();

  await page.getByLabel("Coverage").selectOption("COMPLETE");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/coverageLevel=COMPLETE/);
  await expect(page.getByRole("article", { name: /Indonesia/ })).toBeVisible();
  await expect(page.getByText("1 country")).toBeVisible();

  await page.getByRole("link", { name: /Indonesia/ }).click();
  await expect(page).toHaveURL(/\/en\/countries\/ID/);
  await expect(
    page.getByRole("heading", { exact: true, name: "Indonesia" }),
  ).toBeVisible();
});

test("country explorer switches UI language on the same route", async ({
  page,
}) => {
  await page.goto("/en/countries?coverageLevel=COMPLETE");

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\?coverageLevel=COMPLETE/);
  await expect(page.getByRole("heading", { name: "国家数据浏览器" })).toBeVisible();
});

test("country detail renders ten module skeleton and switches language", async ({
  page,
}) => {
  await page.goto("/en/countries/ID");

  await expect(
    page.getByRole("heading", { exact: true, name: "Indonesia" }),
  ).toBeVisible();
  await expect(page.getByText("10/10 modules")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Country modules" })).toContainText(
    "Market overview",
  );
  await expect(page.getByRole("heading", { name: "Market overview" })).toBeVisible();
  await expect(page.getByText("Renewable power procurement framework")).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "C&I rooftop solar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "AI Advisor" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/ID/);
  await expect(
    page.getByRole("heading", { exact: true, name: "印度尼西亚" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "市场概览" })).toBeVisible();
});
