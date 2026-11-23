// 웹 모드 접속 보호. localhost 실행에서는 모두 통과한다.
// - 접속 코드: deploy/web-access.json이 있으면 코드를 확인한 브라우저만 API를 쓴다.
// - AI 키 관리: 키를 등록(연결)한 브라우저만 키와 연결 설정을 바꾼다.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAccess, verifyCode } from "../deploy/access-code.mjs";
import { savedKey, ticket, validTicket } from "./ai/claude-summary.mjs";
import { directory, webMode } from "./config.mjs";
import { err } from "./validate.mjs";

const MONTH = 30 * 86400;
const cookie = (req, name) => new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(req.headers.cookie || "")?.[1];
// 쿠키를 여러 개 내려줄 수 있도록 기존 Set-Cookie에 덧붙인다.
function addCookie(res, name, value) {
  const line = name + "=" + value + "; Path=/; Max-Age=" + MONTH + "; HttpOnly; Secure; SameSite=Strict";
  res.setHeader("Set-Cookie", [].concat(res.getHeader("Set-Cookie") || [], line));
}

/* 접속 코드. 세션 서명 키 = 이 컴퓨터에만 있는 비밀값 + 코드 해시. 코드를 바꾸면 기존 로그인은 모두 풀린다. */
const access = webMode ? readAccess() : null;
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
const sessionKey = access && (await webSecret()) + ":" + access.hash;
export const hasAccess = (req) => !access || validTicket(sessionKey, "access", cookie(req, "__Host-review-access"));
export const rememberAccess = (res) => access && addCookie(res, "__Host-review-access", ticket(sessionKey, "access", MONTH));
const loginFailures = []; // 최근 10분 실패 시각 (무차별 대입 방지)
export function login(res, code) {
  if (!access) return;
  const now = Date.now();
  while (loginFailures.length && loginFailures[0] < now - 600000) loginFailures.shift();
  if (loginFailures.length >= 30) err("접속 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.", 429);
  if (!verifyCode(access, code)) {
    loginFailures.push(now);
    err("접속 코드가 맞지 않습니다.", 401);
  }
  rememberAccess(res);
}

/* AI 키 관리 권한 */
export const keyAccess = (req, key) => !!key && (!webMode || validTicket(key, "browser", cookie(req, "__Host-review-session")));
// AI 키를 바꿀 수 있는 곳: localhost 실행, 키를 아직 등록하지 않았을 때, 키를 등록(연결)한 브라우저
export async function canManage(req) {
  const key = await savedKey();
  return !webMode || !key || keyAccess(req, key);
}
export function rememberKeyBrowser(res, key) {
  if (webMode) addCookie(res, "__Host-review-session", ticket(key, "browser", MONTH));
}
// 서버 앞의 컴퓨터에서 연 일회용 연결 링크를 한 번만 받아 준다.
const redeemedLinks = new Map(); // 코드 → 만료 시각
export function redeemLink(key, code) {
  for (const [used, expires] of redeemedLinks) if (expires <= Date.now()) redeemedLinks.delete(used);
  if (!validTicket(key, "link", code) || redeemedLinks.has(code))
    err("브라우저 연결 링크가 만료되었습니다. 서버 컴퓨터의 요약 설정에서 다시 여세요.", 403);
  redeemedLinks.set(code, Number(code.split(".")[0]));
}
