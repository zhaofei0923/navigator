/** Extend a copy of the original raw index using only the bundled artifact tool. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [sourcePath, dataPath, outputPath, qaPath] = process.argv.slice(2);
if (!sourcePath || !dataPath || !outputPath || !qaPath) throw new Error("source.xlsx input.json output.xlsx qa-directory required");
if (await fs.stat(outputPath).then(() => true, () => false)) throw new Error("Refusing to overwrite a workbook");
const dependencyRoot = process.env.CODEX_BUNDLED_NODE_MODULES;
if (!dependencyRoot || await fs.realpath(path.join(process.cwd(), "node_modules")) !== await fs.realpath(dependencyRoot)) {
  throw new Error("Link node_modules to the loader-provided bundle");
}
const require = createRequire(path.join(process.cwd(), "artifact-raw.cjs"));
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);
const inputBytes = await fs.readFile(sourcePath);
const beforeHash = createHash("sha256").update(inputBytes).digest("hex");
const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
if (data.schema_version !== "navigator.raw-expansion-workbook.v1" || data.country_code !== "ZMB" || data.country_count !== 61) {
  throw new Error("A validated Zambia raw expansion is required");
}
if (data.reference_workbook_sha256 !== beforeHash) throw new Error("The input workbook differs from the inspected original");
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
await fs.mkdir(qaPath, { recursive: true });
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const excelText = (value) => typeof value === "string" && /^[=']/.test(value) ? `'${value}` : value;
const col = (n) => { let result = ""; for (let i = n + 1; i; i = Math.floor((i - 1) / 26)) result = String.fromCharCode(65 + (i - 1) % 26) + result; return result; };
const audits = [];
for (const table of data.tables) {
  const sheet = wb.worksheets.getItem(table.sheet);
  const headers = sheet.getRange(`A4:${col(table.headers.length - 1)}4`).values[0];
  if (JSON.stringify(headers) !== JSON.stringify(table.reference_headers) ||
      headers.length !== table.headers.length || table.rows.some((row) => row.length !== headers.length)) {
    throw new Error(`Column shape changed for ${table.sheet}`);
  }
  // Existing table names, filters, fonts, numeric formats and previous rows stay
  // intact in the new copy. The source workbook is never exported or edited.
  const nativeTables = sheet.tables.items;
  if (nativeTables.length !== 1) throw new Error(`Expected one original table on ${table.sheet}`);
  if (nativeTables[0].name !== table.reference_table_name ||
      nativeTables[0].getDataRows().length !== table.previous_count) {
    throw new Error(`The original table or row count changed on ${table.sheet}`);
  }
  nativeTables[0].rows.add(null, table.rows.map((row) => row.map(excelText)));
  const start = table.previous_count + 5;
  const end = start + table.rows.length - 1;
  sheet.getRange(`A1`).values = [[table.title]];
  sheet.getRange(`A2`).values = [[table.subtitle]];
  sheet.getRange(`A${start}:${col(headers.length - 1)}${end}`).format.rowHeight = table.sheet === "政策目录" ? 140 : table.sheet === "专题覆盖" ? 110 : 68;
  sheet.getRange(`A${start}:${col(headers.length - 1)}${end}`).format.wrapText = true;
  sheet.freezePanes.freezeRows(4);
  if (table.sheet === "宏观能源") {
    const energyIndex = table.rows.findIndex((row) => row[2] === "energy_latest");
    const energyRow = start + energyIndex;
    if (energyIndex < 0) throw new Error("The added energy row is required");
    sheet.getRange(`S${energyRow}`).formulas = [[`=IF(OR(K${energyRow}="",K${energyRow}=0,O${energyRow}=""),"",ROUND(O${energyRow}/K${energyRow}*100,4))`]];
    sheet.getRange(`U${energyRow}`).formulas = [[`=IF(OR(M${energyRow}="",M${energyRow}=0,Q${energyRow}=""),"",ROUND(Q${energyRow}/M${energyRow}*100,4))`]];
    sheet.getRange(`E${start}:J${end}`).setNumberFormat("#,##0.00");
    for (const letter of ["K", "M", "O", "Q"]) sheet.getRange(`${letter}${start}:${letter}${end}`).setNumberFormat("#,##0.00");
    for (const letter of ["D", "L", "N", "P", "R", "T", "V"]) sheet.getRange(`${letter}${start}:${letter}${end}`).setNumberFormat("0");
    sheet.getRange(`S${energyRow}`).setNumberFormat("0.0000");
    sheet.getRange(`U${energyRow}`).setNumberFormat("0.0000");
  }
  if (table.sheet === "国家概况") {
    sheet.getRange(`K${start}`).setNumberFormat("#,##0");
    sheet.getRange(`Q${start}`).setNumberFormat("#,##0.00");
  }
  if (table.sheet === "质量检查") {
    const r = start;
    const sourceEnd = data.source_count + 4, policyEnd = data.policy_count + 4;
    const macroEnd = data.macro_energy_count + 4, topicEnd = data.topic_count + 4;
    sheet.getRange(`D${r}:P${r}`).formulas = [[
      `=COUNTIF('国家概况'!$C$5:$C$65,B${r})`,
      `=COUNTIFS('宏观能源'!$A$5:$A$${macroEnd},B${r},'宏观能源'!$C$5:$C$${macroEnd},"macro_annual")`,
      `=COUNTIFS('宏观能源'!$A$5:$A$${macroEnd},B${r},'宏观能源'!$C$5:$C$${macroEnd},"energy_latest")`,
      `=COUNTIF('官方来源'!$B$5:$B$${sourceEnd},B${r})`,
      `=COUNTIF('政策目录'!$B$5:$B$${policyEnd},B${r})`,
      `=COUNTIF('专题覆盖'!$A$5:$A$${topicEnd},B${r})`,
      `=COUNTIFS('专题覆盖'!$A$5:$A$${topicEnd},B${r},'专题覆盖'!$E$5:$E$${topicEnd},"not_found_pending_research")`,
      `=COUNTIFS('政策目录'!$B$5:$B$${policyEnd},B${r},'政策目录'!$V$5:$V$${policyEnd},"downloaded")+COUNTIFS('政策目录'!$B$5:$B$${policyEnd},B${r},'政策目录'!$V$5:$V$${policyEnd},"downloaded_pending_validation")`,
      `=IF(AND(G${r}>=6,G${r}<=10),"通过","不通过")`,
      `=IF(AND(H${r}>=5,H${r}<=15),"通过","不通过")`,
      `=IF(I${r}=7,"通过","不通过")`,
      `=IF(AND(D${r}=1,E${r}=5,F${r}=1,L${r}="通过",M${r}="通过",N${r}="通过"),"通过","不通过")`,
      `=IF(COUNTIFS('宏观能源'!$A$5:$A$${macroEnd},B${r},'宏观能源'!$C$5:$C$${macroEnd},"energy_latest",'宏观能源'!$W$5:$W$${macroEnd},"<>")>0,"有值","缺口已标注")`,
    ]];
    sheet.getRange(`D${r}:K${r}`).setNumberFormat("0");
  }
  audits.push({ sheet: table.sheet, rows_added: table.rows.length, start_row: start, end_row: end });
  // A narrow evidence image shows actual appended rows rather than only an unchanged header.
  const preview = await wb.render({ sheetName: table.sheet, range: `A${start - 1}:${col(Math.min(headers.length - 1, 7))}${Math.min(end, start + 2)}`, scale: 1, format: "png" });
  await fs.writeFile(path.join(qaPath, `${table.sheet}.png`), new Uint8Array(await preview.arrayBuffer()));
  if (table.sheet === "宏观能源" || table.sheet === "质量检查") {
    const range = table.sheet === "宏观能源" ? `K${end}:X${end}` : `D${end}:Q${end}`;
    const detail = await wb.render({ sheetName: table.sheet, range, scale: 1, format: "png" });
    await fs.writeFile(path.join(qaPath, `${table.sheet}-数值核对.png`), new Uint8Array(await detail.arrayBuffer()));
  }
}
const guide = wb.worksheets.getItem("说明");
guide.getRange("A1").values = [["61国新能源基础信息与政策索引 · 海外60国"]];
guide.getRange("A2").values = [["新增赞比亚｜新增采集日期2026-08-28｜原60国数据不变；中国仅保留历史档案，不进入海外市场"]];
guide.getRange("A5").formulas = [["=COUNTA('国家概况'!C5:C65)"]];
guide.getRange("D5").formulas = [[`=COUNTA('官方来源'!A5:A${data.source_count + 4})`]];
guide.getRange("G5").formulas = [[`=COUNTA('政策目录'!A5:A${data.policy_count + 4})`]];
guide.getRange("J5").formulas = [[`=COUNTIF('政策目录'!V5:V${data.policy_count + 4},"downloaded")+COUNTIF('政策目录'!V5:V${data.policy_count + 4},"downloaded_pending_validation")`]];
const guidance = {
  9: "原始档案61国，海外范围60国；本次只新增赞比亚。原60国资料和审核历史保持不变，中国不进入海外页面。",
  11: "原60国能源统计口径不变；赞比亚统计期间按各指标实际来源记录，不将采集年份当作统计年份。",
  12: "用电需求继续留空，不以发电量代替。未知值不转成零。",
  13: "原国家画像保留原统计年份；赞比亚采用本次取得的官方来源，人口与陆地面积年份见各字段。",
  14: "独立生效日期未核实的政策仍留空，并保留条件说明；发布日期不冒充生效日。",
  15: "赞比亚原文下载结果和SHA-256见政策目录；受限制或未取得原文的只保留官方URL，不伪造文件。",
  16: "61国各有7项专题记录，共427条；每项按实际资料覆盖状况登记。",
  17: "许可与使用范围由人工决定；本表记录来源条件，不自动判断或生成批准。",
  18: "本扩展索引用于新增国家资料查阅；新增赞比亚须经一份集中审核文件实际确认后才接入线上。",
  19: "新总清单：collection_manifest_61.json；原collection_manifest_60.json及原60国工作簿完整留存。",
};
for (const [row, value] of Object.entries(guidance)) guide.getRange(`D${row}`).values = [[value]];
const guidePreview = await wb.render({ sheetName: "说明", range: "A1:N19", scale: 1, format: "png" });
await fs.writeFile(path.join(qaPath, "说明.png"), new Uint8Array(await guidePreview.arrayBuffer()));
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#N/A", options: { useRegex: true, maxResults: 100 } });
const summary = await wb.inspect({ kind: "table", range: "'说明'!A4:J5", include: "values,formulas", tableMaxRows: 2, tableMaxCols: 10 });
await fs.writeFile(path.join(qaPath, "inspection.json"), JSON.stringify({ errors: errors.ndjson, summary: summary.ndjson, audits }, null, 2));
if (errors.truncated || typeof errors.ndjson !== "string" || !errors.ndjson.includes("Cell search matched 0 entries.")) {
  throw new Error("Formula-error inspection did not confirm a clean workbook; review the QA report");
}
const result = await SpreadsheetFile.exportXlsx(wb);
await result.save(outputPath);
const afterHash = createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
if (beforeHash !== afterHash) throw new Error("The original workbook changed during expansion");
console.log(JSON.stringify({ output: outputPath, original_sha256: beforeHash, original_unchanged: true, audits }));
