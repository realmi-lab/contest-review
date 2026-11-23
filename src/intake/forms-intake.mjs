// MS Forms 공모 연동.
// Power Automate가 Forms 응답을 OneDrive 엑셀에 쌓고, 첨부는 OneDrive의 Forms 폴더에 들어온다. 이 PC에 동기화된 두 곳을 읽어
// ① 응답마다 작품 폴더를 만들어 첨부를 복사하고 ② 분야별 심사자 폴더에 배정 작품과 평가표 엑셀을 두고 공유를 요청하며
// ③ 심사자가 채운 평가표를 다시 읽는다. 폴더 공유는 Power Automate가 '_공유 요청' 폴더의 요청 파일을 보고 처리한다.
// 설정은 deploy/site.json의 forms다(서버마다 다름. 예시: deploy/site.example.json).
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { excelRows, excelWrite } from "./excel-app.mjs";
import { patchCells, readSheet, writeWorkbook } from "./xlsx.mjs";

// 응답 엑셀에서 읽는 값. 설정의 columns에 회사 엑셀의 실제 열 이름을 적는다(id·title은 필수).
export const FIELDS = {
  id: "응답 번호", submittedAt: "인입일", title: "작품명", description: "간략 설명", team: "팀", submitter: "접수자", email: "이메일",
  files: "첨부 파일",
}; // 응답 엑셀에서 읽는 항목. 분야(category)는 site.json에 적었을 때만 읽는다(심사자 분야별 배정용).
export const REQUIRED = ["id", "title", "files"];
const nfc = (s) => String(s ?? "").normalize("NFC"); // 맥 파일 이름은 한글 자모가 분리(NFD)되어 올 수 있다

/* ─────────── 설정 ─────────── */

// 처음 연동할 때 채우는 값. 회사 아이디어 제안 Forms 엑셀의 열: A ID · B 시작 시간 · C 완료 시간 · D 이메일 · E 이름 · F 성함
// · G 소속 · H 아이디어 제목 · I 아이디어 간략 설명 · J 첨부 파일명(최대 5개, URL 인코딩). 열 문자로 고정해 자동으로 읽는다.
export const FORMS_DEFAULTS = {
  formsSheet: "",
  columns: { id: "A", submittedAt: "C", email: "D", submitter: "E", team: "G", title: "H", description: "I", files: "J" },
  reviewDir: "아이디어 공모 심사",
  evaluators: [],
};
export const homePath = (p) => path.resolve(String(p ?? "").replace(/^~(?=[/\\]|$)/, os.homedir()));

// site.json의 forms를 확인해 쓸 모양으로 돌려준다. 없으면 null(연동 안 함).
// 심사 폴더는 OneDrive 폴더 안의 상대 경로, 응답 엑셀·첨부 폴더는 설정 화면에서 고른 절대 경로도 받는다
// (응답 엑셀은 SharePoint, 첨부는 개인 OneDrive처럼 동기화 폴더가 다를 수 있다).
export function formsConfig(raw) {
  if (!raw) return null;
  const root = homePath(raw.oneDriveRoot);
  if (!raw.oneDriveRoot) throw new Error("연동 설정에 oneDriveRoot(이 맥의 OneDrive 폴더)를 적으세요.");
  const inside = (relative, label) => {
    const full = path.resolve(root, String(relative ?? ""));
    if (!relative || !full.startsWith(root + path.sep)) throw new Error(`연동 설정의 ${label}는 OneDrive 폴더 안의 상대 경로로 적으세요.`);
    return full;
  };
  // 절대 경로(설정 화면에서 고른 경로, 윈도우의 C:\… 포함)나 ~/…는 그대로, 나머지는 OneDrive 폴더 안의 상대 경로
  const place = (value, label) => {
    const text = String(value ?? "");
    return path.isAbsolute(text) || /^~(?=[/\\]|$)/.test(text) ? homePath(text) : inside(text, label);
  };
  const columns = Object.fromEntries([...Object.keys(FIELDS), "category"].map((key) => [key, String(raw.columns?.[key] ?? "").trim()]));
  const unset = REQUIRED.filter((key) => !columns[key]);
  if (unset.length) throw new Error(`연동 설정 columns에 ${unset.map((k) => `${k}(${FIELDS[k]})`).join(", ")} 열 이름을 적으세요.`);
  const evaluators = (raw.evaluators ?? []).map((e) => ({
    name: String(e.name ?? "").trim(),
    email: String(e.email ?? "").trim().toLowerCase(),
    categories: [...new Set((e.categories ?? []).map((c) => String(c).trim()).filter(Boolean))],
  }));
  for (const e of evaluators)
    if (!e.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email) || !e.categories.length)
      throw new Error(`심사자 '${e.name || e.email}'의 이름·이메일·담당 분야(categories)를 확인하세요.`);
  for (const key of ["name", "email"])
    if (new Set(evaluators.map((e) => e[key])).size !== evaluators.length) throw new Error(`심사자 ${key === "name" ? "이름" : "이메일"}이 겹칩니다.`);
  return {
    root,
    formsWorkbook: place(raw.formsWorkbook, "formsWorkbook(응답 엑셀)"),
    formsSheet: String(raw.formsSheet ?? ""),
    columns,
    attachmentsDir: place(raw.attachmentsDir, "attachmentsDir(Forms 첨부 폴더)"),
    reviewDir: inside(raw.reviewDir, "reviewDir(심사 폴더)"),
    evaluators,
  };
}

