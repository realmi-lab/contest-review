// 서버 설정: 프로젝트·데이터 폴더, 포트, 웹 모드
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appDir } from "./app-dir.mjs";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // 프로젝트 폴더
export const publicDir = path.join(root, "public"); // 화면 파일

// 웹 모드: 다른 PC에서 https 웹 주소로 여는 서버(deploy/start-web.py가 켠다). 아니면 이 컴퓨터의 localhost에서만 연다.
// REVIEW_NAS_MODE는 예전 이름이다(이미 등록된 서비스 호환).
export const webMode = process.env.REVIEW_WEB_MODE === "1" || process.env.REVIEW_NAS_MODE === "1";

// 데이터 폴더: REVIEW_DATA_DIR로 바꿀 수 있다. 웹 모드는 ContestReviewWeb, 그 밖은 ContestReviewDesk
// (프로젝트 이름은 idea_review로 바꿨지만 폴더 이름은 그대로 둔다: 바꾸면 저장된 작품·키·Edge 로그인을 못 찾는다)
export const directory = process.env.REVIEW_DATA_DIR || appDir(webMode ? "ContestReviewWeb" : "ContestReviewDesk");

export const port = Number(process.env.REVIEW_PORT || 18765);

// 빌드 번호: 깃 커밋 수 · 짧은 해시 · 날짜(깃이 없으면 package.json 버전). 왼쪽 메뉴에 보여 준다.
function buildNumber() {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return `빌드 ${git("rev-list", "--count", "HEAD")} · ${git("log", "-1", "--format=%h · %cs")}`;
  } catch {
    return "버전 " + JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  }
}
export const build = buildNumber();
