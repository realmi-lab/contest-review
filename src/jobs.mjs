// 작업 대기열. 이 컴퓨터의 자원을 쓰는 작업(글자 인식·문서 캡처)은 한 줄로 차례로 처리하고,
// AI 요청은 이 컴퓨터 자원을 거의 쓰지 않으므로 별도 줄에서 처리해 글자 인식을 막지 않는다.
import { load, save } from "./store.mjs";
import { err } from "./validate.mjs";

export const tasks = new Map(); // 작업 키 → { work: 작품 id, label: 화면에 보여 줄 진행 상황, percent: 진행률(알 때만), ai: AI 줄 작업인가 }
const queues = { machine: Promise.resolve(), ai: Promise.resolve() };
const endHooks = [];

// 작업이 하나 끝날 때마다 그 작품 id로 부를 함수를 등록한다(요약 자동 진행 등).
export const onJobEnd = (fn) => endHooks.push(fn);
// 이 작품에 진행·대기 중인 작업이 있는가
export const busy = (wid) => [...tasks.values()].some((t) => t.work === wid);

// fn(progress)를 lane 줄 끝에 넣는다. progress(글, 진행률%)로 화면의 진행 상황을 바꾼다. 실패하면 오류를 작품에 적는다.
export function schedule(key, work, label, fn, lane = "machine") {
  if (tasks.has(key)) err("이미 대기 중인 작업입니다.", 409);
  const job = { work, label: "대기 · " + label, ai: lane === "ai" }; // ai: 화면이 '생각하는 중…' 문구를 돌린다
  tasks.set(key, job);
  queues[lane] = queues[lane]
    .then(async () => {
      job.label = label;
      try {
        await fn((text, percent) => {
          job.label = text;
          if (percent != null) job.percent = percent;
        });
      } catch (e) {
        const w = load(work);
        w.error = String(e.message).slice(0, 1200);
        save(w);
      } finally {
        tasks.delete(key);
        for (const hook of endHooks) hook(work);
      }
    })
    .catch((e) => console.error("작업 처리 오류", e.name));
}
