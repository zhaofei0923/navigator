/**
 * Author one editable market-overview review workbook with the bundled artifact tool.
 *
 * node build_review_workbook.mjs review-data.json output.xlsx qa-directory
 * CODEX_BUNDLED_NODE_MODULES must be the package path returned by
 * load_workspace_dependencies. No repository/system spreadsheet dependencies.
 * Run from a temporary working directory with node_modules linked to that bundle.
 * This script never approves, publishes, or converts legacy content and refuses
 * an existing output. Legacy workbooks remain available to the read-only verifier.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [inputArg, outputArg, qaArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !qaArg) {
  throw new Error("Usage: build_review_workbook.mjs review-data.json output.xlsx qa-directory");
}
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
const qaPath = path.resolve(qaArg);
if (path.extname(outputPath).toLowerCase() !== ".xlsx" || inputPath === outputPath) {
  throw new Error("A separate .xlsx output is required");
}
if (await fs.stat(outputPath).then(() => true, () => false)) {
  throw new Error("Refusing to replace an existing review workbook");
}
const dependencyRoot = process.env.CODEX_BUNDLED_NODE_MODULES;
if (!dependencyRoot || !path.isAbsolute(dependencyRoot)) {
  throw new Error("Use CODEX_BUNDLED_NODE_MODULES from load_workspace_dependencies");
}
const inputBytes = await fs.readFile(inputPath);
const source = JSON.parse(inputBytes.toString("utf8"));
const headers = ["country_code", "content_version", "locale", "json_pointer", "original_value", "edited_value"];
if (JSON.stringify(source.content_headers) !== JSON.stringify(headers)) {
  throw new Error("The six import-contract headers must remain unchanged");
}
if (source.metadata?.schema_version !== "navigator.market-review.v1" ||
    !/^[a-f0-9]{64}$/.test(source.metadata.candidate_sha256 || "")) {
  throw new Error("The candidate must be validated and hash-bound before Excel authoring");
}
const rows = source.content_rows;
if (!Array.isArray(rows) || !rows.length || rows.length > 250000 ||
    rows.some((row) => row.length !== 6 || row.some((value) => typeof value !== "string"))) {
  throw new Error("Review content must be complete literal string rows");
}
if (!Array.isArray(source.countries) || !source.countries.length) {
  throw new Error("The candidate country inventory is required");
}
const countryMap = new Map(source.countries.map((item) => [item.code ?? item.country_code, item]));
if (countryMap.size !== source.metadata.country_count || countryMap.size !== source.countries.length || countryMap.has("CHN")) {
  throw new Error("Review scope must match the outbound candidate, excluding China");
}
const overviewPointer = /^\/locales\/(zh-CN|en)\/(title|paragraphs\/(?:0|[1-9]\d*)|disclaimer)$/;
const whitespace = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu;
const characterCount = (text) => [...text.replace(whitespace, "")].length;
const inventory = new Map();
if (source.row_labels && (!Array.isArray(source.row_labels) || source.row_labels.length !== rows.length)) {
  throw new Error("Overview labels must match the complete row inventory");
}
for (const [index, row] of rows.entries()) {
  const [code, version, locale, pointer, original, edited] = row;
  const match = overviewPointer.exec(pointer);
  if (!match || !version.startsWith(`OVERVIEW-${code}-`)) {
    throw new Error("Only the new overview inventory may be authored; legacy reviews are read-only and are never converted");
  }
  if (!countryMap.has(code) || locale !== match[1] || original !== edited || !original.trim()) {
    throw new Error("Overview rows must match a known country, locale and frozen original");
  }
  const key = `${code}:${pointer}`;
  if (inventory.has(key)) throw new Error(`Duplicate review pointer: ${key}`);
  inventory.set(key, row);
  const label = source.row_labels?.[index];
  if (label && (label.country_code !== code || label.locale !== locale || label.json_pointer !== pointer || label.layer !== "overview")) {
    throw new Error(`Overview row label does not match its immutable row: ${key}`);
  }
}
for (const [code, item] of countryMap) {
  if (!/^[A-Z]{3}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(item.as_of ?? "")) {
    throw new Error(`Invalid overview country or as_of: ${code}`);
  }
  const paragraphCounts = [];
  for (const locale of ["zh-CN", "en"]) {
    const prefix = `${code}:/locales/${locale}/`;
    if (!inventory.has(`${prefix}title`) || !inventory.has(`${prefix}disclaimer`)) {
      throw new Error(`Overview title or disclaimer missing: ${code} ${locale}`);
    }
    const localRows = rows.filter((row) => row[0] === code && row[2] === locale);
    const paragraphs = localRows.filter((row) => row[3].includes("/paragraphs/"));
    if (paragraphs.length < 6 || paragraphs.length > 8 || localRows.some((row) => row[1] !== item.content_version) ||
        paragraphs.some((_, index) => !inventory.has(`${prefix}paragraphs/${index}`))) {
      throw new Error(`Incomplete overview paragraphs or version: ${code} ${locale}`);
    }
    paragraphCounts.push(paragraphs.length);
    if (locale === "zh-CN") {
      const count = characterCount(paragraphs.map((row) => row[5]).join(""));
      if (count < 1500 || count > 2000 || count !== item.overview_zh_chars) {
        throw new Error(`Chinese overview body count differs: ${code}`);
      }
    }
  }
  if (paragraphCounts[0] !== paragraphCounts[1] || paragraphCounts[0] !== item.paragraph_count) {
    throw new Error(`Bilingual overview paragraph counts differ: ${code}`);
  }
}
if (!Array.isArray(source.evidence_rows) || !Array.isArray(source.gap_rows)) {
  throw new Error("Separate evidence_rows and gap_rows arrays are required, even when empty");
}
if ([...source.evidence_rows, ...source.gap_rows].some((item) => !countryMap.has(item.country_code ?? item.iso3))) {
  throw new Error("Research rows must belong to the same outbound country inventory");
}
// Standard package resolution is anchored in the conversation-specific working
// directory, whose node_modules link must point at the loader-provided bundle.
const workingModules = path.join(process.cwd(), "node_modules");
if (await fs.realpath(workingModules) !== await fs.realpath(dependencyRoot)) {
  throw new Error("Link the working directory node_modules to the loader-provided bundle");
}
const bundledRequire = createRequire(path.join(process.cwd(), "artifact-review.cjs"));
const { Workbook, SpreadsheetFile } = await import(
  pathToFileURL(bundledRequire.resolve("@oai/artifact-tool")).href
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(qaPath, { recursive: true });

const palette = {
  navy: "#10233F", teal: "#177E86", tealLight: "#E8F3F3", text: "#263D52",
  muted: "#64748B", white: "#FFFFFF", gray: "#F1F4F8", line: "#D6E1E8",
  input: "#FFF5D7", amber: "#956214", rose: "#FCE8E6",
};
const wb = Workbook.create();
const guide = wb.worksheets.add("审核导览");
const overview = wb.worksheets.add("国别总览");
const reading = wb.worksheets.add("中文阅读");
const edits = wb.worksheets.add("内容编辑");
const evidence = wb.worksheets.add("来源依据");
const gaps = wb.worksheets.add("待确认事项");
const metadata = wb.worksheets.add("包信息");
const sheetAudits = [];
const firstEntryRows = new Map();
const lastEntryRows = new Map();
const rowIndex = new Map();

function column(index) {
  let result = "";
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + (value - 1) % 26) + result;
  }
  return result;
}
function safeText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(safeText).join("；");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function widthUnits(text) {
  return [...safeText(text)].reduce((total, character) => total + (/[^\x00-\x7F]/.test(character) ? 2 : 1), 0);
}
function rowHeight(texts, widths, minimum = 30) {
  const lines = texts.map((text, index) => {
    const blocks = safeText(text).split("\n");
    const available = Math.max(5, widths[index] - 2);
    return blocks.reduce((total, block) => total + Math.max(1, Math.ceil(widthUnits(block) / available)), 0);
  });
  return Math.min(400, Math.max(minimum, Math.max(...lines) * 19 + 16));
}
function table(sheet, labels, values, widths, name, { rowHeights = true } = {}) {
  const last = values.length + 1;
  const lastCol = column(labels.length - 1);
  const range = sheet.getRange(`A1:${lastCol}${last}`);
  // Artifact input follows Excel's formula/quote conventions. Explicitly escape
  // leading formula or quote characters while preserving the exact stored text.
  range.values = [labels, ...values].map((row) => row.map((value) => (
    typeof value === "string" && /^[=']/.test(value) ? `'${value}` : value
  )));
  range.format = { font: { size: 11, color: palette.text }, wrapText: true, verticalAlignment: "top" };
  range.format.rowHeight = 32;
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(Math.min(2, labels.length));
  sheet.tables.add(`A1:${lastCol}${last}`, true, name);
  const header = sheet.getRange(`A1:${lastCol}1`);
  header.format = { fill: palette.navy, font: { bold: true, color: palette.white }, wrapText: true, verticalAlignment: "center" };
  header.format.rowHeight = 40;
  widths.forEach((width, index) => { sheet.getRange(`${column(index)}1:${column(index)}${last}`).format.columnWidth = width; });
  if (rowHeights) values.forEach((value, index) => {
    sheet.getRange(`A${index + 2}:${lastCol}${index + 2}`).format.rowHeight = rowHeight(value, widths);
  });
  sheetAudits.push({ name: sheet.name, data_rows: values.length, columns: labels.length });
  return last;
}
function pointerParts(pointer) {
  const parts = pointer.split("/").slice(1);
  return { parts, layer: "市场概述" };
}
const fieldNames = { title: "标题", disclaimer: "适用说明" };
const kindNames = {
  fact: "事实依据", analysis: "国别研判", country_analysis: "国别研判", verification_checklist: "核实建议",
  scope: "适用边界", structure: "结构字段", unresolved: "待确认", title: "标题",
};
function labelFor(row, index) {
  const supplied = source.row_labels?.[index] ?? {};
  const { parts, layer } = pointerParts(row[3]);
  const final = parts.at(-1);
  const parent = parts.at(-2);
  const leaf = fieldNames[final] ?? (parent === "paragraphs" ? `第${Number(final) + 1}自然段` : safeText(final));
  return {
    countryName: supplied.country_name ?? countryMap.get(row[0])?.country_name ?? row[0],
    layer,
    section: supplied.section_label ?? "新能源市场概述",
    leaf: supplied.leaf_label ?? leaf,
    kind: kindNames[supplied.claim_kind] ?? supplied.claim_kind ?? "国别正文",
    evidenceIds: safeText(supplied.evidence_ids),
  };
}
const editValues = rows.map((row, index) => {
  const excelRow = index + 2;
  rowIndex.set(`${row[0]}:${row[3]}`, excelRow);
  if (!firstEntryRows.has(row[0])) firstEntryRows.set(row[0], excelRow);
  lastEntryRows.set(row[0], excelRow);
  const label = labelFor(row, index);
  return [...row, label.countryName, label.layer, label.section, label.leaf, null, null, label.kind, label.evidenceIds, null];
});
const editLast = table(edits, [...headers, "国家名称", "内容层级", "内容位置", "字段说明", "字符数", "修改行", "内容性质", "依据编号", "去空白字符"],
  editValues, [9, 27, 10, 49, 78, 78, 15, 17, 26, 21, 11, 10, 24, 28, 14], "MarketEditableContent", { rowHeights: false });
edits.getRange(`A2:J${editLast}`).setNumberFormat("@");
edits.getRange(`M2:N${editLast}`).setNumberFormat("@");
edits.getRange(`E2:E${editLast}`).format = { fill: palette.gray, font: { color: palette.muted }, wrapText: true };
edits.getRange(`F2:F${editLast}`).format = { fill: palette.input, font: { color: palette.text }, wrapText: true };
edits.getRange(`K2:L${editLast}`).setNumberFormat("0");
edits.getRange(`K2:L${editLast}`).formulas = rows.map((_, index) => [`=LEN(F${index + 2})`, `=IF(EXACT(E${index + 2},F${index + 2}),0,1)`]);
// Match the overview contract's whitespace exclusion without replacing editable
// values with a static count. Supplementary Unicode remains Excel LEN's unit.
const whitespaceCodes = [9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760, ...Array.from({ length: 11 }, (_, index) => 8192 + index), 8232, 8233, 8239, 8287, 12288];
function countFormula(reference) {
  const expression = whitespaceCodes.reduce((text, code) => {
    const token = code < 32 ? `CHAR(${code})` : `"${String.fromCodePoint(code)}"`;
    return `SUBSTITUTE(${text},${token},"")`;
  }, reference);
  return `=LEN(${expression})`;
}
edits.getRange(`O2:O${editLast}`).formulas = rows.map((_, index) => [countFormula(`F${index + 2}`)]);
edits.getRange(`O2:O${editLast}`).setNumberFormat("0");
rows.forEach((row, index) => {
  const current = index + 2;
  edits.getRange(`A${current}:O${current}`).format.rowHeight = rowHeight([row[3], row[4], row[5]], [49, 78, 78], 31);
});
edits.getRange(`F2:F${editLast}`).conditionalFormats.addCustom("NOT(EXACT($E2,$F2))", {
  fill: palette.tealLight, font: { color: palette.teal, bold: true },
});
console.log(JSON.stringify({ stage: "editable_content_ready", rows: rows.length }));

const readable = rows.map((row, index) => ({ row, index, label: labelFor(row, index) })).filter(({ row }) => row[2] === "zh-CN");
const readingValues = readable.map(({ row, index, label }) => [row[0], label.countryName, label.layer, `${label.section} · ${label.leaf}`, null, index + 2, label.kind, label.evidenceIds]);
const readingLast = table(reading, ["ISO3", "国家", "阅读层级", "自然段与字段", "中文正文（与编辑页联动）", "编辑页行号", "内容性质", "内部依据编号"],
  readingValues, [9, 15, 16, 28, 108, 12, 25, 28], "MarketChineseReading", { rowHeights: false });
reading.getRange(`E2:E${readingLast}`).formulas = readable.map(({ row, index }) => {
  const reference = `'内容编辑'!F${index + 2}`;
  return [`=${reference}`];
});
reading.getRange(`F2:F${readingLast}`).setNumberFormat("0");
readable.forEach(({ row }, index) => {
  reading.getRange(`A${index + 2}:H${index + 2}`).format.rowHeight = rowHeight([row[5]], [108], 32);
});

function refFor(code, pointer) {
  const row = rowIndex.get(`${code}:/locales/zh-CN/${pointer}`);
  if (!row) throw new Error(`Missing review pointer ${code} ${pointer}`);
  return `='内容编辑'!F${row}`;
}
const countries = [...countryMap.entries()].sort(([first], [second]) => first.localeCompare(second));
const summaryRows = countries.map(([code, item]) => [
  code, item.country_name, null, null, null, null, null, null,
  item.content_version, item.as_of,
  "一国一篇，按自然段阅读；标题与适用说明不计入正文字符。来源和待确认事项单独留存，篇幅不代表研究结论已获确认。",
]);
const overviewLast = table(overview, ["ISO3", "国家", "新能源市场概述标题", "开篇正文", "中文正文字符（去空白）", "自然段数", "待确认项", "修改行数", "内容版本", "数据截至", "阅读说明"],
  summaryRows, [9, 15, 34, 100, 19, 12, 12, 12, 29, 15, 54], "MarketCountryOverview");
countries.forEach(([code], index) => {
  const row = index + 2;
  // The immutable candidate inventory is country-contiguous. Bound calculations
  // to one country's rows instead of repeatedly scanning all bilingual content.
  const first = firstEntryRows.get(code);
  const last = lastEntryRows.get(code);
  if (rows.slice(first - 2, last - 1).some((entry) => entry[0] !== code)) {
    throw new Error(`Non-contiguous country inventory: ${code}`);
  }
  const span = (letter) => `'内容编辑'!$${letter}$${first}:$${letter}$${last}`;
  const paragraphRows = rows.flatMap((entry, entryIndex) => (
    entry[0] === code && entry[2] === "zh-CN" && entry[3].startsWith("/locales/zh-CN/paragraphs/")
      ? [entryIndex + 2] : []
  ));
  const paragraphReferences = (letter) => paragraphRows.map((entryRow) => `'内容编辑'!${letter}${entryRow}`).join(",");
  overview.getRange(`C${row}:F${row}`).formulas = [[
    refFor(code, "title"), refFor(code, "paragraphs/0"),
    `=SUM(${paragraphReferences("O")})`,
    `=COUNTA(${paragraphReferences("F")})`,
  ]];
  overview.getRange(`G${row}:H${row}`).formulas = [[
    source.gap_rows.length ? `=COUNTIF('待确认事项'!$A$2:$A$${source.gap_rows.length + 1},A${row})` : "=0",
    `=SUM(${span("L")})`,
  ]];
  const opening = rows[rowIndex.get(`${code}:/locales/zh-CN/paragraphs/0`) - 2][5];
  overview.getRange(`A${row}:K${row}`).format.rowHeight = rowHeight([opening], [100], 80);
});
overview.getRange(`E2:H${overviewLast}`).setNumberFormat("#,##0");
overview.getRange(`J2:J${overviewLast}`).setNumberFormat("@");
overview.getRange(`H2:H${overviewLast}`).conditionalFormats.addCustom("$H2>0", { fill: palette.tealLight, font: { color: palette.teal, bold: true } });

const evidenceObjects = source.evidence_rows ?? [];
const evidenceValues = evidenceObjects.map((item) => [
  safeText(item.country_code ?? item.iso3), safeText(item.evidence_id ?? item.id), safeText(item.title),
  safeText(item.country_name ?? countryMap.get(item.country_code ?? item.iso3)?.country_name), safeText(item.url ?? item.official_url),
  safeText(item.locator), safeText(item.checked_on), safeText(item.verification),
  safeText(item.source_path ?? item.local_path), safeText(item.sha256 ?? item.actual_sha256), safeText(item.notes ?? item.limitation),
]);
const evidenceLast = table(evidence, ["ISO3", "依据编号", "资料名称", "国家", "官方链接（内部留存）", "页码／条款／定位", "核验日期", "阅读与核验范围", "本地原文路径", "原文 SHA-256", "条件及限制"],
  evidenceValues, [9, 30, 42, 15, 70, 66, 14, 42, 60, 68, 72], "MarketResearchEvidence");
if (evidenceValues.length) evidence.getRange(`A2:K${evidenceLast}`).setNumberFormat("@");
const gapObjects = source.gap_rows ?? [];
const gapValues = gapObjects.map((item) => [
  safeText(item.country_code ?? item.iso3), safeText(item.country_name ?? countryMap.get(item.country_code ?? item.iso3)?.country_name),
  safeText(item.topic ?? item.field ?? "项目核实"), safeText(item.text_zh ?? item.zh ?? item.text), safeText(item.text_en ?? item.en),
  safeText(item.notes ?? item.action ?? item.next_action ?? "取得补充结果后，按需要同步修改中英文概述。"),
]);
table(gaps, ["ISO3", "国家", "主题", "待确认事项（底稿原文）", "英文对照（如有）", "建议补充方式"],
  gapValues, [9, 15, 27, 82, 92, 64], "MarketResearchGaps");
// Research gaps are private evidence, not another editable public-content layer.

// Date-only metadata is permitted by the review contract. Preserve the real
// creation day without the exporter's ISO-datetime-to-Excel-serial coercion.
const workbookMetadata = { ...source.metadata, created_at: source.metadata.created_at.split("T")[0] };
const metadataValues = Object.entries(workbookMetadata).map(([key, value]) => [key, value]);
table(metadata, ["key", "value"], metadataValues, [28, 102], "MarketPackageMetadata");
metadata.getRange(`B2:B${metadataValues.length + 1}`).setNumberFormat("@");

guide.showGridLines = false;
guide.getRange("A1:H35").format = { font: { size: 11, color: palette.text }, wrapText: true, verticalAlignment: "top" };
guide.getRange("A1:H35").format.columnWidth = 18;
guide.getRange("A1:H35").format.rowHeight = 25;
guide.getRange("A1:H2").merge();
guide.getRange("A1").values = [["Navigator · 新能源市场概述集中审核"]];
guide.getRange("A1:H2").format = { fill: palette.navy, font: { bold: true, color: palette.white, size: 22 }, wrapText: true };
guide.getRange("A3:H3").merge();
guide.getRange("A3").values = [["中文主稿 / 双语同版 / 一份文件确认 · 仅为本批研究初稿，尚未发布"]];
guide.getRange("A3:H3").format = { fill: palette.tealLight, font: { color: palette.teal, bold: true } };
const kpis = [["A5:B5", "A6:B7", "国家", `=COUNTA('国别总览'!A2:A${overviewLast})`],
  ["C5:D5", "C6:D7", "双语内容行", `=COUNTA('内容编辑'!A2:A${editLast})`],
  ["E5:F5", "E6:F7", "内部来源依据", evidenceValues.length ? `=COUNTA('来源依据'!B2:B${evidenceLast})` : "=0"],
  ["G5:H5", "G6:H7", "待确认事项", gapValues.length ? `=COUNTA('待确认事项'!D2:D${gapValues.length + 1})` : "=0"]];
for (const [labelRange, numberRange, label, formula] of kpis) {
  guide.getRange(labelRange).merge(); guide.getRange(labelRange.split(":")[0]).values = [[label]];
  guide.getRange(labelRange).format = { fill: palette.gray, font: { color: palette.muted, bold: true } };
  guide.getRange(numberRange).merge(); guide.getRange(numberRange.split(":")[0]).formulas = [[formula]];
  guide.getRange(numberRange).format = { fill: palette.gray, font: { color: palette.teal, bold: true, size: 22 } };
  guide.getRange(numberRange).setNumberFormat("#,##0");
}
const instructions = [
  [9, "01  一国一篇，按自然段阅读", "「国别总览」列出标题和开篇；在「中文阅读」筛选国家即可顺序阅读一篇完整概述。需要修改时，按“编辑页行号”到「内容编辑」F列修改。阅读页与总览用公式实时引用F列，没有第二份正文副本。"],
  [13, "02  只改淡黄色F列", "前六列是稳定导入合同：country_code / content_version / locale / json_pointer / original_value / edited_value。编辑页仅筛选、不排序，不删除行或改A–E列；可以修改标题、各自然段和适用说明。不新增段落行或修改指针。"],
  [17, "03  中英文同一次确认", "按locale筛选zh-CN和en。修改事实、数字、适用条件或研判后须同步对应英文，保持自然段一一对应。正文使用有依据的分析，不设评分或统一等级。系统只核查结构、一致性和版本，不代替人工决定许可或确认内容。"],
  [21, "04  来源和研究缺口单独留存", "「来源依据」保留官方链接、定位、核查日期和阅读范围；读过资料不等于具体项目适用条件全部确认。「待确认事项」是独立研究记录，不是对客正文的另一层。补充事实后，应按需要同步修改中英文概述。"],
  [25, "05  一份文件确认，保留版本", "你确认这份Excel的实际内容后，即可按同一批次导入并发布，无需逐国签字或D1–D4分轮审核。五国写法确认不替代本批正文确认；工具不生成审批或发布。后续更新另建内容版本，保留历史并支持单国撤回。"],
  [29, "06  本次范围", "覆盖当前海外国家，排除中国；聚焦光伏、风电、储能与设备出口、EPC、开发投资。原始数据、历史审核包和实际发布状态不变；不建设AI问答、向量库、会员、支付或CMS。网页不显示来源或审核标签。"],
];
for (const [row, heading, description] of instructions) {
  guide.getRange(`A${row}:H${row}`).merge(); guide.getRange(`A${row}`).values = [[heading]];
  guide.getRange(`A${row}:H${row}`).format = { fill: palette.tealLight, font: { color: palette.teal, bold: true } };
  guide.getRange(`A${row + 1}:H${row + 2}`).merge(); guide.getRange(`A${row + 1}`).values = [[description]];
  guide.getRange(`A${row + 1}:H${row + 2}`).format = { wrapText: true, font: { color: palette.text } };
}
guide.getRange("A33:H35").merge();
guide.getRange("A33").values = [["篇幅说明：每篇中文正文1500–2000字、6–8个自然段，不含标题和适用说明。表内字符公式使用Excel LEN并去除空白，含标点及英文/数字；后端导入按Unicode字符复核。篇幅不是研究深度分数，未知税率和项目条件不得用无依据结论补足。"]];
guide.getRange("A33:H35").format = { fill: palette.input, font: { color: palette.amber }, wrapText: true };
guide.freezePanes.freezeRows(3);
sheetAudits.unshift({ name: "审核导览", data_rows: 35, columns: 8 });
console.log(JSON.stringify({ stage: "all_sheets_ready", sheets: sheetAudits.length }));

const inspections = [];
for (const [name, range] of [["审核导览", "A5:H7"], ["国别总览", "A1:J4"], ["内容编辑", "A1:F6"], ["包信息", "A1:B8"]]) {
  inspections.push(await wb.inspect({ kind: "table", range: `'${name}'!${range}`, include: "values,formulas", tableMaxRows: 10, tableMaxCols: 14 }));
  console.log(JSON.stringify({ stage: "inspection_ready", sheet: name }));
}
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!", options: { useRegex: true, maxResults: 100 } });
await fs.writeFile(path.join(qaPath, "workbook-inspection.json"), JSON.stringify({ inspections, errors }, null, 2), "utf8");
const previews = [
  ["审核导览", "A1:H35", "01-guide"], ["国别总览", "A1:H5", "02-overview"],
  ["中文阅读", "A1:F8", "03-chinese-reading"], ["内容编辑", "E1:J7", "04-editing"],
  ["来源依据", "A1:H4", "05-evidence"], ["待确认事项", "A1:D5", "06-gaps"],
  ["包信息", `A1:B${metadataValues.length + 1}`, "07-package"],
];
// Sample the body of a full batch as well as the first rows. This catches late
// country clipping and the longest English paragraph without changing content.
const middleReadingRow = Math.floor(readable.length / 2) + 2;
const lastParagraphIndex = readable.findLastIndex(({ row }) => row[3].includes("/paragraphs/"));
const longestEnglish = rows.reduce((best, row, index) => (
  row[2] === "en" && row[3].includes("/paragraphs/") && row[5].length > best.length
    ? { row: index + 2, length: row[5].length } : best
), { row: 2, length: -1 });
previews.push(
  ["中文阅读", `A${middleReadingRow}:F${Math.min(readingLast, middleReadingRow + 2)}`, "08-middle-country"],
  ["中文阅读", `A${Math.max(2, lastParagraphIndex)}:F${lastParagraphIndex + 2}`, "09-last-country"],
  ["内容编辑", `E${longestEnglish.row}:J${longestEnglish.row}`, "10-longest-english"],
);
for (const [sheetName, range, slug] of previews) {
  const preview = await wb.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(qaPath, `${slug}.png`), new Uint8Array(await preview.arrayBuffer()));
  console.log(JSON.stringify({ stage: "preview_ready", sheet: sheetName }));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(outputPath);
const outputBytes = await fs.readFile(outputPath);
const audit = {
  schema_version: "navigator.market-workbook-authoring.v1", authoring_library: "@oai/artifact-tool",
  input_sha256: createHash("sha256").update(inputBytes).digest("hex"),
  output_sha256: createHash("sha256").update(outputBytes).digest("hex"), output_bytes: outputBytes.length,
  candidate_sha256: source.metadata.candidate_sha256, sheets: sheetAudits,
  content_profile: "overview",
  published: false, approval_generated: false, render_count: previews.length,
  preview_ranges: previews.map(([sheet, range, file]) => ({ sheet, range, file })),
};
await fs.writeFile(path.join(qaPath, "workbook-authoring.json"), JSON.stringify(audit, null, 2), "utf8");
console.log(JSON.stringify(audit));
// Let the artifact renderer/export worker finish its normal shutdown.
