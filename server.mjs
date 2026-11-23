import http from "node:http";
import { shownRefs } from "./reading-edition.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { amountTokens, checkSum } from "./amounts.mjs";
import { defaults, finalSheet, followupSheet, rubric, scoreRows, sheet, stalled, toCsv } from "./review.mjs";
import { similarWorks } from "./similar.mjs";
import { summarize, checkLogic } from "./reading.mjs";
import { ideaOpinion } from "./idea-opinion.mjs";
import { evaluate, compareResults, modelInfo, model } from "./model.mjs";
import { sampleImage } from "./scripts/sample.mjs";
import {
  checkSources, copyAttachments, distribute, evaluationFile, fileIndex, FORMS_DEFAULTS, formsConfig, homePath,
  placeLabel, readEvaluations, readOneDrive, readResponses, rootOf, shareState, storageRoots, workFolder,
} from "./forms-intake.mjs";
import { readSite, writeSite } from "./deploy/site.mjs";
import { attachmentPages } from "./attachment-pages.mjs";
import { macAddress, nasServer, publicOrigin } from "./deploy/nas-access.mjs";
import { readAccess, verifyCode } from "./deploy/access-code.mjs";
import { ai, aiSettings, haiku, haikuEffortNote, haikuLabel, matches, saveConnection, savedKey, saveKey, ticket, usageReport, validTicket, verifyKey, withHaiku } from "./claude-summary.mjs";
import { dailyUsage, newHaikuUsage, recordHaikuUsage, reportedUsage, usageSnapshot } from "./haiku-usage.mjs";

process.umask(0o077);
const root = path.dirname(fileURLToPath(import.meta.url));
const nasMode = process.env.REVIEW_NAS_MODE === "1";
// 데이터 폴더: REVIEW_DATA_DIR(./start.sh는 두 방식 모두 ContestReviewDesk), 없으면 웹 주소 방식은 ContestReviewWeb
const directory = process.env.REVIEW_DATA_DIR ||
  path.join(os.homedir(), "Library", "Application Support", nasMode ? "ContestReviewWeb" : "ContestReviewDesk");
await mkdir(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(directory, "desk.sqlite3"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, work TEXT NOT NULL REFERENCES works(id), image BLOB NOT NULL); CREATE INDEX IF NOT EXISTS images_work ON images(work);",
);
const put = db.prepare(
  "INSERT INTO works(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
);
db.exec(`CREATE TABLE IF NOT EXISTS original_pdfs (
  work TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  pdf BLOB NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS last_haiku_usage (
  work TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, rev INTEGER NOT NULL, usage TEXT NOT NULL,
  PRIMARY KEY(work,kind)
)`);
const saveUsage = db.prepare(`INSERT INTO last_haiku_usage(work,kind,rev,usage) VALUES(?,?,?,?)
  ON CONFLICT(work,kind) DO UPDATE SET rev=excluded.rev, usage=excluded.usage`);
const readUsage = db.prepare("SELECT kind,usage FROM last_haiku_usage WHERE work=? AND rev=?");
// Haiku 실행 기록(실행마다 한 줄). 작품을 지워도 남겨 날짜별 합계를 실제 청구와 대조한다.
db.exec(`CREATE TABLE IF NOT EXISTS haiku_runs (
  run TEXT PRIMARY KEY, work TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, usage TEXT NOT NULL
)`);
const saveRun = db.prepare(`INSERT INTO haiku_runs(run,work,kind,at,usage) VALUES(?,?,?,?,?)
  ON CONFLICT(run) DO UPDATE SET usage=excluded.usage`);
const readRuns = db.prepare("SELECT at,usage FROM haiku_runs WHERE at>=? ORDER BY at");
const firstRun = db.prepare("SELECT min(at) at FROM haiku_runs");
const selectWork = db.prepare("SELECT data FROM works WHERE id=?");
const selectImage = db.prepare("SELECT image FROM images WHERE id=?");
// 목록 화면용 요약 열. 폴링마다 모든 작품 JSON을 다시 읽지 않도록 결과를 캐시한다.
const selectSummaries = db.prepare(
  `SELECT id, json_extract(data,'$.name') name, json_extract(data,'$.rev') rev, json_extract(data,'$.updated') updated,
  json_extract(data,'$.receivedOn') receivedOn, json_extract(data,'$.intakeTeam') intakeTeam, json_extract(data,'$.submitterName') submitterName,
  CASE WHEN json_extract(data,'$.cloudReading.rev')=json_extract(data,'$.rev') THEN 1 ELSE 0 END hasReading, -- 화면은 AI 요약만 쓴다
  CASE WHEN json_extract(data,'$.cloudReading.rev')=json_extract(data,'$.rev') AND json_extract(data,'$.cloudReading.edition.brief[0].topic')='한 줄 요약'
    THEN json_extract(data,'$.cloudReading.edition.brief[0].text') END gist, -- 목록에서 제목 아래에 보여 준다
  CASE WHEN json_extract(data,'$.cloudReading.rev')=json_extract(data,'$.rev') AND json_extract(data,'$.cloudLogic.reading')=json_extract(data,'$.cloudReading.id')
    THEN 1 ELSE 0 END hasLogic, -- 지금 요약에 대한 사실·논리 점검이 끝났는가
  json_array_length(data,'$.captures') count,
  CASE WHEN json_type(data,'$.final')='object' THEN 1 ELSE 0 END final,
  json_extract(data,'$.final.decision') decision, json_extract(data,'$.final.scale') scale, json_extract(data,'$.final.score') score,
  json_extract(data,'$.category') category, json_extract(data,'$.source.formId') formId, -- MS Forms로 들어온 작품
  json_array_length(data,'$.source.missing') waiting, -- 아직 OneDrive에 동기화되지 않은 첨부 수
  (SELECT count(*) FROM json_each(data,'$.evaluations') WHERE json_extract(value,'$.complete')) evalDone,
  (SELECT round(avg(json_extract(value,'$.score')), 2) FROM json_each(data,'$.evaluations') WHERE json_extract(value,'$.complete')) evalAvg,
  json_extract(data,'$.followup.stage') followStage, json_extract(data,'$.followup.due') followDue, json_extract(data,'$.followup.updated') followUpdated, -- 채택 뒤 실행 추적
  (SELECT count(*) FROM json_each(data,'$.similar') WHERE value='중복') duplicates -- 사람이 '중복'으로 판정한 비슷한 제안 수
  FROM works ORDER BY rowid DESC`,
);
let summaries = null; // works 테이블이 바뀌면 null로 비운다
const summaryList = () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return (summaries ??= selectSummaries.all().map((x) =>
    ({ ...x, stalled: stalled(x.followStage && { stage: x.followStage, due: x.followDue, updated: x.followUpdated }, today) })));
};
const save = (w) => {
  w.updated = new Date().toISOString();
  put.run(w.id, JSON.stringify(w));
  summaries = null;
  return w;
};
const list = () =>
  db
    .prepare("SELECT data FROM works ORDER BY rowid DESC")
    .all()
    .map((x) => JSON.parse(x.data));
