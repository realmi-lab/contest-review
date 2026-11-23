// 설정 API: 접속 코드, AI 요약 설정·사용량, MS Forms 공모 연동
import { stat } from "node:fs/promises";
import path from "node:path";
import { readSite, writeSite } from "../../deploy/site.mjs";
import { publicHost } from "../../deploy/web-server.mjs";
import {
  ai, aiSettings, haiku, haikuEffortNote, haikuLabel, matches, saveConnection, savedKey, saveKey, ticket, usageReport, verifyKey,
} from "../ai/claude-summary.mjs";
import { reportedUsage } from "../ai/haiku-usage.mjs";
import { webMode } from "../config.mjs";
import { choosePath } from "../intake/choose-path.mjs";
import { checkSources, distribute, FORMS_DEFAULTS, formsConfig, homePath, placeLabel, readResponses, rootOf, storageRoots } from "../intake/forms-intake.mjs";
import { formWorks, intake, rereadIntake, syncIntake, syncNow } from "../intake/sync.mjs";
import { defaults, sheet } from "../review/review.mjs";
import { firstRunAt } from "../store.mjs";
import { recentUsage, utcDay } from "../summary/run.mjs";
import { bounded, err } from "../validate.mjs";
import { canManage, keyAccess, login, redeemLink, rememberAccess, rememberKeyBrowser } from "../web-access.mjs";

