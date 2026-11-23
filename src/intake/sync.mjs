// MS Forms 공모 연동 동기화 (읽기·복사: forms-intake.mjs, 설정: deploy/site.json의 forms)
// 1분마다 응답 엑셀이 바뀌었으면 새 응답을 작품으로 만들고 첨부를 '작품/<번호 작품명>' 폴더로 복사한 뒤 캡처로 접수한다.
// 심사자 평가표가 바뀌었으면 다시 읽어 작품의 evaluations[심사자 이메일]에 둔다. 평가표는 공통 기준(defaults.criteria)을 쓴다.
import { stat } from "node:fs/promises";
import path from "node:path";
import { readSite } from "../../deploy/site.mjs";
import { addPages, uploadDir } from "../captures.mjs";
import { schedule, tasks } from "../jobs.mjs";
import { defaults, sheet } from "../review/review.mjs";
import { list, load, newWork, save } from "../store.mjs";
import { autoSummarize } from "../summary/run.mjs";
import {
  copyAttachments, EVALUATION_SHEET, evaluationFile, fileIndex, formsConfig, readEvaluations, readResponses, shareState, workbookRows, workFolder,
  writeResponse,
} from "./forms-intake.mjs";

// config: 읽은 설정, responses: 응답 엑셀 캐시(수정 시각으로 확인), seen: 심사자별 평가표 수정 시각, view: 목록 화면용 현황
export const intake = { config: null, error: "", checkedAt: "", seen: new Map(), responses: null, running: null, view: { configured: false } };
export const formWorks = () => list().filter((w) => w.source?.formId);
const withoutTime = (x) => JSON.stringify(x && { ...x, at: 0 });
const attachmentFolder = (config, w) => path.join(config.reviewDir, "작품", w.source.folder);

async function importResponses(config) {
  const book = await stat(config.formsWorkbook).catch(() => null);
  if (!book) throw new Error("응답 엑셀이 아직 없습니다: " + config.formsWorkbook);
  // 응답 엑셀은 바뀌었을 때만 다시 읽는다. 보호(MIP) 엑셀은 Excel 앱이 열어야 해서, 매번 읽으면 1분마다 Excel이 켜진다.
  if (intake.responses?.mtime !== book.mtimeMs) intake.responses = { mtime: book.mtimeMs, list: await readResponses(config) };
  const sameFiles = (w, entry) => JSON.stringify(w.source.files) === JSON.stringify(entry.files);
  const known = new Map(formWorks().map((w) => [w.source.formId, w]));
  const todo = intake.responses.list.filter((entry) => {
    const w = known.get(entry.id);
    return !w || w.source.missing.length || !sameFiles(w, entry);
  });
  if (!todo.length) return;
  const index = await fileIndex(config.attachmentsDir);
  const problems = [];
  for (const entry of todo) {
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
      } else if (!sameFiles(w, entry)) { // 첨부 이름 읽는 방식이 바뀐 예전 응답(첨부 목록을 읽는 동안 저장된 내용을 덮지 않게 새로 읽는다)
        w = load(w.id);
        Object.assign(w.source, { files: entry.files, missing: entry.files, read: {} });
        save(w);
      }
      if (!w.source.missing.length) continue;
      const missing = await copyAttachments(w.source.files, index, attachmentFolder(config, w));
      const latest = load(w.id); // 복사하는 동안 캡처·요약이 저장됐을 수 있어 최신 것을 고친다
      latest.source.missing = missing;
      save(latest);
    } catch (e) {
      problems.push(`응답 ${entry.id}: ${e.message}`);
    }
  }
  if (problems.length) throw new Error(problems.join(" · "));
}