const load = (id) => {
  const row = selectWork.get(id);
  if (!row) err("작품을 찾을 수 없습니다.", 404);
  return JSON.parse(row.data);
};
const image = (id) => {
  const row = selectImage.get(id);
  if (!row) err("이미지를 찾을 수 없습니다.", 404);
  return Buffer.from(row.image);
};
// 캡처 목록용 작은 미리보기. 원본은 확대 보기에서만 내려받는다.
const thumbnail = (id) =>
  sharp(image(id)).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
function err(msg, status = 400) {
  throw Object.assign(new Error(msg), { status });
}
function bounded(x, max) {
  if (typeof x !== "string" || x.length > max) err("입력 길이를 확인하세요.");
  return x.trim();
}
function integer(x) {
  if (x === null || x === undefined || x === "") return null;
  if (!Number.isInteger(x) || x < 1 || x > 2000)
    err("쪽수는 1~2000의 정수입니다.");
  return x;
}
function changed(w, reset = false) {
  w.rev++;
  if (reset) w.complete = false;
  w.final = null;
  w.error = "";
}
function atomic(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function intakeFields(values, previous) {
  const receivedOn = bounded(values.receivedOn ?? previous.receivedOn ?? "", 10);
  if (receivedOn) {
    const day = new Date(receivedOn + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || receivedOn.startsWith("0000") ||
        !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== receivedOn)
      err("인입 날짜를 확인하세요.");
  }
  return {
    receivedOn,
    intakeTeam: bounded(values.intakeTeam ?? previous.intakeTeam ?? "", 80),
    submitterName: bounded(values.submitterName ?? previous.submitterName ?? "", 80),
  };
}
function newWork(name, spec = defaults, values = {}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return save({
    id: randomUUID(),
    name,
    ...intakeFields(values, { receivedOn: today }),
    intakeVersion: 0,
    rev: 0,
    rubric: rubric(spec),
    complete: false,
    captures: [],
    result: null,
    final: null,
    error: "",
  });
}
/* ─────────────── MS Forms 공모 연동 (forms-intake.mjs, 설정: deploy/site.json의 forms) ───────────────
   1분마다 응답 엑셀이 바뀌었으면 새 응답을 작품으로 만들고 첨부를 '작품/<번호 작품명>' 폴더로 복사한다.
   심사자 평가표가 바뀌었으면 다시 읽어 작품의 evaluations[심사자 이메일]에 둔다. 평가표는 공통 기준(defaults.criteria)을 쓴다. */
const intake = { config: null, error: "", checkedAt: "", seen: new Map(), running: null, view: { configured: false } };
const formWorks = () => list().filter((w) => w.source?.formId);
const withoutTime = (x) => JSON.stringify(x && { ...x, at: 0 });

async function importResponses(config) {
  const book = await stat(config.formsWorkbook).catch(() => null);
  if (!book) throw new Error("응답 엑셀이 아직 없습니다: " + config.formsWorkbook);
  const known = new Map(formWorks().map((w) => [w.source.formId, w]));
  const waiting = [...known.values()].some((w) => w.source.missing.length);
  if (intake.seen.get("forms") === book.mtimeMs && !waiting) return;
  const index = await fileIndex(config.attachmentsDir);
  const problems = [];
  for (const entry of await readResponses(config)) {
    try {
      let w = known.get(entry.id);
      if (!w) {
        w = newWork(entry.title.slice(0, 140), defaults, {
          receivedOn: entry.receivedOn || undefined, intakeTeam: entry.team.slice(0, 80), submitterName: entry.submitter.slice(0, 80),
        });
        w.category = entry.category;
        w.source = { formId: entry.id, files: entry.files, folder: workFolder(entry), missing: entry.files,
          email: entry.email.slice(0, 200), description: entry.description.slice(0, 4000) };
        save(w);
      }
      if (JSON.stringify(w.source.files) !== JSON.stringify(entry.files)) // 첨부 이름 읽는 방식이 바뀐 예전 응답
        Object.assign(w.source, { files: entry.files, missing: entry.files, read: {} });
      if (!w.source.missing.length) continue;
      w.source.missing = await copyAttachments(w.source.files, index, path.join(config.reviewDir, "작품", w.source.folder));
      save(w);
    } catch (e) {
      problems.push(`응답 ${entry.id}: ${e.message}`);
    }
  }
  if (problems.length) throw new Error(problems.join(" · "));
  intake.seen.set("forms", book.mtimeMs);
}

async function collectEvaluations(config) {
  const errors = {};
  for (const evaluator of config.evaluators) {
    const file = evaluationFile(config, evaluator);
    const info = await stat(file).catch(() => null);
    if (!info || intake.seen.get(evaluator.email) === info.mtimeMs) continue;
    try {
      const results = readEvaluations(await readOneDrive(file), defaults.criteria, sheet);
      for (const w of formWorks()) {
        const result = results.get(w.source.formId);
        const next = result ? { name: evaluator.name, ...result, at: info.mtime.toISOString() } : undefined;
        if (withoutTime(next) === withoutTime(w.evaluations?.[evaluator.email])) continue;
        w.evaluations = { ...w.evaluations, [evaluator.email]: next };
        save(w);
      }
      intake.seen.set(evaluator.email, info.mtimeMs);
    } catch (e) {
      errors[evaluator.email] = e.message;
    }
  }
  return errors;
}

// 목록 화면의 '공모 연동' 칸에 보여 줄 현황
async function intakeView(config, errors = {}) {
  if (!config) return { configured: false, error: intake.error };
  const works = formWorks();
  const covered = new Set(config.evaluators.flatMap((e) => e.categories));
  const unassigned = {};
  for (const w of works) if (!covered.has(w.category)) unassigned[w.category || "분야 없음"] = (unassigned[w.category || "분야 없음"] ?? 0) + 1;
  return {
    configured: true,
    error: intake.error,
    checkedAt: intake.checkedAt,
    reviewDir: path.relative(config.root, config.reviewDir),
    responses: works.length,
    waiting: works.filter((w) => w.source.missing.length).length,
    unassigned,
    evaluators: await Promise.all(config.evaluators.map(async (e) => {
      const mine = works.filter((w) => e.categories.includes(w.category));
      const entries = mine.map((w) => w.evaluations?.[e.email]).filter(Boolean);
      return {
        name: e.name, email: e.email, categories: e.categories, share: await shareState(config, e), assigned: mine.length,
        done: entries.filter((x) => x.complete).length, fix: entries.filter((x) => !x.complete).length,
        readAt: entries.map((x) => x.at).sort().at(-1) ?? "", error: errors[e.email] ?? "",
      };
    })),
  };
}

// MS Forms 첨부를 캡처로 자동 접수한다(그림은 그대로, PDF·Word·PowerPoint·Excel은 쪽마다, attachment-pages.mjs).
// 파일마다 결과를 source.read에 남긴다: { pages } 또는 { error }. 못 읽은 파일은 심사자가 직접 캡처한다.
function ingestAttachments(config, w) {
  const key = "ingest-" + w.id;
  const todo = w.source.files.filter((n) => !w.source.missing.includes(n) && !w.source.read?.[n]);
  if (!todo.length || tasks.has(key)) return;
  schedule(key, w.id, "첨부 읽는 중", async (progress) => {
    for (const name of todo) {
      progress(name + " · 열어서 캡처하는 중");
      let result;
      try {
        const pages = await attachmentPages(path.join(config.reviewDir, "작품", w.source.folder, name));
        for (const [i, bytes] of pages.entries())
          await addImage(w.id, { document: name, page: i + 1, total: pages.length }, bytes).catch((e) => {
            if (e.status !== 409) throw e; // 이미 접수한 같은 쪽
          });
        result = { pages: pages.length };
      } catch (e) {
        result = { error: String(e.message).slice(0, 300) };
      }
      const fresh = load(w.id);
      fresh.source.read = { ...fresh.source.read, [name]: result };
      save(fresh);
    }
  });
}

function syncIntake() {
  intake.running ??= (async () => {
    let errors = {};
    try {
      intake.config = formsConfig(readSite().forms);
      intake.error = "";
      if (intake.config) {
        await importResponses(intake.config).catch((e) => (intake.error = e.message)); // 응답에 문제가 있어도 평가표는 읽는다
        for (const w of formWorks()) ingestAttachments(intake.config, w);
        errors = await collectEvaluations(intake.config);
      }
    } catch (e) {
      intake.error = e.message;
    }
    intake.checkedAt = new Date().toISOString();
    intake.view = await intakeView(intake.config, errors).catch((e) => ({ configured: !!intake.config, error: e.message }));
  })().finally(() => (intake.running = null));
  return intake.running;
}
syncIntake();
setInterval(syncIntake, 60_000).unref();
const tasks = new Map();
// 이 맥의 자원을 쓰는 작업(OCR·로컬 모델)은 한 줄로 차례로 처리한다.
// Haiku 요청은 맥 자원을 거의 쓰지 않으므로 별도 줄에서 처리해 OCR을 막지 않는다.
const queues = { local: Promise.resolve(), cloud: Promise.resolve() };
function schedule(key, work, label, fn, lane = "local") {
  if (tasks.has(key)) err("이미 대기 중인 작업입니다.", 409);
  const job = { work, label: "대기 · " + label };
  tasks.set(key, job);
  queues[lane] = queues[lane]
    .then(async () => {
      job.label = label;
      try {
        await fn((s) => {
          job.label = s;
        });
      } catch (e) {
        const w = load(work);
        w.error = String(e.message).slice(0, 1200);
        save(w);
      } finally {
        tasks.delete(key);
      }
    })
    .catch((e) => console.error("작업 처리 오류", e.name));
}
function runOcr(buffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "ocr.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdout.on("data", (x) => {
      bytes += x.length;
      if (bytes > 12e6) child.kill();
      else stdout.push(x);
    });
    child.stderr.on("data", (x) => {
      if (stderr.length < 15) stderr.push(x);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(
          new Error(
            "Kordoc OCR 실패 · " + Buffer.concat(stderr).toString().slice(-450),
          ),
        );
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString()));
      } catch {
        reject(new Error("OCR 응답을 읽을 수 없습니다."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}
function enqueueOcr(wid, cid) {
  schedule("ocr-" + cid, wid, "Kordoc 문자 인식 중", async () => {
    let result, problem;
    try {
      result = await runOcr(image(cid));
    } catch (e) {
      problem = e.message;
    }
    const w = load(wid),
      c = w.captures.find((x) => x.id === cid);
    if (!c) return;
    c.lines = result?.lines ?? [];
    if (result)
      c.ocrInfo = {
        version: 2,
        deskewAngle: result.deskewAngle || 0,
        tables: result.tables || [],
        uncertain: result.uncertain || [],
        detailRead: !!result.detailRead,
        detailFailed: !!result.detailFailed,
        added: result.added || 0,
        dropped: result.dropped || 0,
      };
    else delete c.ocrInfo;
    c.amounts = amountTokens(c.lines);
    c.sumCheck = null;
    c.ocrWidth = result?.width || c.width;
    c.ocrHeight = result?.height || c.height;
    c.status = problem ? "failed" : "ready";
    c.ocrError =
      problem ||
      (!c.lines.length
        ? "인식한 문장이 없습니다. 확대 캡처 또는 도식 검토를 사용하세요."
        : "");
    changed(w);
    save(w);
  });
}
async function addImage(wid, b, bytes) {
  if (!bytes?.length || bytes.length > 14 * 1024 * 1024)
    err("한 장에 14MB 이하의 PNG, JPG 또는 WebP를 사용하세요.");
  const input = sharp(bytes, { limitInputPixels: 32e6, failOn: "error" });
  const meta = await input.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format) || (meta.pages || 1) > 1)
    err("PNG, JPG 또는 WebP 단일 이미지를 사용하세요.");
  const { data, info } = await input
    .rotate()
    .flatten({ background: "white" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const w = load(wid);
  if (w.captures.length >= 150) err("작품당 캡처는 150장까지입니다.");
  const document = bounded(b.document || "제안서", 100),
    page = integer(b.page),
    total = integer(b.total);
  if (page && total && page > total) err("현재 쪽이 전체 쪽수보다 큽니다.");
  const hash = createHash("sha256").update(data).digest("hex");
  if (
    w.captures.some(
      (c) => c.hash === hash && c.document === document && c.page === page,
    )
  )
    err("같은 위치에 이미 접수한 화면입니다.", 409);
  const label = bounded(
    b.label || document + (page ? " " + page + "쪽" : ""),
    180,
  );
  const c = {
    id: randomUUID(),
    document,
    page,
    total,
    label,
    hash,
    visual: b.visual === true,
    issue: bounded(b.issue || "", 300),
    lines: [],
    status: "queued",
    width: info.width,
    height: info.height,
  };
  w.captures.push(c);
  changed(w, true);
  atomic(() => {
    db.prepare("INSERT INTO images(id,work,image) VALUES(?,?,?)").run(
      c.id,
      w.id,
      data,
    );
    save(w);
  });
  enqueueOcr(w.id, c.id);
  return c.id;
}
for (const w of list()) {
  let migrated = false;
  for (const c of w.captures) {
    if (c.status === "queued") enqueueOcr(w.id, c.id);
    if (c.status === "ready" && !c.amounts) {
      c.amounts = amountTokens(c.lines);
      migrated = true;
    }
  }
  if (migrated) save(w);
}
async function body(req) {
  const parts = [];
  let n = 0;
  for await (const b of req) {
    n += b.length;
    if (n > 20 * 1024 * 1024) err("요청 용량 초과", 413);
    parts.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || "{}");
  } catch {
    err("JSON 입력 오류");
  }
}
const port = Number(process.env.REVIEW_PORT || 18765);
const assets = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/expanded-reading.mjs": ["expanded-reading.mjs", "text/javascript"],
  "/html.mjs": ["html.mjs", "text/javascript"],
  "/diagram-hint.mjs": ["diagram-hint.mjs", "text/javascript"],
  "/glossary.mjs": ["glossary.mjs", "text/javascript"],
  "/interactions.mjs": ["interactions.mjs", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
  "/nikola-tesla.png": ["nikola-tesla.png", "image/png"],
  "/fonts/BithumbGothic-Basic.woff2": ["fonts/BithumbGothic-Basic.woff2", "font/woff2"],
  "/fonts/BithumbGothic-Original.woff2": ["fonts/BithumbGothic-Original.woff2", "font/woff2"],
  "/fonts/BithumbGothic-OFL.txt": ["fonts/BithumbGothic-OFL.txt", "text/plain"],
  "/fonts/nanum-myeongjo.css": ["fonts/nanum-myeongjo.css", "text/css"],
  "/fonts/nanum-myeongjo/OFL.txt": ["fonts/nanum-myeongjo/OFL.txt", "text/plain"],
};
// 나눔명조는 글자 범위별 파일이 많아 이름 꼴로 허용한다(public/fonts/nanum-myeongjo/nanum-myeongjo-<번호|latin>-<굵기>-normal.woff2).
const myeongjoFile = /^\/fonts\/nanum-myeongjo\/(nanum-myeongjo-(?:\d+|latin)-(?:400|700)-normal\.woff2)$/;
const redeemedLinks = new Map();
const cookie = (req, name) =>
  new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(req.headers.cookie || "")?.[1];
// 쿠키를 여러 개 내려줄 수 있도록 기존 Set-Cookie에 덧붙인다.
function addCookie(res, name, value) {
  const line = name + "=" + value + "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict";
  res.setHeader("Set-Cookie", [].concat(res.getHeader("Set-Cookie") || [], line));
}
function cloudAccess(req, key) {
  return !!key && (!nasMode || validTicket(key, "browser", cookie(req, "__Host-review-session")));
}
// 맥의 파일 선택 창(AppleScript). 취소하면 "". 선택 창이 떠 있는 동안 요청이 기다린다.
function chooseOnMac(file, start) {
  const quote = (t) => '"' + String(t).replace(/[\\"]/g, "\\$&") + '"';
  const where = start ? ` default location (POSIX file ${quote(start)})` : "";
  const ask = file
    ? `choose file with prompt "MS Forms 응답 엑셀을 고르세요" of type {"org.openxmlformats.spreadsheetml.sheet"}${where}`
    : `choose folder with prompt "첨부 파일이 내려받아지는 폴더를 고르세요"${where}`;
  return new Promise((resolve, reject) =>
    execFile("osascript", ["-e", "activate", "-e", `POSIX path of (${ask})`], { timeout: 600_000 }, (e, out, errText) =>
      e ? (/-128/.test(errText) ? resolve("") : reject(new Error("선택 창을 열지 못했습니다: " + errText.trim())))
        : resolve(path.resolve(out.trim()))));
}
// AI 키를 바꿀 수 있는 곳: 맥 앱, 키를 아직 등록하지 않았을 때, 키를 등록(연결)한 브라우저
async function canManage(req) {
  const key = await savedKey();
  return !nasMode || !key || cloudAccess(req, key);
}
function rememberCloudBrowser(res, key) {
  if (nasMode) addCookie(res, "__Host-review-session", ticket(key, "browser", 30 * 86400));
}

/* 웹(NAS) 접속 보호: deploy/web-access.json이 있으면 접속 코드를 확인한 브라우저만 API를 쓴다.
   세션 서명 키 = 이 맥에만 있는 비밀값 + 코드 해시. 코드를 바꾸면 기존 로그인은 모두 풀린다. */
const access = nasMode ? readAccess() : null;
const sessionKey = access && (await webSecret()) + ":" + access.hash;
async function webSecret() {
  const file = path.join(directory, "session.secret");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const secret = randomBytes(32).toString("hex");
    await writeFile(file, secret, { mode: 0o600, flag: "wx" });
    return secret;
  }
}
const hasAccess = (req) => !access || validTicket(sessionKey, "access", cookie(req, "__Host-review-access"));
const rememberAccess = (res) => access && addCookie(res, "__Host-review-access", ticket(sessionKey, "access", 30 * 86400));
const loginFailures = []; // 최근 10분 실패 시각 (무차별 대입 방지)
function login(res, code) {
  const now = Date.now();
  while (loginFailures.length && loginFailures[0] < now - 600000) loginFailures.shift();
  if (loginFailures.length >= 30) err("접속 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.", 429);
  if (!verifyCode(access, code)) {
    loginFailures.push(now);
    err("접속 코드가 맞지 않습니다.", 401);
  }
  rememberAccess(res);
}

// 엔진 상태는 뒤에서 갱신한다. Ollama가 느려도 목록 응답(/api/state)은 기다리지 않는다.
let healthValue = null,
  healthAt = 0,
  healthCheck = null;
async function checkHealth() {
  const [m, files] = await Promise.all([
    modelInfo().catch(() => null),
    Promise.all(
      ["det.onnx", "rec_korean.onnx", "rec_korean.yml"].map((x) =>
        stat(path.join(root, "vendor/models/ppocr", x)).catch(() => null),
      ),
    ),
  ]);
  healthValue = { model, modelReady: !!m, ocrReady: files.every(Boolean) };
  healthAt = Date.now();
}
async function health() {
  if (Date.now() - healthAt > 5000 && !healthCheck)
    healthCheck = checkHealth().finally(() => (healthCheck = null));
  if (!healthValue) await healthCheck; // 서버 시작 직후 한 번만 기다린다
  return healthValue;
}
async function handleRequest(req, res) {
  function json(data, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  }
  try {
    const host = req.headers.host;
    if (!nasMode && !["localhost:" + port, "127.0.0.1:" + port].includes(host))
      err("로컬 주소만 허용합니다.", 403);
    if (!nasMode && req.headers.origin && req.headers.origin !== "http://" + host)
      err("다른 출처의 요청입니다.", 403);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const { pathname, searchParams } = new URL(req.url, "http://" + host);
    if (req.method === "POST" && pathname === "/api/login") {
      if (access) login(res, (await body(req)).code);
      return json({ ok: true });
    }
    // 맥에서 연 일회용 연결 링크(/api/summary-link)는 자체 검증 후 접속도 허용한다.
    if (pathname.startsWith("/api/") && pathname !== "/api/summary-link" && !hasAccess(req))
      err("접속 코드를 입력하세요.", 401);
    if (req.method === "GET" && pathname === "/api/summary-settings") {
      const key = await savedKey();
      // 키가 아직 없으면 어느 브라우저에서든 처음 등록할 수 있고, 그 뒤로는 등록한 브라우저(또는 지금 키를 아는 사람)만 바꾼다.
      return json({ model: haiku, effort: haikuEffortNote, label: haikuLabel, provider: ai.provider, endpoint: ai.custom, configured: !!key, connected: !!key,
        canManageKey: await canManage(req), local: !nasMode });
    }
    // 공모 연동 설정: 응답 엑셀·첨부 폴더와 읽은 결과(열은 회사 Forms 엑셀 구조로 자동 매칭)
    if (req.method === "GET" && pathname === "/api/forms-settings") {
      const config = intake.config;
      const roots = await storageRoots(config?.root);
      const place = (p) => p && { path: p, label: placeLabel(roots, p) };
      return json({ workbook: place(config?.formsWorkbook), attachments: place(config?.attachmentsDir),
        check: config && await checkSources(config), error: intake.error });
    }
    // 최근 7일(UTC)의 Haiku 사용량: 앱이 기록한 합계와 Anthropic이 집계한 토큰을 나란히 돌려준다.
    if (req.method === "GET" && pathname === "/api/haiku-cost") {
      const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
      const since = day(-6) + "T00:00:00Z";
      const days = dailyUsage(readRuns.all(since).map((r) => ({ at: r.at, usage: JSON.parse(r.usage) })));
      const key = await savedKey();
      let reported = null, reportError = key ? "" : "API 키가 없습니다.";
      if (key) try { reported = reportedUsage(await usageReport(key, since, day(1) + "T00:00:00Z"), haiku); }
        catch (e) { reportError = e.status ? "status " + e.status : e.message; }
      return json({ days, reported, reportError, recordingSince: firstRun.get().at });
    }
    const myeongjo = req.method === "GET" && myeongjoFile.exec(pathname)?.[1];
    if (req.method === "GET" && (assets[pathname] || myeongjo)) {
      const [f, m] = assets[pathname] || ["fonts/nanum-myeongjo/" + myeongjo, "font/woff2"];
      const font = m.startsWith("font/");
      res.setHeader("Content-Type", m.startsWith("text/") ? m + "; charset=utf-8" : m);
      if (font) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.end(await readFile(path.join(root, "public", f)));
    }
    if (req.method === "GET" && pathname === "/api/state") {
      return json({
        app: "contest-review-desk",
        works: summaryList(),
        tasks: [...tasks.values()],
        health: await health(),
        defaults,
        sheet,
        intake: intake.view,
        ai: { provider: ai.provider, label: haikuLabel },
      });
    }
    // 전체 채점 결과 (엑셀에서 여는 CSV)
    if (req.method === "GET" && pathname === "/api/export") {
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`채점 결과 ${day}.csv`)}`);
      return res.end(toCsv(scoreRows(list(), defaults.criteria)));
    }
    const match = pathname.match(/^\/api\/(work|image|original|similar)\/([0-9a-f-]{36})$/);
    if (req.method === "GET" && match) {
      // 비슷한 제안 (similar.mjs). 판정(중복·관련·무관)은 어느 쪽 작품에 남겼든 함께 보여 준다.
      if (match[1] === "similar") {
        const works = list();
        const self = works.find((w) => w.id === match[2]) ?? err("작품을 찾을 수 없습니다.", 404);
        const byId = new Map(works.map((w) => [w.id, w]));
        return json(similarWorks(works, self.id).map((x) => ({ ...x, mark: self.similar?.[x.id] ?? byId.get(x.id).similar?.[self.id] ?? "" })));
      }
      if (match[1] === "work") {
        const work = load(match[2]);
        // 예전에 만든 요약도 근거 칩이 수치가 적힌 쪽을 가리키게 보낸다(저장된 요약은 그대로 둔다).
        for (const reading of [work.cloudReading, work.reading])
          if (reading?.edition && reading.evidence)
            for (const view of ["brief", "detail"])
              reading.edition[view] = (reading.edition[view] || []).map((p) => ({ ...p, refs: shownRefs(p, reading.evidence) }));
        if (work.original) {
          delete work.original.license;
          delete work.original.notice;
        }
        work.lastHaikuUsage = Object.fromEntries(readUsage.all(work.id, work.rev)
          .map((row) => [row.kind, JSON.parse(row.usage)]));
        return json(work);
      }
      if (match[1] === "original") {
        const original = db.prepare("SELECT pdf FROM original_pdfs WHERE work=?").get(match[2]);
        if (!original) err("등록된 원본 PDF가 없습니다.", 404);
        const filename = encodeURIComponent(load(match[2]).name + ".pdf").replace(/'/g, "%27");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + filename);
        return res.end(original.pdf);
      }
      // 캡처 이미지는 id마다 내용이 바뀌지 않으므로 브라우저에만(private) 오래 보관한다.
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      if (searchParams.get("size") === "thumb") {
        res.setHeader("Content-Type", "image/webp");
        return res.end(await thumbnail(match[2]));
      }
      res.setHeader("Content-Type", "image/png");
      return res.end(image(match[2]));
    }
    if (req.method !== "POST" || !pathname.startsWith("/api/"))
      err("경로를 찾을 수 없습니다.", 404);
    if (!req.headers["content-type"]?.startsWith("application/json"))
      err("JSON으로 요청하세요.", 415);
    const b = await body(req);
    // 요약 설정 저장: API 키·연결 주소(비우면 Anthropic, LiteLLM 주소면 LiteLLM)·모델(기본 Haiku 5.5).
    // 키를 비우면 지금 키를 그대로 쓴다. 저장 전에 그 키와 설정으로 모델을 쓸 수 있는지 확인한다.
    if (pathname === "/api/summary-token") {
      const current = await savedKey();
      const typed = bounded(b.key ?? "", 512);
      if (nasMode && current && !cloudAccess(req, current) && !matches(typed, current))
        err("설정은 키를 등록한 브라우저에서 바꿀 수 있습니다. 이 브라우저를 연결하려면 지금 등록된 키를 입력하세요.", 403);
      const connection = aiSettings({ baseUrl: bounded(b.baseUrl ?? "", 300), model: bounded(b.model ?? "", 100) });
      const key = typed || current;
      if (!key) err("API 키를 입력하세요.");
      if (connection.provider === "anthropic" && !/^sk-ant-[A-Za-z0-9_-]+$/.test(key))
        err("Anthropic API 키(sk-ant-…)를 확인하세요. LiteLLM 키라면 연결 주소를 함께 입력하세요.");
      await verifyKey(key, connection);
      await saveConnection(connection);
      if (!matches(key, current)) await saveKey(key);
      rememberCloudBrowser(res, key);
      return json({ connected: true });
    }
    if (pathname === "/api/summary-link") {
      const key = await savedKey();
      if (!key) err("요약 설정에서 API 키를 등록하세요.");
      if (!nasMode) return json({ url: publicOrigin + "/#connect=" + ticket(key, "link", 90) });
      for (const [code, expires] of redeemedLinks) if (expires <= Date.now()) redeemedLinks.delete(code);
      if (!validTicket(key, "link", b.code) || redeemedLinks.has(b.code))
        err("브라우저 연결 링크가 만료되었습니다. 맥의 요약 설정에서 다시 여세요.", 403);
      redeemedLinks.set(b.code, Number(b.code.split(".")[0]));
      rememberCloudBrowser(res, key);
      rememberAccess(res);
      console.log("맥에서 연 웹 브라우저의 AI 요약 연결 완료");
      return json({ connected: true });
    }
    if (pathname === "/api/create") {
      const name = bounded(b.name, 140);
      if (!name) err("작품명을 입력하세요.");
      return json({ id: newWork(name, b.rubric, b).id }, 201);
    }
    if (pathname === "/api/sample") {
      const isUmbrella = b.kind === "umbrella";
      const w = newWork(
        (isUmbrella ? "비 오는 날 공유 우산" : "입금 지연 상담 개선") +
          " · 합성 예제",
      );
      await addImage(
        w.id,
        {
          document: "합성 제안서",
          page: 1,
          total: 1,
          label: "합성 제안서 1쪽",
        },
        await sampleImage(b.kind),
      );
      return json({ id: w.id }, 201);
    }
    // 찾아보기: 서버 맥 화면에 파일·폴더 선택 창을 띄워(맥 앞에 있는 사람만 고를 수 있다) 응답 엑셀(kind=workbook)이나 첨부 폴더(attachments)를 고른다.
    if (pathname === "/api/forms-choose") {
      const roots = await storageRoots(intake.config?.root);
      const now = b.kind === "workbook" ? intake.config?.formsWorkbook : intake.config?.attachmentsDir;
      const chosen = await chooseOnMac(b.kind === "workbook", now ? path.dirname(now) : roots[0]);
      if (chosen && !rootOf(roots, chosen)) err("이 맥에 동기화된 OneDrive 폴더 안에서 고르세요.");
      return json({ path: chosen, label: chosen && placeLabel(roots, chosen) });
    }
    // 공모 연동 설정 저장: 응답 엑셀·첨부 폴더를 deploy/site.json의 forms에 적는다. 열 매칭 등 나머지 값은 그대로(처음이면 회사 Forms 기본값).
    if (pathname === "/api/forms-settings") {
      const roots = await storageRoots(intake.config?.root);
      const pick = (value) => (path.isAbsolute(String(value ?? "")) ? path.resolve(value) : "");
      const workbook = pick(b.workbook), attachments = pick(b.attachments);
      if (!rootOf(roots, workbook) || !/\.xlsx$/i.test(workbook) || !(await stat(workbook).catch(() => null))?.isFile())
        err("OneDrive 폴더 안의 응답 엑셀(.xlsx)을 고르세요.");
      if (!rootOf(roots, attachments) || !(await stat(attachments).catch(() => null))?.isDirectory())
        err("OneDrive 폴더 안의 첨부 파일 폴더를 고르세요.");
      const site = readSite();
      const forms = { ...FORMS_DEFAULTS, oneDriveRoot: rootOf(roots, workbook), ...site.forms };
      // OneDrive 폴더 안이면 상대 경로로 적어 site.json을 읽기 쉽게 둔다
      const base = homePath(forms.oneDriveRoot);
      const short = (p) => (p.startsWith(base + path.sep) ? path.relative(base, p) : p);
      Object.assign(forms, { formsWorkbook: short(workbook), attachmentsDir: short(attachments),  });
      await readResponses(formsConfig(forms)); // 고른 엑셀을 회사 Forms 열 구조로 읽을 수 있는지 확인한다
      writeSite({ ...site, forms });
      intake.seen.clear();
      await syncIntake();
      return json({ ok: true });
    }
    // MS Forms 응답을 지금 가져오고 평가표를 다시 읽는다.
    if (pathname === "/api/intake-sync") {
      await intake.running; // 1분마다 도는 읽기가 진행 중이면 끝난 뒤 처음부터 다시 읽는다
      intake.seen.clear();
      await syncIntake();
      return json(intake.view);
    }
    // 심사 배포: 심사자 폴더·평가표·공유 요청 (forms-intake.mjs distribute)
    if (pathname === "/api/distribute") {
      await syncIntake();
      if (!intake.config) err("연동 설정(deploy/site.json의 forms)이 없습니다.");
      const report = await distribute(intake.config, formWorks(), defaults.criteria, sheet);
      intake.seen.clear();
      await syncIntake();
      return json({ report, intake: intake.view });
    }
    const summaryRequest = pathname === "/api/summarize" || pathname === "/api/check-logic";
    if (summaryRequest && ![undefined, "local", "haiku"].includes(b.provider)) err("요약 모델을 확인하세요.");
    const cloud = summaryRequest && b.provider === "haiku";
    const key = cloud ? await savedKey() : "";
    if (cloud && !key) err("서버에 Claude API 키가 없습니다. 맥의 요약 설정에서 등록하세요.", 503);
    const w = load(b.id);
    if (pathname === "/api/intake") {
      const version = w.intakeVersion ?? 0;
      if (b.intakeVersion !== version)
        err("다른 화면에서 접수 정보를 수정했습니다. 창을 닫고 최신 값을 확인하세요.", 409);
      Object.assign(w, intakeFields(b, w), { intakeVersion: version + 1 });
      save(w);
      return json({ ok: true });
    }
    // 비슷한 제안 판정: 중복·관련·무관 (빈 값이면 지운다). 두 작품 중 지금 작품에 남긴다.
    if (pathname === "/api/similar-mark") {
      if (!["중복", "관련", "무관", ""].includes(b.mark)) err("판정을 확인하세요.");
      load(b.other);
      const marks = { ...w.similar, [b.other]: b.mark };
      if (!b.mark) delete marks[b.other];
      w.similar = marks;
      save(w);
      return json({ ok: true });
    }
    if (pathname === "/api/upload") {
      return json(
        {
          capture: await addImage(w.id, b, Buffer.from(b.data || "", "base64")),
        },
        201,
      );
    }
    if (b.rev !== w.rev)
      err("자료가 변경되었습니다. 화면을 갱신하고 다시 시도하세요.", 409);
    if (pathname === "/api/remove-work") {
      if ([...tasks.values()].some((t) => t.work === w.id))
        err("작업 완료 후 삭제하세요.", 409);
      atomic(() => {
        db.prepare("DELETE FROM images WHERE work=?").run(w.id);
        db.prepare("DELETE FROM works WHERE id=?").run(w.id);
      });
      summaries = null;
      return json({ ok: true });
    }
    if (pathname === "/api/clear-summary") {
      if (!["local", "haiku"].includes(b.provider)) err("요약 모델을 확인하세요.");
      if ([...tasks.values()].some((t) => t.work === w.id)) err("작업 완료 후 지우세요.", 409);
      const ai = b.provider === "haiku";
      w[ai ? "cloudReading" : "reading"] = null;
      w[ai ? "cloudLogic" : "logic"] = null;
      if (ai) db.prepare("DELETE FROM last_haiku_usage WHERE work=?").run(w.id);
      save(w);
      return json({ ok: true });
    }
    // 기준이나 빠짐없음 표시가 바뀌면 심사 결과만 지난 것으로 돌린다.
    // 캡처는 그대로이므로 rev를 올리지 않아 내용 요약(유료)은 남는다.
    if (pathname === "/api/settings") {
      if (tasks.has("review-" + w.id)) err("예비 심사가 끝난 뒤 바꾸세요.", 409);
      w.rubric = rubric(b.rubric);
      w.complete = b.complete === true;
      if (w.result) w.result.rev = null;
      w.final = null;
      w.error = "";
      save(w);
      return json({ ok: true });
    }
    if (pathname === "/api/sum") {
      const c = w.captures.find((x) => x.id === b.capture);
      if (c?.status !== "ready") err("문자 인식이 완료된 캡처를 선택하세요.");
      c.sumCheck = checkSum(c.lines, b.parts, b.reported, b.unit);
      changed(w);
      save(w);
      return json(c.sumCheck);
    }
    // 도식 검토로 지정(캡처 여러 장 한 번에). 다음 요약부터 그 쪽은 이미지도 함께 읽는다.
    if (pathname === "/api/visual") {
      const ids = new Set(Array.isArray(b.captures) ? b.captures : []);
      const targets = w.captures.filter((c) => ids.has(c.id) && !c.visual);
      if (!targets.length) err("지정할 캡처가 없습니다.");
      for (const c of targets) c.visual = true;
      changed(w);
      save(w);
      return json({ ok: true, count: targets.length });
    }
    if (pathname === "/api/capture") {
      const c = w.captures.find((x) => x.id === b.capture);
      if (!c) err("캡처가 없습니다.");
      if (b.action === "retry") {
        if (c.status === "queued") err("이미 인식 중입니다.");
        c.status = "queued";
        changed(w);
        save(w);
        enqueueOcr(w.id, c.id);
      } else if (b.action === "remove") {
        w.captures = w.captures.filter((x) => x.id !== c.id);
        changed(w, true);
        atomic(() => {
          save(w);
          db.prepare("DELETE FROM images WHERE id=?").run(c.id);
        });
      } else {
        c.issue = bounded(b.issue || "", 300);
        c.visual = !!b.visual;
        c.label = bounded(b.label || c.label, 180);
        c.document = bounded(b.document || c.document, 100);
        c.page = integer(b.page);
        c.total = integer(b.total);
        if (c.page && c.total && c.page > c.total) err("쪽수 범위 오류");
        changed(w, true);
        save(w);
      }
      return json({ ok: true });
    }
    if (summaryRequest) {
      const check = pathname === "/api/check-logic";
      const readingField = cloud ? "cloudReading" : "reading";
      const logicField = cloud ? "cloudLogic" : "logic";
      const reading = w[readingField];
      if (!w.captures.length || w.captures.some((c) => c.status === "queued"))
        err("캡처의 문자 인식이 완료되어야 합니다.");
      if (check && (!reading || reading.rev !== w.rev))
        err("현재 자료로 먼저 내용을 요약하세요.");
      if ([...tasks.values()].some((t) => t.work === w.id))
        err("현재 작품의 작업을 완료한 뒤 실행하세요.", 409);
      schedule(
        (check ? "logic-" : "summary-") + w.id,
        w.id,
        (cloud ? haikuLabel + " · " : "로컬 · ") + (check ? "사실·논리 점검 준비" : "요약 준비"),
        // 과정: (OCR →) AI 요약 → AI 사실·논리 점검. 요약을 만들면 점검까지 이어서 한다.
        async (progress) => {
          if (load(w.id).rev !== w.rev) throw Error("대기 중 자료가 변경되었습니다. 새 자료로 실행하세요.");
          // 한 단계를 실행한다. Haiku면 단계마다 사용량을 따로 기록한다.
          const step = async (kind, run, readingId) => {
            if (!cloud) return run();
            const usage = newHaikuUsage(randomUUID());
            if (readingId) usage.readingId = readingId;
            const startedAt = new Date().toISOString();
            const persist = () => {
              const snapshot = JSON.stringify(usageSnapshot(usage));
              saveUsage.run(w.id, kind, w.rev, snapshot);
              saveRun.run(usage.runId, w.id, kind, startedAt, snapshot);
            };
            persist();
            const output = await withHaiku(key, run, (responseUsage) => {
              recordHaikuUsage(usage, responseUsage);
              persist();
            });
            output.usage = usageSnapshot(usage, true);
            return output;
          };
          // 결과를 저장한다. 그 사이 자료가 바뀌었으면 버린다.
          const store = (apply) => {
            const latest = load(w.id);
            if (latest.rev !== w.rev) throw Error("작업 중 자료가 변경되었습니다. 새 자료로 실행하세요.");
            apply(latest);
            latest.error = "";
            save(latest);
          };
          const provider = cloud ? "haiku" : "local";
          let current = reading;
          if (!check) {
            const output = await step("summary", () => summarize({ ...w, reading }, image, progress));
            current = { ...output, rev: w.rev, provider, ...(cloud ? { effort: haikuEffortNote } : {}) };
            store((latest) => {
              latest[readingField] = current;
              latest[logicField] = null;
            });
          }
          // 점검 끝에 'AI가 본 이 아이디어'(idea-opinion.mjs)를 쓴다. Haiku로만 쓰고, 실패해도 점검 결과는 남긴다.
          const logic = await step("logic", async () => {
            const result = await checkLogic(current, w.captures, progress);
            if (!cloud) return result;
            progress("AI가 본 이 아이디어 쓰기");
            try {
              result.opinion = await ideaOpinion(current, result.issues.filter((x) => x.status !== "참고"));
            } catch (e) {
              result.opinion = { error: e.message };
            }
            return result;
          }, current.id);
          store((latest) => {
            if (latest[readingField]?.id !== current.id) throw Error("작업 중 자료가 변경되었습니다. 새 자료로 실행하세요.");
            latest[logicField] = { ...logic, provider };
          });
        },
        cloud ? "cloud" : "local",
      );
      w.error = "";
      save(w);
      return json({ ok: true }, 202);
    }
    if (pathname === "/api/evaluate") {
      if (!w.captures.length || w.captures.some((c) => c.status === "queued"))
        err("캡처를 접수하고 OCR 완료 후 심사하세요.");
      if (!w.captures.some((c) => c.lines.length || c.visual))
        err("심사할 수 있는 근거가 없습니다.");
      schedule("review-" + w.id, w.id, "심사 준비 중", async (progress) => {
        const result = await evaluate(w, w.captures, image, progress);
        const latest = load(w.id);
        if (latest.rev !== w.rev)
          throw new Error(
            "심사 중 자료가 변경되었습니다. 새 자료로 다시 심사하세요.",
          );
        result.rev = w.rev;
        latest.result = result;
        latest.final = null;
        latest.error = "";
        save(latest);
      });
      w.error = "";
      save(w);
      return json({ ok: true }, 202);
    }
    // 채점표 확정. AI 예비 심사는 참고용이라 없어도 확정할 수 있다.
    if (pathname === "/api/final") {
      if (!w.captures.length) err("캡처 자료를 올린 뒤 채점하세요.");
      if (tasks.has("review-" + w.id)) err("예비 심사가 끝난 뒤 확정하세요.");
      // 채점표를 연 뒤에 다른 평가자가 확정·수정했으면 덮어쓰지 않는다(base: 화면이 연 채점표의 확정 시각).
      if ((b.base || null) !== (w.final?.when || null))
        err("그사이 다른 평가자가 이 채점표를 확정했습니다. 새로고침해 확인한 뒤 다시 저장하세요.", 409);
      w.final = { ...finalSheet(b, w.rubric), when: new Date().toISOString() };
      save(w);
      return json({ ok: true });
    }
    // 채택 뒤 실행 추적 (review.mjs followupSheet)
    if (pathname === "/api/followup") {
      if (w.final?.decision !== "채택 검토") err("1차 결정이 '채택 검토'인 작품만 실행을 추적합니다.");
      w.followup = followupSheet(b, w.followup);
      save(w);
      return json({ ok: true });
    }
    if (pathname === "/api/compare") {
      const other = load(b.other);
      if (
        other.id === w.id ||
        other.result?.rev !== other.rev ||
        w.result?.rev !== w.rev ||
        other.result?.total == null ||
        w.result?.total == null ||
        !w.result.report?.category ||
        other.result.report?.category !== w.result.report.category
      )
        err("같은 분야에서 예비점수가 나온 서로 다른 두 작품을 선택하세요.");
      const criterion = bounded(b.criterion, 50),
        key = "compare-" + w.id;
      schedule(key, w.id, "두 작품 순서를 바꿔 비교 중", async () => {
        const comparison = await compareResults(w, other, criterion);
        const fresh = load(w.id);
        if (fresh.rev !== w.rev || load(other.id).rev !== other.rev)
          throw new Error("비교 중 자료가 변경되었습니다.");
        fresh.comparison = {
          ...comparison,
          criterion,
          other: other.name,
          when: new Date().toISOString(),
          rev: w.rev,
          otherId: other.id,
          otherRev: other.rev,
        };
        save(fresh);
      });
      return json({ ok: true }, 202);
    }
    err("지원하지 않는 작업입니다.", 404);
  } catch (e) {
    if (e.code === "ENOENT") return json({ error: "파일을 찾을 수 없습니다." }, 404);
    json({ error: e.message || "처리 오류" }, e.status || 400);
  }
}

// 서비스 재시작(launchctl kickstart) 때 진행 중이던 요약·심사가 말없이 사라지지 않도록 기록한다.
// 대기 중인 OCR은 다음 시작 때 다시 줄을 선다.
function stopServer() {
  for (const [key, job] of tasks) {
    if (key.startsWith("ocr-")) continue;
    try {
      const w = load(job.work);
      w.error = "서버가 다시 시작되어 작업이 중단되었습니다. 다시 실행하세요.";
      save(w);
    } catch {}
  }
  db.close();
  process.exit(0);
}
process.once("SIGTERM", stopServer);
process.once("SIGINT", stopServer);
const server = nasMode ? await nasServer(directory, handleRequest) : http.createServer(handleRequest);
const listenAddress = nasMode ? macAddress : "127.0.0.1";
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`${listenAddress}:${port}를 이미 다른 프로그램이 쓰고 있습니다. 먼저 띄운 서버를 끈 뒤 다시 실행하세요.`);
  process.exit(1);
});
server.listen(port, listenAddress, () =>
  console.log("아이디어정리 %s://%s:%d", nasMode ? "https" : "http", listenAddress, port),
);
