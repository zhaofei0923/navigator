/** Read-only style/layout inspection of the original raw index. */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("input.xlsx and inspection-directory required");
const root = process.env.CODEX_BUNDLED_NODE_MODULES;
if (!root || await fs.realpath(path.join(process.cwd(), "node_modules")) !== await fs.realpath(root)) {
  throw new Error("Use the loader-provided node_modules link");
}
const require = createRequire(path.join(process.cwd(), "artifact-inspect.cjs"));
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(require.resolve("@oai/artifact-tool")).href);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
await fs.mkdir(output, { recursive: true });
const overview = await wb.inspect({ kind: "workbook,sheet,table", maxChars: 6500, tableMaxRows: 2, tableMaxCols: 3 });
const style = await wb.inspect({ kind: "computedStyle", sheetId: "国家概况", range: "A1:D3", maxChars: 2500 });
console.log(overview.ndjson);
await fs.writeFile(path.join(output, "source-inspection.json"), JSON.stringify({ overview, style }, null, 2));
for (const [sheetName, range, name] of [
  ["说明", "A1:F12", "source-guide"], ["国家概况", "A1:F5", "source-profiles"],
  ["宏观能源", "A1:H5", "source-macro"], ["质量检查", "A1:E9", "source-quality"],
]) {
  const preview = await wb.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(output, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({ inspected: true, input_unchanged: true }));
