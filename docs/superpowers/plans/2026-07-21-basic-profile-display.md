# BASIC Profile Country Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the published localized `basic-market-profile/v2` and concrete sources inside compatible country detail pages.

**Architecture:** Add one country-neutral server component that narrows the localized JSON returned by the existing module API, then renders all eight BASIC categories. `CountryDetail` only delegates `item.basicProfile`; API, database, publications, coverage logic, and AI boundaries stay unchanged.

**Tech Stack:** TypeScript strict mode, React 19, Next.js App Router, next-intl, CSS grid, Vitest, Playwright, pnpm.

## Global Constraints

- Keep the ten modules unchanged; Profile stays inside `market-overview`.
- Render all eight categories in contract order and all `NOT_AVAILABLE` evidence.
- Put fixed UI labels in both locale files with identical keys.
- Consume API JSON only; Web must not import canonical or staging files.
- A missing/malformed Profile must not break the legacy overview.
- Do not change Prisma, API contracts, publications, coverage, `aiUsable`, dependencies, permissions, or technology stack.

---

### Task 1: Build and integrate the BASIC Profile renderer

**Files:**
- Create: `apps/web/src/features/countries/basic-profile.tsx`
- Create: `apps/web/src/features/countries/basic-profile.test.tsx`
- Modify: `apps/web/src/features/countries/country-detail.tsx`
- Modify: `apps/web/src/features/countries/country-detail.test.tsx`
- Modify: `apps/web/src/i18n/messages.test.ts`
- Modify: `apps/web/locales/zh-CN.json`
- Modify: `apps/web/locales/en.json`

**Interfaces:**
- Consumes: `ModuleResponseRecord["basicProfile"]`, `Locale`, `BASIC_PROFILE_CATEGORY_KEYS`, `BASIC_PROFILE_REQUIRED_FIELD_KEYS`, `CREDIBILITIES`, and `REGIONS`.
- Produces: `BasicProfileSection({ profileValue, locale }): React.ReactNode`.
- Produces internally: `parseLocalizedBasicProfile(value: unknown): LocalizedBasicProfile | null`.

- [ ] **Step 1: Write failing r3 page assertions**

Extend the Chinese `country-detail.test.tsx` case:

```tsx
expect(html).toContain("BASIC 八类数据");
for (const label of [
  "国家基础", "电力市场", "能源可及性", "可再生能源装机",
  "太阳能资源", "风能资源", "政策概览", "市场摘要",
]) expect(html).toContain(label);
expect(html).toContain("285,721,236");
expect(html).toContain("5,059.63");
expect(html).toContain("99.9");
expect(html).toContain("暂无数据");
expect(html).toContain("未提供已审核的Ember不可变标准化快照");
expect(html).toContain("印尼国家电力总规划");
expect(html).toContain(
  'href="https://www.iea.org/policies/30494-national-electricity-general-plan"',
);
```

Add equivalent English assertions for `BASIC data profile`, `Country basics`,
`Electricity market`, `Energy access`, `Not available`, the English Ember reason,
and the IEA URL.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @navigator/web test -- src/features/countries/country-detail.test.tsx
```

Expected: FAIL because the current component ignores `basicProfile`.

- [ ] **Step 3: Add exact bilingual message subtrees**

Add `countries.detail.basicProfile` with identical keys. Chinese:

```json
{
  "title": "BASIC 八类数据",
  "description": "按统一 BASIC 数据结构展示已审核字段、缺失说明和具体来源。",
  "updated": "Profile 更新于 {date}",
  "available": "可用",
  "notAvailable": "暂无数据",
  "checkedAt": "核查于 {date}",
  "year": "数据年份 {year}",
  "sources": "具体来源",
  "sourceDirectory": "来源目录",
  "retrievedAt": "获取于 {date}",
  "publishedAt": "发布于 {date}",
  "categories": {
    "countryBasics": "国家基础",
    "electricityMarket": "电力市场",
    "energyAccess": "能源可及性",
    "renewableCapacity": "可再生能源装机",
    "solarResource": "太阳能资源",
    "windResource": "风能资源",
    "policyOverview": "政策概览",
    "marketSummary": "市场摘要"
  },
  "credibility": {
    "OFFICIAL": "官方",
    "VERIFIED": "已核验",
    "ESTIMATED": "估算",
    "UNVERIFIED": "未核验"
  }
}
```

English values: `BASIC data profile`; `Reviewed fields, unavailable-data explanations, and concrete sources in the unified BASIC structure.`; `Profile updated {date}`; `Available`; `Not available`; `Checked {date}`; `Data year {year}`; `Sources`; `Source directory`; `Retrieved {date}`; `Published {date}`. Category labels are `Country basics`, `Electricity market`, `Energy access`, `Renewable capacity`, `Solar resource`, `Wind resource`, `Policy overview`, `Market summary`. Credibility labels are `Official`, `Verified`, `Estimated`, `Unverified`.

Extend `fixedKeys` in `messages.test.ts` with title, all eight categories, and all four credibility keys.

- [ ] **Step 4: Write a failing renderer test**

Use `buildCountryModuleResponse("ID", "market-overview", { locale })` and render
`BasicProfileSection` in `NextIntlClientProvider`:

```tsx
expect(chinese).toContain("通电率");
expect(chinese).toContain("99.9");
expect(chinese).toContain("暂无数据");
expect(chinese).toContain("核查于");
expect(chinese).toContain("World Bank");
expect(chinese).toContain('target="_blank"');
expect(english).toContain("Access to electricity");
expect(english).toContain("Not available");
expect(renderProfile(undefined, "en")).toBe("");
expect(
  renderProfile({ schemaVersion: "basic-market-profile/v1" }, "en"),
).toBe("");
```

Run this file and confirm RED because the component does not exist.

- [ ] **Step 5: Implement strict localized JSON narrowing**

Define these local shapes in `basic-profile.tsx`:

```tsx
interface LocalizedBasicProfileField {
  key: string;
  label: string;
  status: "AVAILABLE" | "NOT_AVAILABLE";
  value: number | string | null;
  unit: string | null;
  year: number | null;
  sourceIds: readonly string[];
  checkedAt: string;
  reason: string | null;
  note: string | null;
}

