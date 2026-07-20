import type { BasicReviewDifference, BasicReviewModel } from "./basic-review-model.js";

const encoder = new TextEncoder();

export function renderBasicReviewHtml(model: BasicReviewModel): Uint8Array {
  const sections = model.sections.map((section) => `
<section><h2><span class="lang zh">${escapeHtml(section.title.zh)}</span><span class="lang en">${escapeHtml(section.title.en)}</span></h2>
<table><thead><tr><th>字段 / Field</th><th>中文</th><th>English</th><th>数值 / Value</th><th>来源 / Sources</th></tr></thead><tbody>
${section.fields.map((field) => `<tr><th><span class="lang zh">${escapeHtml(field.label.zh)}</span><span class="lang en">${escapeHtml(field.label.en)}</span><code>${escapeHtml(field.fieldPath)}</code></th><td class="lang zh">${escapeHtml(field.text.zh)}</td><td class="lang en">${escapeHtml(field.text.en)}</td><td>${escapeHtml(formatScalar(field.value))}<br>${escapeHtml(field.unit ?? "—")} · ${escapeHtml(field.year === null ? "—" : String(field.year))}<br>${escapeHtml(field.status)} · ${escapeHtml(field.checkedAt)}</td><td>${field.citations.map((citation) => `<a href="${escapeHtml(citation.url)}">${escapeHtml(citation.sourceId)}</a><br><span class="lang zh">${escapeHtml(citation.title.zh)}</span><span class="lang en">${escapeHtml(citation.title.en)}</span><small>${escapeHtml(citation.publisher)} · ${escapeHtml(citation.retrievedAt)}</small>`).join("<hr>")}</td></tr>`).join("\n")}
</tbody></table></section>`).join("\n");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BASIC 数据审核包 / BASIC Data Review Pack</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#17202a}h1,h2{margin:1.2em 0 .5em}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ccd1d1;padding:8px;vertical-align:top;overflow-wrap:anywhere}.lang{display:block}.zh{background:#f8fbff}.en{background:#fffdf7}code,small{display:block;margin-top:4px}.pass{color:#18794e}.fail{color:#b42318}a{color:#175cd3}</style></head><body>
<h1>BASIC 数据审核包 / BASIC Data Review Pack</h1><div class="meta"><div>国家 / Country: ${escapeHtml(model.countryCode)}</div><div>Run ID: ${escapeHtml(model.runId)}</div><div>Updated: ${escapeHtml(model.candidateUpdatedAt)}</div></div>
<section><h2>候选文件哈希 / Candidate artifact SHA-256</h2><ul>${Object.entries(model.candidateArtifactSha256).map(([name, hash]) => `<li><code>${escapeHtml(name)}</code><code>${escapeHtml(hash)}</code></li>`).join("")}</ul></section>
${sections}
<section><h2>缺失项 / Missing items</h2>${model.missing.length === 0 ? "<p>无 / None</p>" : `<ul>${model.missing.map((item) => `<li><code>${escapeHtml(item.fieldPath)}</code><span class="lang zh">${escapeHtml(item.reason.zh)}</span><span class="lang en">${escapeHtml(item.reason.en)}</span><small>${escapeHtml(item.checkedAt)}</small></li>`).join("")}</ul>`}</section>
<section><h2>冲突 / Conflicts</h2>${model.conflicts.length === 0 ? "<p>无 / None</p>" : `<ul>${model.conflicts.map((item) => `<li><code>${escapeHtml(item.fieldPath)}</code>${escapeHtml(item.resolution)} · ${escapeHtml(item.factIds.join(", "))}<span>${escapeHtml(item.notes)}</span><pre>${escapeHtml(JSON.stringify(item.values))}</pre></li>`).join("")}</ul>`}</section>
<section><h2>与上一版差异 / Previous-publication diff</h2>${model.differences.length === 0 ? "<p>无 / None</p>" : `<ul>${model.differences.map(renderDifference).join("")}</ul>`}</section>
<section><h2>发布检查清单 / Publication checklist</h2><ul>${model.checklist.map((item) => `<li class="${item.passed ? "pass" : "fail"}">${item.passed ? "✓" : "□"}<span class="lang zh">${escapeHtml(item.label.zh)}</span><span class="lang en">${escapeHtml(item.label.en)}</span></li>`).join("")}</ul></section>
</body></html>\n`;
  return encoder.encode(html);
}

function renderDifference(difference: BasicReviewDifference): string {
  return `<li><code>${escapeHtml(difference.fieldPath)}</code>${escapeHtml(difference.change)}<pre>${escapeHtml(JSON.stringify({ previous: difference.previous, current: difference.current }))}</pre></li>`;
}

function formatScalar(value: unknown): string {
  if (value === null) return "NOT_AVAILABLE";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