/* ─────────── 설정 화면: 고를 수 있는 곳과 확인 ─────────── */

// 고를 수 있는 곳: 이 PC에 동기화된 OneDrive·SharePoint 폴더(맥은 ~/Library/CloudStorage/OneDrive…)와 지금 설정된 OneDrive 폴더
export async function storageRoots(current = "") {
  if (process.platform === "win32") // 윈도우는 OneDrive가 폴더 위치를 환경 변수로 알려 준다
    return [...new Set([current, process.env.OneDriveCommercial, process.env.OneDrive].filter(Boolean).map((p) => path.resolve(p)))];
  const cloud = path.join(os.homedir(), "Library", "CloudStorage");
  const synced = (await readdir(cloud).catch(() => [])).filter((n) => /^OneDrive/i.test(n)).map((n) => path.join(cloud, n));
  return [...new Set([current, ...synced].filter(Boolean))];
}
// target이 들어 있는 동기화 폴더(없으면 undefined)
export const rootOf = (roots, target) => roots.find((r) => target === r || target.startsWith(r + path.sep));
// 화면에 보일 이름: "OneDrive-회사 › 아이디어 공모 › 응답.xlsx"
export function placeLabel(roots, target) {
  const root = rootOf(roots, target);
  if (!root) return nfc(target);
  return [path.basename(root), ...path.relative(root, target).split(path.sep).filter(Boolean)].map(nfc).join(" › ");
}
// 설정 화면의 확인 결과: 응답 엑셀에서 읽은 응답 수(열 이름이 틀리면 그 오류), 첨부 폴더의 파일 수
export async function checkSources(config) {
  const fail = (e) => ({ ok: false, text: e.code === "ENOENT" ? "찾을 수 없습니다." : e.message });
  const workbook = await readResponses(config).then((list) => ({ ok: true, text: `응답 ${list.length}건을 읽었습니다.` }), fail);
  const attachments = await stat(config.attachmentsDir).then(async (s) => s.isDirectory()
    ? { ok: true, text: `첨부 파일 ${(await fileIndex(config.attachmentsDir)).size}개가 있습니다.` }
    : { ok: false, text: "폴더가 아닙니다." }, fail);
  return { workbook, attachments };
}

/* ─────────── 응답 → 작품 ─────────── */