interface LocalizedBasicProfileSource {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  credibility: (typeof CREDIBILITIES)[number];
}

interface LocalizedBasicProfile {
  categories: Readonly<Record<
    BasicProfileCategoryKey,
    { fields: readonly LocalizedBasicProfileField[] }
  >>;
  sources: readonly LocalizedBasicProfileSource[];
  updatedAt: string;
}
```

`parseLocalizedBasicProfile` requires schema `basic-market-profile/v2`; every
fixed category and required field exactly once; known unique source IDs; known
credibility; HTTP(S) URLs; valid statuses; `AVAILABLE` with number/non-empty
string value and null reason; `NOT_AVAILABLE` with null value/unit/year and a
non-empty reason. Return `null` for any mismatch. Use small helpers and no `any`.

- [ ] **Step 6: Render fixed-order categories and sources**

The top-level structure is:

```tsx
export function BasicProfileSection({ profileValue, locale }: Props) {
  const profile = parseLocalizedBasicProfile(profileValue);
  const t = useTranslations("countries.detail.basicProfile");
  const regionLabels = useTranslations("countryMeta.region");
  if (profile === null) return null;

  const sourceById = new Map(
    profile.sources.map((source) => [source.id, source]),
  );

  return (
    <section className="basic-profile" aria-labelledby="basic-profile-title">
      <header className="basic-profile-header">
        <div>
          <h3 id="basic-profile-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <span>{t("updated", {
          date: formatProfileDate(profile.updatedAt, locale),
        })}</span>
      </header>
      <div className="basic-profile-categories">
        {BASIC_PROFILE_CATEGORY_KEYS.map((categoryKey) => (
          <section className="basic-profile-category" key={categoryKey}>
            <h4>{t("categories." + categoryKey)}</h4>
            <dl>{profile.categories[categoryKey].fields.map((field) => (
              <BasicProfileFieldRow
                field={field}
                key={field.key}
                locale={locale}
                regionLabels={regionLabels}
                sourceById={sourceById}
              />
            ))}</dl>
          </section>
        ))}
      </div>
      <BasicProfileSourceDirectory
        locale={locale}
        sources={profile.sources}
      />
    </section>
  );
}
```

Field rows group integer numbers, show decimals with at most two fraction digits,
translate known `region` values with existing i18n, and show status/value, unit,
year, check date, note/reason, and every referenced source. Links use:

```tsx
<a href={source.url} rel="noreferrer noopener" target="_blank">
  {source.title} · {source.publisher}
</a>
```

The source directory shows title, publisher, localized credibility, retrieved
date, optional published date, and the same safe link attributes.

- [ ] **Step 7: Integrate and cover legacy null behavior**

Append after the old indicator grid in `ObjectModuleBody`:

```tsx
<BasicProfileSection
  locale={locale}
  profileValue={item.basicProfile}
/>
```

Add a test with `basicProfile: null` that keeps the old overview visible and
omits `BASIC data profile`. Do not change module counts or BUILDING placeholders.

- [ ] **Step 8: Verify GREEN and commit**

```bash
pnpm --filter @navigator/web test -- \
  src/features/countries/basic-profile.test.tsx \
  src/features/countries/country-detail.test.tsx \
  src/i18n/messages.test.ts
pnpm --filter @navigator/web typecheck
git diff --check
```

Expected: selected tests pass, typecheck passes, diff check is silent.

```bash
git add apps/web/src/features/countries/basic-profile.tsx \
  apps/web/src/features/countries/basic-profile.test.tsx \
  apps/web/src/features/countries/country-detail.tsx \
  apps/web/src/features/countries/country-detail.test.tsx \
  apps/web/src/i18n/messages.test.ts \
  apps/web/locales/zh-CN.json apps/web/locales/en.json