async function collectEvaluations(config) {
  const errors = {};
  for (const evaluator of config.evaluators) {
    const file = evaluationFile(config, evaluator);
    const info = await stat(file).catch(() => null);
    if (!info || intake.seen.get(evaluator.email) === info.mtimeMs) continue;
    try {
      const results = readEvaluations(await workbookRows(file, EVALUATION_SHEET), defaults.criteria, sheet);
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

// MS Forms 첨부를 캡처로 자동 접수한다. 파일마다 결과를 source.read에 남긴다: { pages } 또는 { error }.
// 못 읽은 파일은 심사자가 직접 캡처한다.
function ingestAttachments(config, w) {
  const key = "ingest-" + w.id;
  // 자동 접수가 생기기 전에 사람이 캡처를 올려 둔 작품은 다시 열지 않는다.
  if (!w.source.read && w.captures.length) {
    w.source.read = Object.fromEntries(w.source.files.map((n) => [n, { manual: true }]));
    save(w);
    return;
  }
  const todo = w.source.files.filter((n) => !w.source.missing.includes(n) && !w.source.read?.[n]);
  if (!todo.length || tasks.has(key)) return;
  schedule(key, w.id, "첨부 읽는 중", async (progress) => {
    for (const name of todo) {
      progress(name + " · 열어서 캡처하는 중");
      let result;
      try {
        result = { pages: await addPages(w.id, name, path.join(attachmentFolder(config, w), name), { secured: true }) }; // Forms 첨부는 모두 보호 문서
      } catch (e) {
        result = { error: String(e.message).slice(0, 300) };
      }
      const fresh = load(w.id);
      fresh.source.read = { ...fresh.source.read, [name]: result };
      save(fresh);
    }
  });
}

// 한 번 동기화한다. 이미 도는 중이면 그 동기화를 기다린다.
export function syncIntake() {
  intake.running ??= (async () => {
    let errors = {};
    try {
      intake.config = formsConfig(readSite().forms);
      intake.error = "";
      if (intake.config) {
        await importResponses(intake.config).catch((e) => (intake.error = e.message)); // 응답에 문제가 있어도 평가표는 읽는다
        // 작품마다 새로 읽는다(앞 작품을 기다리는 동안 글자 인식 등이 저장한 내용을 옛 값으로 덮지 않게)
        for (const { id } of formWorks()) {
          try {
            ingestAttachments(intake.config, load(id));
          } catch {
            continue; // 그사이 지워진 작품
          }
          await autoSummarize(id).catch(() => {}); // 서버가 꺼졌다 켜져 이어지지 못한 작품
        }
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
// 못 읽은 첨부 기록을 지워 다음 읽기에서 다시 열어 보게 한다(직접 올린 것·읽은 것은 그대로).
function retryFailedReads() {
  for (const w of formWorks()) {
    const read = Object.fromEntries(Object.entries(w.source.read ?? {}).filter(([, r]) => !r.error));
    if (Object.keys(read).length !== Object.keys(w.source.read ?? {}).length) {
      w.source.read = read;
      save(w);
    }
  }
}
// 서버를 켤 때 한 번: 새 버전이 못 읽던 첨부를 읽을 수 있을지 모르니 다시 열어 본다. 그 뒤로는 1분마다 동기화
export function startIntake() {
  retryFailedReads();
  syncIntake();
  setInterval(syncIntake, 60_000).unref();
}

// 평가표를 처음부터 다시 읽는다. responsesToo면 응답 엑셀도 다시 읽는다.
// 도는 중인 읽기가 있으면 끝난 뒤 다시 읽는다(그 읽기는 바뀌기 전 설정·캐시로 시작했다).
export async function rereadIntake(responsesToo = true) {
  await intake.running;
  intake.seen.clear();
  if (responsesToo) intake.responses = null;
  await syncIntake();
}

// 접수 정보에서 고친 값(제목·설명)을 응답 엑셀에도 적는다. 도는 중인 읽기가 끝난 뒤, 쓰는 동안은 읽기가 시작되지 않게
// intake.running을 잡고 쓴다. 다음 확인 때 엑셀을 다시 읽게 한다.
export async function updateResponse(w, values) {
  while (intake.running) await intake.running;
  intake.running = writeResponse(intake.config, w.source.formId, values).finally(() => (intake.running = null));
  await intake.running;
  intake.responses = null;
}

// '지금 가져오기': 도는 중인 읽기가 끝나면 못 읽었던 첨부까지 처음부터 다시 읽는다.
export async function syncNow() {
  await intake.running;
  retryFailedReads();
  await rereadIntake();
  return intake.view;
}

// 캡처의 원본 문서 경로(다시 캡처용). 올린 문서 폴더, MS Forms 첨부면 OneDrive의 작품 폴더에서 찾는다. 없으면 "".
export async function originalFile(w, c) {
  if (path.basename(c.document) !== c.document) return "";
  const places = [uploadDir(w.id)];
  if (intake.config && w.source?.files.includes(c.document)) places.push(attachmentFolder(intake.config, w));
  for (const dir of places) if (await stat(path.join(dir, c.document)).catch(() => null)) return path.join(dir, c.document);
  return "";
}
