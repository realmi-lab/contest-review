// 의존성 없는 최소 엑셀(xlsx) 읽기·쓰기.
// 읽기: MS Forms 응답 엑셀, 심사자가 채운 평가표. 쓰기: 심사자 평가표, 응답 엑셀의 칸 고치기(patchCells).
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/* ─────────── 압축(zip) ─────────── */

function unzip(buffer) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])))
    throw new Error("보호(암호화)된 엑셀이라 읽을 수 없습니다. 민감도 레이블의 암호화를 뺀 파일이 필요합니다.");
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("엑셀 파일(xlsx)이 아닙니다.");
  const files = new Map();
  let at = buffer.readUInt32LE(end + 16);
  for (let i = buffer.readUInt16LE(end + 10); i > 0; i--) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

function zip(entries) {
  const parts = [], directory = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const content = Buffer.from(text), data = deflateRawSync(content), path = Buffer.from(name);
    const header = (size, signature) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(signature, 0);
      return b;
    };
    const local = header(30, 0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 파일 이름은 UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(path.length, 26);
    const central = header(46, 0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    local.copy(central, 8, 6, 30); // 플래그·방식·날짜·CRC·크기·이름 길이는 같다
    central.writeUInt32LE(offset, 42);
    parts.push(local, path, data);
    directory.push(central, path);
    offset += 30 + path.length + data.length;
  }
  const list = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(list.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, list, end]);
}

/* ─────────── 읽기 ─────────── */

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] !== "#" ? (ENTITIES[e] ?? m) : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
// 서식이 섞인 글(<r><t>…</t></r>)은 이어 붙이고, 일본어 발음 표기(<rPh>)는 뺀다.
const textOf = (xml) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const columnIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetPath(files, wanted) {
  const book = files.get("xl/workbook.xml")?.toString() ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString() ?? "";
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(attr(m[0], "name") ?? ""), id: attr(m[0], "r:id") }));
  const sheet = wanted ? sheets.find((s) => s.name === wanted) : sheets[0];
  if (!sheet) throw new Error(`'${wanted}' 시트가 없습니다. 있는 시트: ${sheets.map((s) => s.name).join(", ")}`);
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === sheet.id);
  const target = attr(rel ?? "", "Target") ?? "";
  return target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
}
const CELLS = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

// 시트의 모든 행을 [[칸, …], …]로 돌려준다. 빈 칸은 "", 숫자는 number, 참·거짓은 boolean.
export function readSheet(buffer, sheetName = "") {
  const files = unzip(buffer);
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString() ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const xml = files.get(sheetPath(files, sheetName))?.toString();
  if (!xml) throw new Error("엑셀에서 시트를 찾지 못했습니다.");
  const rows = [];
  for (const [rowTag, cells] of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const [, head, inner = ""] of (cells ?? "").matchAll(CELLS)) {
      const type = attr(head, "t");
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value =
        type === "s" ? shared[Number(raw)] ?? ""
        : type === "inlineStr" ? textOf(inner)
        : type === "b" ? raw === "1"
        : type === "str" || type === "e" ? decode(raw ?? "")
        : raw === undefined ? "" : Number(raw);
      row[attr(head, "r") ? columnIndex(attr(head, "r")) : row.length] = value;
    }
    rows[Number(attr(rowTag, "r") ?? rows.length + 1) - 1] = Array.from(row, (v) => v ?? "");
  }
  return Array.from(rows, (r) => r ?? []);
}

/* ─────────── 쓰기 ─────────── */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const columnName = (i) => (i >= 26 ? columnName(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

function cellXml(value, ref, style) {
  const s = style ? ` s="${style}"` : "";
  if (value === "" || value == null) return style ? `<c r="${ref}"${s}/>` : "";
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === "object") return `<c r="${ref}"${s}><f>${esc(value.formula)}</f></c>`; // 계산은 엑셀이 연다
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

// 있는 엑셀에서 칸 몇 개의 글자만 고친 새 파일. cells: [{ row, column, value }] (0부터). 표·서식·다른 시트는 그대로 둔다.
export function patchCells(buffer, sheetName, cells) {
  const files = unzip(buffer), name = sheetPath(files, sheetName);
  let xml = files.get(name)?.toString();
  if (!xml) throw new Error("엑셀에서 시트를 찾지 못했습니다.");
  for (const { row, column, value } of cells) {
    const ref = columnName(column) + (row + 1);
    const rowXml = new RegExp(`(<row\\b[^>]*\\sr="${row + 1}"[^>]*>)([\\s\\S]*?)(</row>)`);
    if (!rowXml.test(xml)) throw new Error(`엑셀에 ${row + 1}행이 없습니다.`);
    xml = xml.replace(rowXml, (all, open, body, close) => {
      const found = [...body.matchAll(CELLS)];
      const old = found.find((m) => attr(m[1], "r") === ref);
      // 그 칸이 없으면(빈 칸) 열 순서에 맞는 자리에 끼운다
      const at = old?.index ?? found.find((m) => columnIndex(attr(m[1], "r") ?? "") > column)?.index ?? body.length;
      const cell = cellXml(value, ref, old && attr(old[1], "s"));
      return open + body.slice(0, at) + cell + body.slice(at + (old?.[0].length ?? 0)) + close;
    });
  }
  files.set(name, xml);
  return zip([...files]);
}

function sheetXml({ rows, widths = [], freeze = false, validations = [] }) {
  const view = freeze
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const data = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(v, columnName(c) + (r + 1), r === 0 ? 1 : 0)).join("")}</row>`)
    .join("");
  const rules = validations.map((v) =>
    v.list
      ? `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>"${esc(v.list.join(","))}"</formula1></dataValidation>`
      : `<dataValidation type="decimal" operator="between" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>${v.between[0]}</formula1><formula2>${v.between[1]}</formula2></dataValidation>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${data}</sheetData>${
    rules.length ? `<dataValidations count="${rules.length}">${rules.join("")}</dataValidations>` : ""}</worksheet>`;
}

// sheets: [{ name, rows, widths?, freeze?, validations?: [{ range: "L2:L50", list: [...] } | { range, between: [0, 1.5] }] }]
// 첫 행은 머리글(굵게·옅은 오렌지). 칸 값: 글자 · 숫자 · { formula: "SUM(A2:B2)" }
export function writeWorkbook(sheets) {
  const ns = "http://schemas.openxmlformats.org";
  const sheetNames = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const sheetRels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  const n = sheets.length;
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheetNames}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships">${sheetRels}<Relationship Id="rId${n + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBE3CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}