git commit -m "feat(web): render BASIC country profile"
```

---

### Task 2: Add responsive CSS and full-stack acceptance coverage

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `tests/e2e/country-explorer.e2e.ts`

**Interfaces:**
- Consumes: `.basic-profile*` classes and headings from Task 1.
- Produces: two-column desktop / one-column mobile layout and E2E proof for r3 data, sources, and language switching.

- [ ] **Step 1: Add failing Playwright assertions**

Extend the existing Indonesian detail E2E:

```ts
await expect(
  page.getByRole("heading", { name: "BASIC data profile" }),
).toBeVisible();
await expect(
  page.getByRole("heading", { name: "Country basics" }),
).toBeVisible();
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
```

After switching language, assert `BASIC 八类数据`, `国家基础`, `政策概览`,
`暂无数据`, and the `印尼国家电力总规划` source link. Then add a computed-style
assertion that is guaranteed to fail before the responsive CSS exists:

```ts
const profileGrid = page.locator(".basic-profile-categories");
const desktopColumnCount = await profileGrid.evaluate((element) =>
  getComputedStyle(element).gridTemplateColumns.split(" ").length
);
expect(desktopColumnCount).toBe(2);
```

Run E2E and verify RED with `desktopColumnCount` equal to `1` before Step 2.

- [ ] **Step 2: Add focused responsive styles**

Add a bordered `.basic-profile` grid, flex header, two-column category grid,
bordered category/source cards, separated definition rows, blue available values,
amber unavailable status, and wrapping source links.

```css
.basic-profile-categories {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.basic-profile-source-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.basic-profile-source-links a,
.basic-profile-source-item a {
  color: #0057d8;
  overflow-wrap: anywhere;
}
```

Inside existing `@media (max-width: 640px)`:

```css
.basic-profile-header {
  flex-direction: column;
}

.basic-profile-categories {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 3: Add mobile overflow acceptance**

```ts
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
    getComputedStyle(element).gridTemplateColumns.split(" ").length
  );
expect(mobileColumnCount).toBe(1);
```

- [ ] **Step 4: Verify and commit**

Use temporary E2E runner/config copies outside the repository with Web `33000`,
API `33100`, and metrics `39464` because the showcase owns `3000/3100`. Do not
edit tracked config just to change ports.

```bash
pnpm --filter @navigator/web lint
pnpm --filter @navigator/web typecheck
pnpm --filter @navigator/web test
pnpm test:e2e
git diff --check
```

Expected: all Web tests and full E2E pass with no overflow.

```bash
git add apps/web/src/app/globals.css tests/e2e/country-explorer.e2e.ts
git commit -m "test(web): verify BASIC profile presentation"
```

---

### Task 3: Review, verify, merge, and refresh the showcase

**Files:**
- Review: all files in `main...fix/basic-profile-display`
- Runtime logs only: `/tmp/navigator-showcase-api.log` and `/tmp/navigator-showcase-web.log`

**Interfaces:**
- Consumes: reviewed Tasks 1-2 plus Docker PostgreSQL.
- Produces: clean `main`, rebuilt host API/Web, live r3 evidence, pushed SHA, and successful matching CI.

- [ ] **Step 1: Review the complete diff**

Check exact category order, no country conditionals, strict unknown narrowing,
safe links, i18n parity, null compatibility, concrete sources, and no
canonical/database/AI mutations. Fix findings with failing regression tests.

- [ ] **Step 2: Run fresh verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm --filter @navigator/db prisma:validate
git diff --check main...HEAD
git status --short --branch
```

Expected: every command passes and worktree is clean.

- [ ] **Step 3: Fast-forward merge without deleting the branch**

```bash
cd /home/kevin/navigator
git switch main
git status --short --branch
git merge --ff-only fix/basic-profile-display
```

Do not delete the feature branch without explicit authorization.

- [ ] **Step 4: Rebuild and restart only host API/Web**

Reuse the showcase `DATABASE_URL`, verify both migrations, build API/Web, resolve
the exact current showcase PIDs and commands, stop only those processes, then
start replacements on `127.0.0.1:3100` and `127.0.0.1:3000`. Preserve
`navigator-local-showcase-postgres` and never reset/drop/truncate/recreate it.

- [ ] **Step 5: Verify the live Docker-backed path**

```bash
curl --noproxy '*' -fsS http://127.0.0.1:3100/health/ready
curl --noproxy '*' -fsS \
  'http://127.0.0.1:3100/api/v1/countries/ID/modules/market-overview?locale=zh-CN'
curl --noproxy '*' -fsS http://127.0.0.1:3000/zh-CN/countries/ID
```

Expected: ready, Profile v2 in API, and live HTML containing `BASIC 八类数据`,
`285,721,236`, `99.9`, and `印尼国家电力总规划`.

Because the Browser plugin is not available in this session, use a temporary
Playwright script outside the repository to load the live URL, assert page identity,
meaningful DOM, no framework overlay, and no relevant console errors; switch to
English and verify the Profile heading changes; capture desktop and 390px mobile
screenshots at `/tmp/basic-profile-desktop.png` and `/tmp/basic-profile-mobile.png`.

- [ ] **Step 6: Push and confirm SHA alignment**

```bash
git push origin main
run_id=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
git fetch origin
git rev-parse HEAD origin/main
git ls-remote origin refs/heads/main
```

Expected: local HEAD, `origin/main`, remote main, and successful CI `headSha` match.
