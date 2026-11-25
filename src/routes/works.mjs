// 작품·캡처·채점 API
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ai, haikuLabel, savedKey } from "../ai/claude-summary.mjs";
import { addImage, addPages, enqueueOcr, ocrReady, replaceImage, uploadDir } from "../captures.mjs";
import { build } from "../config.mjs";
import { attachmentPages, pageKind } from "../intake/attachment-pages.mjs";
import { intake, originalFile, updateResponse } from "../intake/sync.mjs";
import { busy, schedule, tasks } from "../jobs.mjs";
import { defaults, finalSheet, rubric, scoreRows, sheet, toCsv } from "../review/review.mjs";
import { shareCsp, shareHtml } from "../review/share-html.mjs";
import { htmlReply, newTicket, sendHtml, slackPeople, slackReady } from "../slack.mjs";
import { similarWorks } from "../review/similar.mjs";
import { sampleImage } from "../sample.mjs";
import {
  atomic, changed, deleteImage, deleteImagesOf, image, intakeFields, lastUsage, list, load, newWork, removeWork, save, summaryList, thumbnail, today,
} from "../store.mjs";
import { shownRefs } from "../summary/reading-edition.mjs";
import { startSummary } from "../summary/run.mjs";
import { bounded, err } from "../validate.mjs";
import { features } from "../../deploy/site.mjs";

// 본문의 id로 작품을 읽고, 화면이 본 자료 번호(rev)가 지금과 같은지 확인한다(그사이 바뀌었으면 거절).
function current(b) {
  const w = load(b.id);
  if (b.rev !== w.rev) err("자료가 변경되었습니다. 화면을 갱신하고 다시 시도하세요.", 409);
  return w;
}

// 캡처 한 장의 글자를 다시 읽는다(인식 대기열에 다시 넣는다).
function rereadText(w, c) {
  c.status = "queued";
  changed(w);
  save(w);
  enqueueOcr(w.id, c.id);
}

