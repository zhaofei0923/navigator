import { expect, test } from "@playwright/test";

test("home page switches UI language from Chinese to English", async ({
  page,
}) => {
  await page.goto("/zh-CN");

  await expect(
    page.getByRole("heading", { name: "全球情报，更好的能源决策。" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "EN" }).click();

  await expect(page).toHaveURL(/\/en$/);
  await expect(
    page.getByRole("heading", {
      name: "Global intelligence. Better energy decisions.",
    }),
  ).toBeVisible();
});

test("country explorer filters coverage and keeps coverage badges visible", async ({
  page,
}) => {
  await page.goto("/en/countries");

  await expect(page.getByRole("heading", { name: "Country data explorer" })).toBeVisible();
  await expect(page.getByRole("article", { name: /Indonesia/ })).toContainText(
    "Basic",
  );
  await expect(page.getByRole("article", { name: /Indonesia/ })).toContainText(
    "Opportunity Data Building",
  );
  await expect(page.getByRole("article", { name: /Indonesia/ })).toContainText(
    "Risk Data Building",
  );
  const signalsPanel = page.locator(".country-side-panel");
  await expect(signalsPanel.getByText("Recommended priority")).toBeVisible();
  await expect(signalsPanel.getByText("Data Building", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Global renewable energy data map" }),
  ).toBeVisible();

  await page.getByLabel("Coverage").selectOption("BASIC");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/coverageLevel=BASIC/);
  await expect(page.getByRole("article", { name: /Indonesia/ })).toBeVisible();
  const vietnamCard = page.getByRole("article", { name: /Viet Nam/ });
  await expect(vietnamCard).toBeVisible();
  const saudiCard = page.getByRole("article", { name: /Saudi Arabia/ });
  await expect(saudiCard).toBeVisible();
  const uaeCard = page.getByRole("article", { name: /United Arab Emirates/ });
  await expect(uaeCard).toBeVisible();
  const brazilCard = page.getByRole("article", { name: /Brazil/ });
  await expect(brazilCard).toBeVisible();
  await expect(page.getByText("5 countries")).toBeVisible();

  await page.getByRole("link", { name: /Indonesia/ }).click();
  await expect(page).toHaveURL(/\/en\/countries\/ID/);
  await expect(
    page.getByRole("heading", { exact: true, name: "Indonesia" }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/countries/);
  expect(new URL(page.url()).searchParams.get("coverageLevel")).toBe("BASIC");
  await expect(vietnamCard).toBeVisible();
  await vietnamCard.getByRole("link", { name: /Viet Nam/ }).click();
  await expect(page).toHaveURL(/\/en\/countries\/VN/);
  await expect(
    page.getByRole("heading", { exact: true, name: "Viet Nam" }),
  ).toBeVisible();
});

test("Vietnam Basic detail renders in English and Chinese without enabling AI", async ({
  page,
}) => {
  await page.goto("/en/countries/VN");

  await expect(page.getByRole("heading", { exact: true, name: "Viet Nam" })).toBeVisible();
  await expect(page.getByText(/Total installed capacity was 82,387 MW/)).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/VN/);
  await expect(page.getByRole("heading", { exact: true, name: "越南" })).toBeVisible();
  await expect(page.getByText(/总装机容量为82,387兆瓦/)).toBeVisible();
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
});

test("Saudi Basic detail renders in English and Chinese without enabling AI", async ({
  page,
}) => {
  await page.goto("/en/countries/SA");

  await expect(
    page.getByRole("heading", { exact: true, name: "Saudi Arabia" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "Saudi Arabia" })
      .locator("..")
      .getByText(/approximately 92.5 GW/),
  ).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/SA/);
  await expect(
    page.getByRole("heading", { exact: true, name: "沙特阿拉伯" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "沙特阿拉伯" })
      .locator("..")
      .getByText(/约为92.5吉瓦/),
  ).toBeVisible();
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
});

test("UAE Basic detail renders in English and Chinese without enabling AI", async ({
  page,
}) => {
  await page.goto("/en/countries/AE");

  await expect(
    page.getByRole("heading", { exact: true, name: "United Arab Emirates" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "United Arab Emirates" })
      .locator("..")
      .getByText(/generates 40 TWh per year/),
  ).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/AE/);
  await expect(
    page.getByRole("heading", { exact: true, name: "阿拉伯联合酋长国" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "阿拉伯联合酋长国" })
      .locator("..")
      .getByText(/每年发电40太瓦时/),
  ).toBeVisible();
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
});

test("Brazil Basic detail renders in English and Chinese without enabling AI", async ({
  page,
}) => {
  await page.goto("/en/countries/BR");

  await expect(
    page.getByRole("heading", { exact: true, name: "Brazil" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "Brazil" })
      .locator("..")
      .getByText(/final electricity consumption grew 2.7% year on year in 2025/i),
  ).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/BR/);
  await expect(
    page.getByRole("heading", { exact: true, name: "巴西" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "巴西" })
      .locator("..")
      .getByText(/2025年最终电力消费同比增长2.7%/),
  ).toBeVisible();
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
});

test("country explorer switches UI language on the same route", async ({
  page,
}) => {
  await page.goto("/en/countries?coverageLevel=BASIC");

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\?coverageLevel=BASIC/);
  await expect(page.getByRole("heading", { name: "国家数据浏览器" })).toBeVisible();
});

test("country detail renders ten module skeleton and switches language", async ({
  page,
}) => {
  await page.goto("/en/countries/ID");
  const main = page.locator("main");

  await expect(
    page.getByRole("heading", { exact: true, name: "Indonesia" }),
  ).toBeVisible();
  await expect(page.getByText("1/10 modules")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Country modules" })).toContainText(
    "Market overview",
  );
  await expect(page.getByRole("heading", { name: "Market overview" })).toBeVisible();
  await expect(
    page.getByText(/Installed renewable capacity reached 15,630 MW/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "AI Advisor" }),
  ).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);
  const englishVisibleText = await main.innerText();
  expect(englishVisibleText).not.toContain("id_pol_001");
  expect(englishVisibleText).not.toContain("id_know_001");
  expect(englishVisibleText).not.toContain("Internal sample data");

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/ID/);
  await expect(
    page.getByRole("heading", { exact: true, name: "印度尼西亚" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "市场概览" })).toBeVisible();
  await expect(page.getByText(/可再生能源装机达到15,630兆瓦/)).toBeVisible();
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
  const chineseVisibleText = await main.innerText();
  expect(chineseVisibleText).not.toContain("id_pol_001");
  expect(chineseVisibleText).not.toContain("id_know_001");
  expect(chineseVisibleText).not.toContain("内部样板数据");
});
