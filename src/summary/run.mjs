// AI 요약 실행: 요약 → 사실·논리 점검 → 'AI가 본 이 아이디어'를 대기열에 넣고, 단계마다 사용량을 기록한다.
import { randomUUID } from "node:crypto";
import { haikuEffortNote, haikuLabel, savedKey, withHaiku } from "../ai/claude-summary.mjs";
import { dailyUsage, newHaikuUsage, recordHaikuUsage, usageSnapshot } from "../ai/haiku-usage.mjs";
import { ideaOpinion } from "../check/idea-opinion.mjs";
import { busy, schedule } from "../jobs.mjs";
import { image, load, recordUsage, runsSince, save } from "../store.mjs";
import { err } from "../validate.mjs";
import { checkLogic } from "../check/logic.mjs";
import { summarize } from "./reading.mjs";

// 요약(이어서 사실·논리 점검) 또는 점검만(check) 대기열에 넣는다. 요청 처리와 자동 진행이 함께 쓴다.
// 결과는 작품의 cloudReading(요약)·cloudLogic(점검)에 둔다. (예전 로컬 모델 결과와 구분하던 이름을 그대로 쓴다.)
export function startSummary(w, check, key) {
  const reading = w.cloudReading;
  if (!w.captures.length || w.captures.some((c) => c.status === "queued")) err("캡처의 문자 인식이 완료되어야 합니다.");
  if (check && (!reading || reading.rev !== w.rev)) err("현재 자료로 먼저 내용을 요약하세요.");
  if (busy(w.id)) err("현재 작품의 작업을 완료한 뒤 실행하세요.", 409);
  schedule(
    (check ? "logic-" : "summary-") + w.id,
    w.id,
    haikuLabel + " · " + (check ? "사실·논리 점검 준비" : "요약 준비"),
    async (progress) => {
      if (load(w.id).rev !== w.rev) throw Error("대기 중 자료가 변경되었습니다. 새 자료로 실행하세요.");
      // 한 단계를 실행하고 사용량을 응답마다 기록한다(중간에 실패해도 쓴 만큼 남는다).
      const step = async (kind, run, readingId) => {
        const usage = newHaikuUsage(randomUUID());
        if (readingId) usage.readingId = readingId;
        const startedAt = new Date().toISOString();
        const persist = () => recordUsage(w.id, kind, w.rev, usage.runId, startedAt, JSON.stringify(usageSnapshot(usage)));
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
      let current = reading;
      if (!check) {
        const output = await step("summary", () => summarize({ ...w, reading }, image, progress));
        current = { ...output, rev: w.rev, effort: haikuEffortNote };
        store((latest) => {
          latest.cloudReading = current;
          latest.cloudLogic = null;
        });
      }
      // 점검 끝에 'AI가 본 이 아이디어'(idea-opinion.mjs)를 쓴다. 실패해도 점검 결과는 남긴다.
      const logic = await step("logic", async () => {
        const result = await checkLogic(current, progress);
        progress("AI가 본 이 아이디어 쓰기");
        try {
          result.opinion = await ideaOpinion(current, result.issues.filter((x) => x.status !== "참고"));
        } catch (e) {
          result.opinion = { error: e.message };
        }
        return result;
      }, current.id);
      store((latest) => {
        if (latest.cloudReading?.id !== current.id) throw Error("작업 중 자료가 변경되었습니다. 새 자료로 실행하세요.");
        latest.cloudLogic = logic;
      });
    },
    "ai",
  );
  w.error = "";
  save(w);
}

// MS Forms로 들어온 아이디어는 첨부 캡처와 글자 인식이 끝나면 요약 → 사실·논리 점검까지 알아서 이어 간다.
// 같은 자료(rev)로는 한 번만 시도한다(실패해도 되풀이해 비용을 쓰지 않게). 못 읽은 첨부가 있으면 사람이 올린 뒤 직접 실행한다.
export async function autoSummarize(wid) {
  const key = await savedKey(); // 작품을 읽기 전에(읽은 뒤 기다리면 그사이 저장된 캡처를 옛 값으로 덮는다)
  if (!key) return;
  const w = load(wid),
    s = w.source;
  if (!s?.formId || s.autoRev === w.rev || !w.captures.length || w.cloudReading?.rev === w.rev) return;
  if (s.missing.length || !s.files.every((n) => s.read?.[n]?.pages)) return;
  if (w.captures.some((c) => c.status === "queued") || busy(wid)) return;
  s.autoRev = w.rev;
  save(w);
  startSummary(w, false, key);
}

// 최근 7일(UTC) AI 사용량: 응답마다 받은 토큰 수에 공식 단가를 곱해 이 서버에서 계산한 날짜별 기록
export const utcDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export const recentUsage = () => dailyUsage(runsSince(utcDay(-6) + "T00:00:00Z"));
// 목록 화면에 늘 보여 주는 비용 요약(달러): 오늘(UTC)과 최근 7일
export function costSummary() {
  const days = recentUsage();
  const usd = (list) => list.reduce((sum, d) => sum + (d.estimatedUsd ?? 0), 0);
  return { today: usd(days.filter((d) => d.day === utcDay(0))), week: usd(days) };
}
