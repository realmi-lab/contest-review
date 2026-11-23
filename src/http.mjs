// 요청 처리 공통: 보안 머리글, 접속 확인, JSON 본문 읽기, 경로 찾기, 화면 파일(public/) 내려 주기
import { readFile } from "node:fs/promises";
import path from "node:path";
import { port, publicDir, webMode } from "./config.mjs";
import { err } from "./validate.mjs";
import { hasAccess } from "./web-access.mjs";

const SECURITY = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
// 접속 코드 없이 부를 수 있는 API: 코드 입력, 서버 컴퓨터에서 연 일회용 연결 링크(자체 검증)
const OPEN_API = ["/api/login", "/api/summary-link"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function body(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 64 * 1024 * 1024) err("요청 용량 초과", 413); // 문서 올리기(40MB)의 base64까지
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || "{}");
  } catch {
    err("JSON 입력 오류");
  }
}

// public/ 안의 화면 파일을 내려 준다. 없으면 false.
async function sendStatic(res, pathname) {
  const file = path.join(publicDir, pathname === "/" ? "index.html" : pathname);
  const type = TYPES[path.extname(file)];
  if (!type || !file.startsWith(publicDir + path.sep)) return false;
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return false;
  res.setHeader("Content-Type", type);
  if (type === "font/woff2") res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(bytes);
  return true;
}

// routes: { "GET /api/state": 처리 함수, "GET /api/work/:id": …, "POST /api/create": … }
// 처리 함수는 { req, res, b: POST 본문, id: 경로의 id, query, json(data, status) }를 받는다.
export function createHandler(routes) {
  return async function handleRequest(req, res) {
    const json = (data, status = 200) => {
      if (res.headersSent) return res.end(); // 이미 보내기 시작한 응답(그림 등) 뒤의 오류
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host;
      if (!webMode && ![`localhost:${port}`, `127.0.0.1:${port}`].includes(host)) err("로컬 주소만 허용합니다.", 403);
      if (!webMode && req.headers.origin && req.headers.origin !== "http://" + host) err("다른 출처의 요청입니다.", 403);
      for (const [name, value] of Object.entries(SECURITY)) res.setHeader(name, value);
      const { pathname, searchParams } = new URL(req.url, "http://" + host);
      if (pathname.startsWith("/api/") && !OPEN_API.includes(pathname) && !hasAccess(req)) err("접속 코드를 입력하세요.", 401);
      const withId = /^(\/api\/[a-z-]+)\/([0-9a-f-]{36})$/.exec(pathname);
      const route = routes[req.method + " " + (withId ? withId[1] + "/:id" : pathname)];
      if (route) {
        let b = {};
        if (req.method === "POST") {
          if (!req.headers["content-type"]?.startsWith("application/json")) err("JSON으로 요청하세요.", 415);
          b = await body(req);
        }
        return await route({ req, res, b, id: withId?.[2], query: searchParams, json });
      }
      if (req.method === "GET" && !pathname.startsWith("/api/") && (await sendStatic(res, pathname))) return;
      err("경로를 찾을 수 없습니다.", 404);
    } catch (e) {
      if (e.code === "ENOENT") return json({ error: "파일을 찾을 수 없습니다." }, 404);
      json({ error: e.message || "처리 오류" }, e.status || 400);
    }
  };
}
