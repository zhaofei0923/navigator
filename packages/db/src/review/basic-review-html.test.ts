import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createBasicCollectionAuditV3Fixture } from "../basic-collection-v3-test-fixture.js";
import type { BasicCollectionAuditBundleV3 } from "../collection/basic-collection-v3-contracts.js";
import { renderBasicReviewHtml } from "./basic-review-html.js";
import { createBasicReviewModel } from "./basic-review-model.js";

describe("BASIC local review HTML", () => {
  test("escapes every untrusted value and renders bilingual columns", () => {
    const bundle = fixture();
    const mutated = structuredClone(bundle) as Mutable<BasicCollectionAuditBundleV3>;
    mutated.marketOverviewDraft.basicProfile.categories.marketSummary.fields[0]!.value = {
      zh: "<script>alert('zh')</script>",
      en: "<img src=x onerror=alert('en')>",
    };
    mutated.marketOverviewDraft.basicProfile.sources[0]!.title = {
      zh: "来源 & <b>危险</b>",
      en: "Source & <b>unsafe</b>",
    };

    const html = new TextDecoder().decode(renderBasicReviewHtml(
      createBasicReviewModel({ candidate: mutated, previousProfile: null }),
    ));

    expect(html).toContain('class="lang zh"');
    expect(html).toContain('class="lang en"');
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>危险</b>");
    expect(html).toContain("&lt;script&gt;alert(&#39;zh&#39;)&lt;/script&gt;");
    expect(html).toContain("来源 &amp; &lt;b&gt;危险&lt;/b&gt;");
  });

  test("returns byte-identical output for the same review model", () => {
    const model = createBasicReviewModel({
      candidate: fixture(), previousProfile: null,
    });
    const first = renderBasicReviewHtml(model);
    const second = renderBasicReviewHtml(structuredClone(model));

    expect(createHash("sha256").update(first).digest("hex"))
      .toBe(createHash("sha256").update(second).digest("hex"));
    expect(first).toEqual(second);
  });
});

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

function fixture(): BasicCollectionAuditBundleV3 {
  return createBasicCollectionAuditV3Fixture() as unknown as BasicCollectionAuditBundleV3;
}
