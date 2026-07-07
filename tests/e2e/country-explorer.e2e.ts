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
  await expect(page.getByRole("link", { name: /Indonesia/ })).toHaveCount(0);

  await page.getByLabel("Coverage").selectOption("COMPLETE");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/coverageLevel=COMPLETE/);
  await expect(page.getByRole("article", { name: /Indonesia/ })).toBeVisible();
  await expect(page.getByText("1 country")).toBeVisible();
});

test("country explorer switches UI language on the same route", async ({
  page,
}) => {
  await page.goto("/en/countries?coverageLevel=COMPLETE");

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\?coverageLevel=COMPLETE/);
  await expect(page.getByRole("heading", { name: "国家数据浏览器" })).toBeVisible();
});