// Forms 날짜 칸: 엑셀 일련번호, "2026-11-20 09:00", "2026. 11. 20. 오전 9:00", "11/20/2026 9:00" → "2026-11-20"
export function dayOf(value) {
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  const text = String(value);
  const iso = /(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/.exec(text);
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  const [y, m, d] = iso ? iso.slice(1) : us ? [us[3], us[1], us[2]] : [];
  return y ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";
}

// Forms 파일 업로드 답은 [{"name": "기획서_홍길동.pptx", "link": …}, …] 형식이거나 OneDrive 링크·파일 이름을 ;·쉼표·줄바꿈으로 나열한다.
// 한글 이름은 %EA%B8%B0…처럼 URL 인코딩되어 쌓이므로(두 번 인코딩된 것 포함) 풀어서 OneDrive에 내려받은 파일 이름과 맞춘다.
function plainName(s) {
  const text = String(s ?? "").trim();
  // OneDrive·SharePoint 문서 링크(…/_layouts/15/Doc.aspx?sourcedoc=…&file=제안서.docx)는 file= 값이 파일 이름이다.
  let name = /[?&]file=([^&#]+)/i.exec(text)?.[1] ?? text.split("?")[0].split("/").pop().trim();
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(name); i++) {
    try { name = decodeURIComponent(name); } catch { break; }
  }
  return nfc(name.split(/[\\/]/).pop()).trim(); // %2F로 감싼 경로가 풀리면 마지막 이름만(폴더 밖을 가리키지 않게)
}
export function attachmentNames(cell) {
  const text = String(cell ?? "").trim();
  if (!text) return [];
  try {
    const list = JSON.parse(text);
    if (Array.isArray(list)) return list.map((x) => plainName(x?.name || x?.link || x)).filter(Boolean);
  } catch {}
  // 첨부는 최대 5개까지 한 칸에 이어 쌓인다. 인코딩된 이름은 쉼표가 %2C가 되므로 쉼표로도 나눈다.
  return text.split(/%[0-9a-f]{2}/i.test(text) ? /[;,\n]/ : /[;\n]/).map(plainName).filter(Boolean);
}

// 엑셀 열 문자 → 0부터 세는 번호 (A → 0, K → 10, AA → 26)
const columnIndex = (letters) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// 응답 엑셀에서 머리글 행(at, 첫 번째로 값이 있는 행)과 항목별 열 번호(index). 빈 엑셀이면 at이 -1이다.
function formColumns(rows, columns) {
  const at = rows.findIndex((r) => r.some((v) => v !== ""));
  if (at < 0) return { at, index: {} };
  const head = rows[at].map((h) => nfc(h).trim());
  const index = {};
  for (const [key, name] of Object.entries(columns)) {
    if (!name) continue;
    index[key] = head.indexOf(nfc(name));
    if (index[key] < 0 && /^[A-Z]{1,2}$/i.test(name)) index[key] = columnIndex(name); // 머리글에 없으면 'K' 같은 열 문자로 본다
    if (index[key] < 0) throw new Error(`응답 엑셀에 '${name}' 열이 없습니다. 있는 열: ${head.filter(Boolean).join(", ")}`);
  }
  return { at, index };
}

// 응답 엑셀의 행을 작품 항목으로
export function formEntries(rows, columns) {
  const { at, index } = formColumns(rows, columns);
  if (at < 0) return [];
  const get = (row, key) => (index[key] === undefined ? "" : row[index[key]] ?? "");
  return rows
    .slice(at + 1)
    .map((row) => ({
      id: nfc(get(row, "id")).trim(),
      title: nfc(get(row, "title")).trim(),
      description: nfc(get(row, "description")).trim(),
      email: nfc(get(row, "email")).trim(),
      team: nfc(get(row, "team")).trim(),
      submitter: nfc(get(row, "submitter")).trim(),
      category: nfc(get(row, "category")).trim(),
      receivedOn: dayOf(get(row, "submittedAt")),
      files: attachmentNames(get(row, "files")),
    }))
    .filter((e) => e.id && e.title);
}

// OneDrive에서 아직 내려받지 않은(온라인 전용) 파일을 읽으면 macOS가 EDEADLK(-11)를 돌려준다. 읽기 시도가 내려받기를
// 시작하므로 잠시 기다렸다 다시 읽고, 끝내 안 되면 Finder에서 '항상 이 기기에 유지'를 고르라고 알린다.
const ONLINE_ONLY = -11;
export async function fromOneDrive(file, action, waitMs = 1000, tries = 10) {
  for (let i = 1; ; i++) {
    try {
      return await action();
    } catch (e) {
      if (e.errno !== ONLINE_ONLY) throw e;
      if (i >= tries)
        throw Object.assign(new Error(`OneDrive에서 아직 내려받지 않은 파일이라 읽지 못했습니다: ${nfc(path.basename(file))}. ` +
          "Finder에서 이 파일(또는 폴더)을 우클릭해 '항상 이 기기에 유지'(Always Keep on This Device)를 고른 뒤 다시 시도하세요."), { onlineOnly: true });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
export const readOneDrive = (file) => fromOneDrive(file, () => readFile(file));

// MIP(민감도 레이블)로 암호화된 엑셀은 zip(PK…)이 아닌 암호화 파일이라 이 PC의 Excel 앱으로 읽는다(excel-app.mjs).
export const isEncrypted = (buffer) => !(buffer[0] === 0x50 && buffer[1] === 0x4b);
const rowsOf = async (buffer, file, sheetName) => (isEncrypted(buffer) ? excelRows(file, sheetName) : readSheet(buffer, sheetName));
export const workbookRows = async (file, sheetName = "") => rowsOf(await readOneDrive(file), file, sheetName);

export async function readResponses(config) {
  return formEntries(await workbookRows(config.formsWorkbook, config.formsSheet), config.columns);
}

// 응답 엑셀에서 그 응답(id) 행의 칸을 고친다. values: { title, description } 처럼 항목 이름으로 준다(엑셀에 열이 없는 항목은 건너뛴다).
// 보통 엑셀은 그 칸만 바꿔 다시 쓰고, 암호화(MIP)된 엑셀은 Excel 앱이 고쳐 저장한다.
export async function writeResponse(config, id, values) {
  const file = config.formsWorkbook, sheetName = config.formsSheet;
  const buffer = await readOneDrive(file);
  const rows = await rowsOf(buffer, file, sheetName);
  const { at, index } = formColumns(rows, config.columns);
  const row = rows.findIndex((r, i) => i > at && nfc(r[index.id]).trim() === id);
  if (at < 0 || row < 0) throw new Error(`응답 엑셀에서 응답 ${id}을 찾지 못했습니다.`);
  const cells = Object.entries(values).filter(([key]) => index[key] >= 0).map(([key, value]) => ({ row, column: index[key], value }));
  if (isEncrypted(buffer)) await excelWrite(file, sheetName, cells);
  else await writeFile(file, patchCells(buffer, sheetName, cells));
}

// OneDrive가 허용하지 않는 글자를 빼고 길이를 줄인 폴더·파일 이름
export const safeName = (text) =>
  nfc(text).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "");
export const workFolder = (entry) => safeName(`${entry.id} ${entry.title}`);

// Forms 첨부 폴더 전체의 파일 이름 → 경로 (하위 폴더 포함)
export async function fileIndex(dir) {
  const index = new Map();
  const walk = async (folder) => {
    for (const item of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(folder, item.name);
      if (item.isDirectory()) await walk(full);
      else if (!index.has(nfc(item.name))) index.set(nfc(item.name), full);
    }
  };
  await walk(dir);
  return index;
}

const sameSize = async (a, b) => (await stat(b).catch(() => null))?.size === (await stat(a)).size;

// 첨부를 target 폴더로 복사하고 아직 동기화되지 않은 파일 이름을 돌려준다. 보호 문서도 그대로 복사한다(열람 권한은 문서를 따라간다).
export async function copyAttachments(names, index, target) {
  await mkdir(target, { recursive: true });
  const missing = [];
  for (const name of names) {
    const source = index.get(nfc(name));
    if (!source) missing.push(name);
    else if (!(await sameSize(source, path.join(target, name)))) {
      // 막 들어온 첨부가 아직 내려받는 중이면 기다리지 않고 '동기화 대기'로 두었다가 다음 읽기에서 복사한다.
      try {
        await fromOneDrive(source, () => copyFile(source, path.join(target, name)), 1000, 3);
      } catch (e) {
        if (!e.onlineOnly) throw e;
        missing.push(name);
      }
    }
  }
  return missing;
}

/* ─────────── 심사 배포 ─────────── */

export const evaluatorFolder = (config, evaluator) => path.join(config.reviewDir, "심사자", safeName(evaluator.name));
export const evaluationFile = (config, evaluator) =>
  path.join(evaluatorFolder(config, evaluator), safeName(evaluator.name) + " 평가표.xlsx");
export const EVALUATION_SHEET = "평가표";
const ENTRIES = ["실행 규모", "1차 결정", "제안자 의견", "심사 메모"]; // 점수 다음에 심사자가 적는 칸
const headerAt = (head) => (label) => head.findIndex((h) => h === label || h.startsWith(label + " ("));

// 이미 만든 평가표에서 심사자가 적은 칸을 접수 번호별로 그대로(고치기 전 값까지) 꺼낸다. 다시 쓸 때 잃지 않게 한다.
function enteredCells(rows, criteria) {
  const at = headerAt((rows[0] ?? []).map((h) => nfc(h).trim()));
  const columns = [...criteria.map((c) => at(c.name)), ...ENTRIES.map(at)];
  return new Map(rows.slice(1).filter((r) => nfc(r[0]).trim()).map((r) => [nfc(r[0]).trim(), columns.map((i) => (i < 0 ? "" : r[i] ?? ""))]));
}

// 심사자 평가표: 배정 작품 한 줄씩, 항목 점수 칸(배점 범위 확인)·총점(합계 수식)·규모·결정(목록 선택)·의견.
// entered(접수 번호 → 심사자가 적은 칸)는 그 자리에 다시 채운다.
export function evaluationWorkbook(works, criteria, options, entered = new Map()) {
  const n = criteria.length;
  const head = ["접수 번호", "작품명", "분야", "제출자", ...criteria.map((c) => `${c.name} (${c.weight})`), "총점", ...ENTRIES];
  const rows = works.map((w, i) => {
    const cells = entered.get(w.source.formId) ?? [];
    const r = i + 2;
    return [w.source.formId, w.name, w.category ?? "", w.submitterName ?? "", ...criteria.map((_, k) => cells[k] ?? ""),
      { formula: `SUM(E${r}:${String.fromCharCode(68 + n)}${r})` }, ...ENTRIES.map((_, k) => cells[n + k] ?? "")];
  });
  const last = works.length + 1;
  const column = (k) => String.fromCharCode(65 + k);
  const guide = [["항목", "배점", "판단 기준"], ...criteria.map((c) => [c.name, c.weight, c.guide]), [],
    ["실행 규모", "", options.scales.join(" · ")], ["1차 결정", "", options.decisions.join(" · ")],
    ["", "", "점수는 0.1점 단위로 적고, 실행 규모와 1차 결정은 칸의 목록에서 고릅니다."]];
  return writeWorkbook([
    {
      name: EVALUATION_SHEET,
      rows: [head, ...rows],
      widths: [10, 40, 16, 12, ...criteria.map(() => 14), 8, 12, 12, 40, 40],
      freeze: true,
      validations: works.length ? [
        ...criteria.map((c, k) => ({ range: `${column(4 + k)}2:${column(4 + k)}${last}`, between: [0, c.weight] })),
        { range: `${column(5 + n)}2:${column(5 + n)}${last}`, list: options.scales },
        { range: `${column(6 + n)}2:${column(6 + n)}${last}`, list: options.decisions },
      ] : [],
    },
    { name: "채점 기준", rows: guide, widths: [16, 8, 90] },
  ]);
}

const tenths = (x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-6;

// 심사자가 채운 평가표의 행(workbookRows) → 접수 번호별 평가. 아무것도 적지 않은 줄은 뺀다.
// complete: 모든 항목 점수(배점 안·0.1점 단위)와 규모·결정을 채웠다. problems: 고쳐야 할 칸.
export function readEvaluations(rows, criteria, options) {
  const at = headerAt((rows[0] ?? []).map((h) => nfc(h).trim()));
  const id = at("접수 번호");
  if (id < 0) throw new Error("평가표에 '접수 번호' 열이 없습니다.");
  const columns = criteria.map((c) => at(c.name));
  const [scaleAt, decisionAt, feedbackAt, noteAt] = ENTRIES.map(at);
  const result = new Map();
  for (const row of rows.slice(1)) {
    const formId = nfc(row[id]).trim();
    if (!formId) continue;
    const text = (i) => (i < 0 ? "" : nfc(row[i]).trim());
    const raw = columns.map((i) => (i < 0 ? "" : row[i]));
    const scale = text(scaleAt), decision = text(decisionAt), feedback = text(feedbackAt), note = text(noteAt);
    if (![...raw, scale, decision, feedback, note].some((v) => v !== "")) continue;
    const problems = [];
    const scores = raw.map((v, k) => {
      const n = typeof v === "number" ? v : v === "" ? NaN : Number(String(v).trim());
      if (!(n >= 0 && n <= criteria[k].weight && tenths(n))) {
        problems.push(`${criteria[k].name} 점수`);
        return null;
      }
      return n;
    });
    if (!options.scales.includes(scale)) problems.push("실행 규모");
    if (!options.decisions.includes(decision)) problems.push("1차 결정");
    const score = scores.every((s) => s !== null) ? scores.reduce((sum, s) => sum + Math.round(s * 10), 0) / 10 : null;
    result.set(formId, { scores, score, scale, decision, feedback, note, complete: !problems.length, problems });
  }
  return result;
}

// Power Automate용 공유 요청: '_공유 요청/<심사자>.json'. 흐름이 공유한 뒤 '_공유 요청/완료/'로 옮긴다.
const requestDir = (config) => path.join(config.reviewDir, "_공유 요청");
const requestName = (evaluator) => safeName(evaluator.name) + ".json";

export async function shareState(config, evaluator) {
  const done = await readFile(path.join(requestDir(config), "완료", requestName(evaluator)), "utf8").catch(() => "");
  if (done && JSON.parse(done).email === evaluator.email) return "공유 완료";
  return (await stat(path.join(requestDir(config), requestName(evaluator))).catch(() => null)) ? "공유 대기" : "요청 전";
}

async function requestShare(config, evaluator) {
  if ((await shareState(config, evaluator)) !== "요청 전") return;
  await mkdir(requestDir(config), { recursive: true });
  const folder = "/" + path.relative(config.root, evaluatorFolder(config, evaluator)).split(path.sep).join("/");
  await writeFile(path.join(requestDir(config), requestName(evaluator)),
    JSON.stringify({ name: evaluator.name, email: evaluator.email, folder, role: "write" }, null, 2));
}

// 심사 배포: 심사자마다 폴더를 만들어 담당 분야 작품의 첨부를 복사하고, 평가표를 만들고, 아직 공유하지 않았으면 공유를 요청한다.
// 평가표는 새로 배정된 작품이 있을 때만 다시 쓰고(심사자가 여는 중일 수 있어서), 이미 적은 칸과 줄은 그대로 둔다.
// works는 Forms에서 들어온 작품(source가 있는 것)이다.
// 이미 있는 평가표를 읽지 못하면(내려받지 않은 파일·손상 등) 심사자가 적은 값을 잃지 않게 다시 쓰지 않고 그 심사자에 오류를 남긴다.
// 보호(MIP)된 평가표는 Excel 앱으로 읽되, 덮어쓰면 보호가 풀리므로 새 작품을 덧붙이지 않는다.
export async function distribute(config, works, criteria, options) {
  const report = [];
  for (const evaluator of config.evaluators) {
    const mine = works.filter((w) => evaluator.categories.includes(w.category));
    try {
      const folder = evaluatorFolder(config, evaluator);
      for (const w of mine) {
        const source = path.join(config.reviewDir, "작품", w.source.folder);
        await copyAttachments(w.source.files, await fileIndex(source), path.join(folder, w.source.folder));
      }
      await mkdir(folder, { recursive: true });
      const file = evaluationFile(config, evaluator);
      const buffer = await readOneDrive(file).catch((e) => {
        if (e.code === "ENOENT") return null; // 아직 평가표가 없다
        throw e;
      });
      const entered = buffer ? enteredCells(await rowsOf(buffer, file, EVALUATION_SHEET), criteria) : new Map();
      const added = mine.filter((w) => !entered.has(w.source.formId)).length;
      const listed = works // 배정이 바뀌어도 적은 줄은 남기고, 접수 번호 순으로 둔다
        .filter((w) => mine.includes(w) || entered.has(w.source.formId))
        .sort((a, b) => a.source.formId.localeCompare(b.source.formId, "ko", { numeric: true }));
      if (added && buffer && isEncrypted(buffer))
        throw new Error(`보호된 평가표라 새 작품 ${added}건을 덧붙이지 않았습니다. 평가표의 민감도 레이블 암호화를 빼거나 파일을 옮긴 뒤 다시 배포하세요.`);
      if (added) await writeFile(file, evaluationWorkbook(listed, criteria, options, entered));
      await requestShare(config, evaluator);
      report.push({ name: evaluator.name, assigned: mine.length, added });
    } catch (e) {
      report.push({ name: evaluator.name, assigned: mine.length, added: 0, error: e.message });
    }
  }
  return report;
}