export default {
  "POST /api/login": ({ b, res, json }) => {
    login(res, b.code);
    json({ ok: true });
  },

  // 키가 아직 없으면 어느 브라우저에서든 처음 등록할 수 있고, 그 뒤로는 등록한 브라우저(또는 지금 키를 아는 사람)만 바꾼다.
  "GET /api/summary-settings": async ({ req, json }) => {
    const key = await savedKey();
    json({ model: haiku, effort: haikuEffortNote, label: haikuLabel, provider: ai.provider, endpoint: ai.custom, configured: !!key, connected: !!key,
      canManageKey: await canManage(req), local: !webMode });
  },

  // 요약 설정 저장: API 키·연결 주소(비우면 Anthropic, LiteLLM 주소면 LiteLLM)·모델(기본 Haiku 5.5).
  // 키를 비우면 지금 키를 그대로 쓴다. 저장 전에 그 키와 설정으로 모델을 쓸 수 있는지 확인한다.
  "POST /api/summary-token": async ({ req, res, b, json }) => {
    const saved = await savedKey();
    const typed = bounded(b.key ?? "", 512);
    if (webMode && saved && !keyAccess(req, saved) && !matches(typed, saved))
      err("설정은 키를 등록한 브라우저에서 바꿀 수 있습니다. 이 브라우저를 연결하려면 지금 등록된 키를 입력하세요.", 403);
    const connection = aiSettings({ baseUrl: bounded(b.baseUrl ?? "", 300), model: bounded(b.model ?? "", 100) });
    const key = typed || saved;
    if (!key) err("API 키를 입력하세요.");
    if (connection.provider === "anthropic" && !/^sk-ant-[A-Za-z0-9_-]+$/.test(key))
      err("Anthropic API 키(sk-ant-…)를 확인하세요. LiteLLM 키라면 연결 주소를 함께 입력하세요.");
    await verifyKey(key, connection);
    await saveConnection(connection);
    if (!matches(key, saved)) await saveKey(key);
    rememberKeyBrowser(res, key);
    json({ connected: true });
  },

  // 웹 브라우저 연결 링크. localhost 실행에서는 링크를 만들고, 웹 모드에서는 그 링크를 받아 브라우저를 연결한다.
  "POST /api/summary-link": async ({ res, b, json }) => {
    const key = await savedKey();
    if (!key) err("요약 설정에서 API 키를 등록하세요.");
    if (!webMode) return json({ url: "https://" + publicHost + "/#connect=" + ticket(key, "link", 90) });
    redeemLink(key, b.code);
    rememberKeyBrowser(res, key);
    rememberAccess(res);
    console.log("서버 컴퓨터에서 연 웹 브라우저의 AI 요약 연결 완료");
    json({ connected: true });
  },

  // 최근 7일(UTC)의 AI 사용량: 앱이 기록한 합계와 Anthropic이 집계한 토큰을 나란히 돌려준다.
  "GET /api/haiku-cost": async ({ json }) => {
    const key = await savedKey();
    let reported = null,
      reportError = key ? "" : "API 키가 없습니다.";
    if (key)
      try {
        reported = reportedUsage(await usageReport(key, utcDay(-6) + "T00:00:00Z", utcDay(1) + "T00:00:00Z"), haiku);
      } catch (e) {
        reportError = e.status ? "status " + e.status : e.message;
      }
    json({ days: recentUsage(), reported, reportError, recordingSince: firstRunAt() });
  },

  // 공모 연동 설정: 응답 엑셀·첨부 폴더와 읽은 결과(열은 회사 Forms 엑셀 구조로 자동 매칭)
  "GET /api/forms-settings": async ({ json }) => {
    const config = intake.config;
    const roots = await storageRoots(config?.root);
    const place = (p) => p && { path: p, label: placeLabel(roots, p) };
    json({ workbook: place(config?.formsWorkbook), attachments: place(config?.attachmentsDir),
      check: config && await checkSources(config), error: intake.error });
  },

  // 공모 연동 설정 저장: 응답 엑셀·첨부 폴더를 deploy/site.json의 forms에 적는다. 열 매칭 등 나머지 값은 그대로(처음이면 회사 Forms 기본값).
  "POST /api/forms-settings": async ({ b, json }) => {
    const roots = await storageRoots(intake.config?.root);
    const pick = (value) => (path.isAbsolute(String(value ?? "")) ? path.resolve(value) : "");
    const workbook = pick(b.workbook),
      attachments = pick(b.attachments);
    if (!rootOf(roots, workbook) || !/\.xlsx$/i.test(workbook) || !(await stat(workbook).catch(() => null))?.isFile())
      err("OneDrive 폴더 안의 응답 엑셀(.xlsx)을 고르세요.");
    if (!rootOf(roots, attachments) || !(await stat(attachments).catch(() => null))?.isDirectory())
      err("OneDrive 폴더 안의 첨부 파일 폴더를 고르세요.");
    const site = readSite();
    const forms = { ...FORMS_DEFAULTS, oneDriveRoot: rootOf(roots, workbook), ...site.forms };
    // OneDrive 폴더 안이면 상대 경로로 적어 site.json을 읽기 쉽게 둔다
    const base = homePath(forms.oneDriveRoot);
    const short = (p) => (p.startsWith(base + path.sep) ? path.relative(base, p) : p);
    Object.assign(forms, { formsWorkbook: short(workbook), attachmentsDir: short(attachments) });
    await readResponses(formsConfig(forms)); // 고른 엑셀을 회사 Forms 열 구조로 읽을 수 있는지 확인한다
    writeSite({ ...site, forms });
    await rereadIntake();
    json({ ok: true });
  },

  // 찾아보기: 서버 화면에 선택 창을 띄워(서버 앞에 있는 사람만 고를 수 있다) 응답 엑셀(kind=workbook)이나 첨부 폴더를 고른다.
  "POST /api/forms-choose": async ({ b, json }) => {
    const roots = await storageRoots(intake.config?.root);
    const now = b.kind === "workbook" ? intake.config?.formsWorkbook : intake.config?.attachmentsDir;
    const chosen = await choosePath(b.kind === "workbook", now ? path.dirname(now) : roots[0]);
    if (chosen && !rootOf(roots, chosen)) err("이 컴퓨터에 동기화된 OneDrive 폴더 안에서 고르세요.");
    json({ path: chosen, label: chosen && placeLabel(roots, chosen) });
  },

  // MS Forms 응답을 지금 가져오고 평가표를 다시 읽는다.
  "POST /api/intake-sync": async ({ json }) => json(await syncNow()),

  // 심사 배포: 심사자 폴더·평가표·공유 요청 (forms-intake.mjs distribute)
  "POST /api/distribute": async ({ json }) => {
    await syncIntake();
    if (!intake.config) err("연동 설정(deploy/site.json의 forms)이 없습니다.");
    const report = await distribute(intake.config, formWorks(), defaults.criteria, sheet);
    await rereadIntake(false);
    json({ report, intake: intake.view });
  },
};
