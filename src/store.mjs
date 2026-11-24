// 저장소: 데이터 폴더의 desk.sqlite3 하나에 작품(JSON)·캡처 그림·AI 사용량 기록을 둔다.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { directory } from "./config.mjs";
import { defaults, rubric, stalled } from "./review/review.mjs";
import { bounded, day, err } from "./validate.mjs";

await mkdir(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(directory, "desk.sqlite3"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, work TEXT NOT NULL REFERENCES works(id), image BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS images_work ON images(work);
-- 작품마다 지금 자료(rev)로 실행한 요약·점검의 마지막 사용량
CREATE TABLE IF NOT EXISTS last_haiku_usage (
  work TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, rev INTEGER NOT NULL, usage TEXT NOT NULL,
  PRIMARY KEY(work,kind)
);
-- AI 실행 기록(실행마다 한 줄). 작품을 지워도 남겨 날짜별 합계를 실제 청구와 대조한다.
CREATE TABLE IF NOT EXISTS haiku_runs (
  run TEXT PRIMARY KEY, work TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, usage TEXT NOT NULL
);`);

const sql = {
  putWork: db.prepare("INSERT INTO works(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data"),
  work: db.prepare("SELECT data FROM works WHERE id=?"),
  works: db.prepare("SELECT data FROM works ORDER BY rowid DESC"),
  deleteWork: db.prepare("DELETE FROM works WHERE id=?"),
  image: db.prepare("SELECT image FROM images WHERE id=?"),
  insertImage: db.prepare("INSERT INTO images(id,work,image) VALUES(?,?,?)"),
  deleteImage: db.prepare("DELETE FROM images WHERE id=?"),
  deleteImages: db.prepare("DELETE FROM images WHERE work=?"),
  saveUsage: db.prepare(`INSERT INTO last_haiku_usage(work,kind,rev,usage) VALUES(?,?,?,?)
    ON CONFLICT(work,kind) DO UPDATE SET rev=excluded.rev, usage=excluded.usage`),
  lastUsage: db.prepare("SELECT kind,usage FROM last_haiku_usage WHERE work=? AND rev=?"),
  saveRun: db.prepare(`INSERT INTO haiku_runs(run,work,kind,at,usage) VALUES(?,?,?,?,?)
    ON CONFLICT(run) DO UPDATE SET usage=excluded.usage`),
  runsSince: db.prepare("SELECT at,usage FROM haiku_runs WHERE at>=? ORDER BY at"),
  firstRun: db.prepare("SELECT min(at) at FROM haiku_runs"),
  // 목록 화면용 요약 열
  summaries: db.prepare(
    `SELECT id, json_extract(data,'$.name') name, json_extract(data,'$.rev') rev, json_extract(data,'$.updated') updated,
    json_extract(data,'$.receivedOn') receivedOn, json_extract(data,'$.intakeTeam') intakeTeam, json_extract(data,'$.submitterName') submitterName,
    CASE WHEN json_extract(data,'$.cloudReading.rev')=json_extract(data,'$.rev') THEN 1 ELSE 0 END hasReading, -- 지금 자료의 AI 요약이 있는가
    CASE WHEN json_extract(data,'$.cloudReading.rev')=json_extract(data,'$.rev') THEN (SELECT json_extract(line.value,'$.text')
      FROM json_each(data,'$.cloudReading.edition.brief') line WHERE json_extract(line.value,'$.topic') IN ('내용','한 줄 요약') LIMIT 1)
      END gist, -- 목록에서 제목 아래에 보여 준다(메인 요약의 '내용', 예전 요약은 '한 줄 요약')
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
  ),
};

// 서울 날짜(YYYY-MM-DD)
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

// 목록 화면 열은 폴링마다 모든 작품 JSON을 다시 읽지 않도록 캐시한다. 작품이 바뀌면 비운다.
let summaries = null;
export const summaryList = () =>
  (summaries ??= sql.summaries.all().map((x) =>
    ({ ...x, stalled: stalled(x.followStage && { stage: x.followStage, due: x.followDue, updated: x.followUpdated }, today()) })));

export function save(w) {
  w.updated = new Date().toISOString();
  sql.putWork.run(w.id, JSON.stringify(w));
  summaries = null;
  return w;
}
export const list = () => sql.works.all().map((x) => JSON.parse(x.data));
export function load(id) {
  const row = sql.work.get(id);
  if (!row) err("작품을 찾을 수 없습니다.", 404);
  return JSON.parse(row.data);
}
export function image(id) {
  const row = sql.image.get(id);
  if (!row) err("이미지를 찾을 수 없습니다.", 404);
  return Buffer.from(row.image);
}
// 캡처 목록용 작은 미리보기. 원본은 확대 보기에서만 내려받는다.
export const thumbnail = (id) =>
  sharp(image(id)).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

// 여러 변경을 한 번에 저장한다(중간에 실패하면 모두 되돌린다).
export function atomic(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export const insertImage = (id, wid, data) => sql.insertImage.run(id, wid, data);
export const deleteImage = (id) => sql.deleteImage.run(id);
export const deleteImagesOf = (wid) => sql.deleteImages.run(wid); // 그 작품의 그림 모두
export function removeWork(wid) {
  atomic(() => {
    sql.deleteImages.run(wid);
    sql.deleteWork.run(wid);
  });
  summaries = null;
}

// 캡처가 바뀌면 자료 번호(rev)를 올린다. 지난 요약·확정 점수는 이 번호로 '지난 것'이 된다.
export function changed(w, reset = false) {
  w.rev++;
  if (reset) w.complete = false;
  w.final = null;
  w.error = "";
}

// 접수 정보: 인입 날짜·팀·접수자. 값이 없으면 이전 값을 쓴다.
export function intakeFields(values, previous) {
  return {
    receivedOn: day(values.receivedOn ?? previous.receivedOn ?? ""),
    intakeTeam: bounded(values.intakeTeam ?? previous.intakeTeam ?? "", 80),
    submitterName: bounded(values.submitterName ?? previous.submitterName ?? "", 80),
  };
}
export function newWork(name, spec = defaults, values = {}) {
  return save({
    id: randomUUID(),
    name,
    ...intakeFields(values, { receivedOn: today() }),
    intakeVersion: 0,
    rev: 0,
    rubric: rubric(spec),
    complete: false,
    captures: [],
    final: null,
    error: "",
  });
}

// AI 사용량: 작품의 마지막 실행(kind: summary·logic)과 실행 기록을 함께 남긴다.
export function recordUsage(wid, kind, rev, runId, startedAt, snapshot) {
  sql.saveUsage.run(wid, kind, rev, snapshot);
  sql.saveRun.run(runId, wid, kind, startedAt, snapshot);
}
export const lastUsage = (wid, rev) =>
  Object.fromEntries(sql.lastUsage.all(wid, rev).map((row) => [row.kind, JSON.parse(row.usage)]));
export const runsSince = (at) => sql.runsSince.all(at).map((r) => ({ at: r.at, usage: JSON.parse(r.usage) }));
export const firstRunAt = () => sql.firstRun.get().at;

export const close = () => db.close();