export default {
  // 목록 화면: 작품 목록·작업 대기열·빌드 번호·AI 비용·공모 연동 현황
  "GET /api/state": async ({ json }) =>
    json({
      app: "contest-review-desk",
      build,
      works: summaryList(),
      tasks: [...tasks.values()],
      health: { ocrReady: await ocrReady() },
      defaults,
      sheet,
      intake: intake.view,
      ai: { provider: ai.provider, label: haikuLabel },
      slack: slackReady(), // Slack 보내기를 쓸 수 있는가(평가 단추 앱 설정이 있는가)
      features: features(), // 켜고 끄는 기능(AI 논리점검)
    }),

  // 전체 채점 결과 (엑셀에서 여는 CSV)
  "GET /api/export": ({ res }) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`채점 결과 ${today()}.csv`)}`);
    res.end(toCsv(scoreRows(list(), defaults.criteria)));
  },

  "GET /api/work/:id": ({ id, json }) => {
    const work = load(id);
    // 예전에 만든 요약도 근거 칩이 수치가 적힌 쪽을 가리키게 보낸다(저장된 요약은 그대로 둔다).
    const reading = work.cloudReading;
    if (reading?.edition && reading.evidence)
      for (const view of ["brief", "detail"])
        reading.edition[view] = (reading.edition[view] || []).map((p) => ({ ...p, refs: shownRefs(p, reading.evidence) }));
    work.lastHaikuUsage = lastUsage(work.id, work.rev);
    json(work);
  },

  // 캡처 그림(size=thumb이면 작은 미리보기). id마다 내용이 바뀌지 않으므로 브라우저에만(private) 오래 보관한다.
  "GET /api/image/:id": async ({ id, query, res }) => {
    const thumb = query.get("size") === "thumb";
    const bytes = thumb ? await thumbnail(id) : image(id); // 없으면 404(이때는 오래 보관하지 않는다)
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Type", thumb ? "image/webp" : "image/png");
    res.end(bytes);
  },

  // 내보내기: 핵심·세부 요약·AI 논리점검·원본 캡처를 HTML 한 파일로(share-html.mjs). 새 탭에서 열고, 저장하면 이름이 붙는다.
  "GET /api/share/:id": async ({ id, res }) => {
    const w = load(id);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", shareCsp); // 파일 안의 글꼴·그림과 쪽 칩 스크립트만
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(`${w.name.slice(0, 60)}_AI요약_${today()}.html`)}`);
    res.end(await shareHtml(w));
  },

  // 채점표 탭의 메모(심사자가 자유롭게 적어 두는 한 칸, 의견 수에는 세지 않는다). 자료 판(rev)과 상관없이 저장한다.
  "POST /api/review-note": ({ b, json }) => {
    const w = load(b.id);
    w.reviewNote = bounded(b.note, 4000).trim();
    save(w);
    json({ ok: true });
  },

  // Slack 담당자 검색(이름·표시 이름·직함)
  "GET /api/slack-people": async ({ query, json }) => json(await slackPeople(query.get("q"))),

  // Slack 보내기: 내보내기 HTML과 [평가 답장하기] 링크를 고른 담당자에게 보내고(그룹 DM), 누구에게 언제 보냈는지 작품에 남긴다.
  "POST /api/slack-send": async ({ b, json }) => {
    const w = current(b);
    const user = /^[UW][A-Z0-9]+$/.test(b.user) ? b.user : err("담당자를 고르세요.");
    const brief = w.cloudReading?.rev === w.rev ? w.cloudReading.edition?.brief || [] : [];
    const gist = (brief.find((p) => p.topic === "한 줄 요약") || brief.find((p) => p.topic === "제목"))?.text || "";
    const ticket = newTicket(); // HTML의 [의견 보내기]용 일회용 표(앱이 받는 사람·작품과 함께 남긴다)
    const sent = await sendHtml(user, {
      workId: w.id,
      title: w.name,
      filename: `${w.name.slice(0, 60)}_AI요약_${today()}.html`,
      html: await shareHtml(w, { reply: htmlReply(ticket) }), // 받는 사람이 HTML 안에서 의견을 써 보낼 수 있게
      ticket,
      comment: `--------\n*[${w.name}]*${gist ? "\n" + gist : ""}\n아이디어 리뷰에서 보낸 AI 요약${features().logic ? "·논리점검" : ""}입니다. 첨부한 HTML 파일을 내려받아 브라우저로 여세요.${htmlReply("") ? " 파일 맨 아래에서 바로 의견을 보낼 수도 있습니다(Slack 미리보기에서는 보내지지 않습니다)." : ""}`,
    });
    const latest = load(w.id);
    latest.slackSent = [...(latest.slackSent || []), { user, name: bounded(b.name, 80), at: new Date().toISOString(), ...sent }];
    save(latest);
    json({ ok: true });
  },

  // 비슷한 제안 (similar.mjs). 판정(중복·관련·무관)은 어느 쪽 작품에 남겼든 함께 보여 준다.
  "GET /api/similar/:id": ({ id, json }) => {
    const works = list();
    const self = works.find((w) => w.id === id) ?? err("작품을 찾을 수 없습니다.", 404);
    const byId = new Map(works.map((w) => [w.id, w]));
    json(similarWorks(works, self.id).map((x) => ({ ...x, mark: self.similar?.[x.id] ?? byId.get(x.id).similar?.[self.id] ?? "" })));
  },

  // 직접 접수
  "POST /api/create": ({ b, json }) => {
    const name = bounded(b.name, 140);
    if (!name) err("작품명을 입력하세요.");
    json({ id: newWork(name, b.rubric, b).id }, 201);
  },

  // 합성 예제 작품(그림 한 장)
  "POST /api/sample": async ({ b, json }) => {
    const umbrella = b.kind === "umbrella";
    const w = newWork((umbrella ? "비 오는 날 공유 우산" : "입금 지연 상담 개선") + " · 합성 예제");
    await addImage(w.id, { document: "합성 제안서", page: 1, total: 1, label: "합성 제안서 1쪽" }, await sampleImage(b.kind));
    json({ id: w.id }, 201);
  },

  // 접수 정보 수정. 다른 화면이 먼저 고쳤으면 덮어쓰지 않는다.
  // 접수 정보 수정. MS Forms로 들어온 작품은 제목·설명을 고치면 응답 엑셀의 그 칸도 고친다(엑셀을 못 고치면 저장하지 않는다).
  "POST /api/intake": async ({ b, json }) => {
    const current = () => {
      const w = load(b.id);
      if (b.intakeVersion !== (w.intakeVersion ?? 0)) err("다른 화면에서 접수 정보를 수정했습니다. 창을 닫고 최신 값을 확인하세요.", 409);
      return w;
    };
    let w = current();
    const name = bounded(b.name ?? w.name, 140);
    if (!name) err("작품명을 입력하세요.");
    const description = bounded(b.description ?? w.source?.description ?? "", 4000).replace(/\r\n?/g, "\n");
    const inExcel = !!w.source?.formId && !!intake.config && (name !== w.name || description !== (w.source.description ?? ""));
    if (inExcel) {
      await updateResponse(w, { title: name, description }).catch((e) => err("응답 엑셀을 고치지 못해 저장하지 않았습니다 · " + e.message, 502));
      w = current(); // 엑셀을 고치는 동안 캡처·요약이 저장됐을 수 있어 최신 것을 고친다
    }
    Object.assign(w, intakeFields(b, w), { name, intakeVersion: (w.intakeVersion ?? 0) + 1 });
    if (w.source?.formId) w.source.description = description;
    save(w);
    json({ ok: true, inExcel });
  },

  // 비슷한 제안 판정: 중복·관련·무관 (빈 값이면 지운다). 두 작품 중 지금 작품에 남긴다.
  "POST /api/similar-mark": ({ b, json }) => {
    const w = load(b.id);
    if (!["중복", "관련", "무관", ""].includes(b.mark)) err("판정을 확인하세요.");
    load(b.other);
    const marks = { ...w.similar, [b.other]: b.mark };
    if (!b.mark) delete marks[b.other];
    w.similar = marks;
    save(w);
    json({ ok: true });
  },

  // 문서 올리기: 받은 파일을 데이터 폴더에 두고 쪽마다 캡처로 접수한다(Office 앱·PDFKit을 쓰므로 차례로 처리).
  "POST /api/upload-document": async ({ b, json }) => {
    const w = load(b.id);
    const name = path.basename(bounded(b.name ?? "", 200));
    if (!pageKind(name) || pageKind(name) === "image") err("PDF·Word·PowerPoint·Excel 문서를 올리세요.");
    const bytes = Buffer.from(b.data || "", "base64");
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) err("문서는 40MB 이하만 올릴 수 있습니다.");
    const file = path.join(uploadDir(w.id), name);
    await mkdir(uploadDir(w.id), { recursive: true });
    await writeFile(file, bytes);
    schedule("doc-" + randomUUID(), w.id, name + " · 열어서 캡처하는 중", () => addPages(w.id, name, file));
    json({ queued: true }, 202);
  },

  // 그림 한 장 올리기
  "POST /api/upload": async ({ b, json }) => {
    const w = load(b.id);
    json({ capture: await addImage(w.id, b, Buffer.from(b.data || "", "base64")) }, 201);
  },

  "POST /api/remove-work": async ({ b, json }) => {
    const w = current(b);
    if (busy(w.id)) err("작업 완료 후 삭제하세요.", 409);
    removeWork(w.id);
    await rm(uploadDir(w.id), { recursive: true, force: true });
    json({ ok: true });
  },

  // 심사 기준이나 빠짐없음 표시가 바뀌면 확정 점수만 지운다.
  // 캡처는 그대로이므로 rev를 올리지 않아 내용 요약(유료)은 남는다.
  "POST /api/settings": ({ b, json }) => {
    const w = current(b);
    w.rubric = rubric(b.rubric);
    w.complete = b.complete === true;
    w.final = null;
    w.error = "";
    save(w);
    json({ ok: true });
  },

  // 도식 검토로 지정(캡처 여러 장 한 번에). 다음 요약부터 그 쪽은 그림도 함께 읽는다.
  "POST /api/visual": ({ b, json }) => {
    const w = current(b);
    const ids = new Set(Array.isArray(b.captures) ? b.captures : []);
    const targets = w.captures.filter((c) => ids.has(c.id) && !c.visual);
    if (!targets.length) err("지정할 캡처가 없습니다.");
    for (const c of targets) c.visual = true;
    changed(w);
    save(w);
    json({ ok: true, count: targets.length });
  },

  // 캡처 한 장: 글자 다시 읽기(retry) · 원본에서 다시 캡처(recapture) · 삭제(remove)
  "POST /api/capture": async ({ b, json }) => {
    const w = current(b);
    const c = w.captures.find((x) => x.id === b.capture);
    if (!c) err("캡처가 없습니다.");
    if (b.action === "retry") {
      if (c.status === "queued") err("이미 인식 중입니다.");
      rereadText(w, c);
    } else if (b.action === "recapture") {
      if (busy(w.id)) err("현재 작품의 작업을 완료한 뒤 실행하세요.", 409);
      const file = await originalFile(w, c);
      if (!file) err("원본 문서가 없어 다시 캡처할 수 없습니다. 화면을 캡처해 올린 뒤 이 캡처를 지우세요.");
      schedule("recapture-" + c.id, w.id, c.label + " · 다시 캡처하는 중", async () => {
        const secured = !!w.source?.files?.includes(c.document); // Forms 첨부(보호 문서)
        const [bytes] = await attachmentPages(file, c.page || 1, { secured }); // 그 쪽이 없으면 attachmentPages가 알린다
        await replaceImage(w.id, c.id, bytes);
      });
    } else if (b.action === "remove") {
      w.captures = w.captures.filter((x) => x.id !== c.id);
      changed(w, true);
      atomic(() => {
        save(w);
        deleteImage(c.id);
      });
    } else err("알 수 없는 캡처 동작입니다.");
    json({ ok: true });
  },

  // 캡처 다시 읽어오기(캡처 자료 탭 머리 버튼): 원본 문서가 있으면 문서마다 다시 쪽 그림으로 받아 같은 쪽 캡처를 바꾸고
  // (원본에서 늘어난 쪽은 더한다), 원본이 없는 화면 캡처는 글자만 다시 읽는다. 바꾼 쪽은 글자도 다시 읽는다(replaceImage).
  "POST /api/reread-captures": ({ b, json }) => {
    const w = current(b);
    if (!w.captures.length) err("다시 읽어올 캡처가 없습니다.");
    if (busy(w.id)) err("진행 중인 작업이 끝난 뒤 실행하세요.", 409);
    const docs = [...new Set(w.captures.map((c) => c.document))];
    schedule("reread-" + w.id, w.id, "캡처 다시 읽어오는 중", async (progress) => {
      for (const [n, name] of docs.entries()) {
        progress(`캡처 다시 읽어오는 중 · ${name}`, Math.round((n / docs.length) * 100));
        const fresh = load(w.id), mine = fresh.captures.filter((c) => c.document === name);
        const file = mine.some((c) => c.page) ? await originalFile(fresh, mine[0]) : "";
        if (!file) {
          for (const c of mine) if (c.status !== "queued") rereadText(fresh, c);
          continue;
        }
        const pages = await attachmentPages(file, 0, { secured: !!fresh.source?.files?.includes(name) }); // Forms 첨부(보호 문서)
        for (const c of mine) if (pages[c.page - 1]) await replaceImage(w.id, c.id, pages[c.page - 1]);
        for (const [i, bytes] of pages.entries())
          if (!mine.some((c) => c.page === i + 1)) await addImage(w.id, { document: name, page: i + 1, total: pages.length }, bytes);
      }
    });
    json({ ok: true });
  },

  // 캡처를 모두 지우고 새로 올리기. 올려 둔 원본 문서도 지운다. MS Forms 첨부는 자동으로 다시 읽지 않는다(사람이 새로 올린다).
  "POST /api/reset-captures": async ({ b, json }) => {
    const w = current(b);
    if (busy(w.id)) err("진행 중인 작업이 끝난 뒤 지우세요.", 409);
    w.captures = [];
    if (w.source?.files) w.source.read = Object.fromEntries(w.source.files.map((n) => [n, { manual: true }]));
    changed(w, true);
    atomic(() => {
      deleteImagesOf(w.id);
      save(w);
    });
    await rm(uploadDir(w.id), { recursive: true, force: true });
    json({ ok: true });
  },

  // AI 요약(이어서 사실·논리 점검)과 점검만 다시 하기
  "POST /api/summarize": ({ b, json }) => runSummary(b, json, false),
  "POST /api/check-logic": ({ b, json }) => runSummary(b, json, true),

  // 채점표 확정
  "POST /api/final": ({ b, json }) => {
    const w = current(b);
    if (!w.captures.length) err("캡처 자료를 올린 뒤 채점하세요.");
    // 채점표를 연 뒤에 다른 평가자가 확정·수정했으면 덮어쓰지 않는다(base: 화면이 연 채점표의 확정 시각).
    if ((b.base || null) !== (w.final?.when || null))
      err("그사이 다른 평가자가 이 채점표를 확정했습니다. 새로고침해 확인한 뒤 다시 저장하세요.", 409);
    w.final = { ...finalSheet(b, w.rubric), when: new Date().toISOString() };
    save(w);
    json({ ok: true });
  },
};

async function runSummary(b, json, check) {
  const key = await savedKey();
  if (!key) err("서버에 Claude API 키가 없습니다. 요약 설정에서 등록하세요.", 503);
  startSummary(current(b), check, key);
  json({ ok: true }, 202);
}
