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
  const southAfricaCard = page.getByRole("article", { name: /South Africa/ });
  await expect(southAfricaCard).toBeVisible();
  await expect(page.getByText("6 countries")).toBeVisible();

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

test("South Africa Basic detail renders in English and Chinese without enabling AI", async ({
  page,
}) => {
  await page.goto("/en/countries/ZA");

  await expect(
    page.getByRole("heading", { exact: true, name: "South Africa" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "South Africa" })
      .locator("..")
      .getByText(/195,702 GWh of Eskom-only energy sent out/),
  ).toBeVisible();
  await expect(page.getByText("Data Building", { exact: true })).toHaveCount(9);

  await page.getByRole("link", { name: "zh-CN" }).click();

  await expect(page).toHaveURL(/\/zh-CN\/countries\/ZA/);
  await expect(
    page.getByRole("heading", { exact: true, name: "南非" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("heading", { exact: true, name: "南非" })
      .locator("..")
      .getByText(/Eskom口径送出电量为195,702吉瓦时/),
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
    page.getByText(
      "Energy and mineral investment reached USD 31.7 billion in 2025, including USD 4.6 billion in electricity and USD 2.4 billion in renewables and conservation.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "BASIC data profile" }),
  ).toBeVisible();
  const profile = page.locator(".basic-profile");
  await expect(profile.locator(".basic-profile-category")).toHaveCount(8);
  for (const categoryHeading of [
    "Country basics",
    "Electricity market",
    "Energy access",
    "Renewable capacity",
    "Solar resource",
    "Wind resource",
    "Policy overview",
    "Market summary",
  ]) {
    await expect(
      profile.getByRole("heading", { exact: true, name: categoryHeading }),
    ).toBeVisible();
  }
  await expect(page.getByText("285,721,236", { exact: true })).toBeVisible();
  await expect(page.getByText("5,059.63", { exact: true })).toBeVisible();
  await expect(page.getByText("99.9", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Indonesia National Electricity General Plan/,
    }).first(),
  ).toHaveAttribute(
    "href",
    "https://www.iea.org/policies/30494-national-electricity-general-plan",
  );
  const profileGrid = page.locator(".basic-profile-categories");
  const desktopColumnCount = await profileGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").length,
  );
  expect(desktopColumnCount).toBe(2);
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
  await expect(
    page.getByText(
      "2025年能源与矿产领域投资为317亿美元，其中电力46亿美元、可再生能源与节能24亿美元。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "BASIC 八类数据" }),
  ).toBeVisible();
  await expect(profile.locator(".basic-profile-category")).toHaveCount(8);
  for (const categoryHeading of [
    "国家基础",
    "电力市场",
    "能源可及性",
    "可再生能源装机",
    "太阳能资源",
    "风能资源",
    "政策概览",
    "市场摘要",
  ]) {
    await expect(
      profile.getByRole("heading", { exact: true, name: categoryHeading }),
    ).toBeVisible();
  }
  await expect(
    profile.locator("strong:visible", { hasText: /^暂无数据$/ }),
  ).toHaveCount(14);
  await expect(
    page.getByRole("link", { name: /印尼国家电力总规划/ }).first(),
  ).toHaveAttribute(
    "href",
    "https://www.iea.org/policies/30494-national-electricity-general-plan",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "BASIC 八类数据" }),
  ).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  const mobileColumnCount = await page.locator(".basic-profile-categories")
    .evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(mobileColumnCount).toBe(1);
  await expect(page.getByText("数据建设中", { exact: true })).toHaveCount(9);
  const chineseVisibleText = await main.innerText();
  expect(chineseVisibleText).not.toContain("id_pol_001");
  expect(chineseVisibleText).not.toContain("id_know_001");
  expect(chineseVisibleText).not.toContain("内部样板数据");
});
