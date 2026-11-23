// 웹 모드 HTTPS 서버. 앞단(역방향 프록시)이 넘겨준 요청만 받는다.
// 웹 주소·이 서버의 내부 주소·앞단 주소는 deploy/site.json의 network에서 읽는다(서버를 다시 시작할 때).
import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSite } from "./site.mjs";

const network = readSite().network ?? {};
export const publicHost = network.publicHost ?? "localhost";
export const listenAddress = network.listenAddress ?? "127.0.0.1";
const allowedAddresses = [...(network.proxyAddresses ?? []), listenAddress];

// directory: backend.key·backend.crt(start-web.py가 만든 내부 인증서)가 있는 데이터 폴더
export async function webServer(directory, handle) {
  const [key, cert] = await Promise.all(["backend.key", "backend.crt"].map((name) => readFile(path.join(directory, name))));
  return https.createServer({ key, cert, minVersion: "TLSv1.2" }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fromProxy = allowedAddresses.includes(req.socket.remoteAddress) && [publicHost, publicHost + ":443"].includes(req.headers.host);
    // 다른 사이트에서 보낸 요청(POST는 출처 머리글 필수)은 받지 않는다.
    const sameSite = (!req.headers.origin || req.headers.origin === "https://" + publicHost) &&
      (req.method !== "POST" || (req.headers.origin === "https://" + publicHost && req.headers["sec-fetch-site"] !== "cross-site"));
    if (!fromProxy || !sameSite) return res.writeHead(403).end();
    handle(req, res);
  });
}
