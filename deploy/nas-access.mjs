import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSite } from "./site.mjs";

// 웹 주소, 이 서버의 내부 주소, 이 서버로 전달하는 앞단(역방향 프록시) 주소: deploy/site.json의 network.
const network = readSite().network ?? {};
export const publicHost = network.publicHost ?? "localhost";
export const macAddress = network.listenAddress ?? "127.0.0.1";
// 앞단 프록시가 없으면(proxyAddresses 비움) 브라우저가 https://<publicHost>:<port>로 바로 연다.
const direct = !network.proxyAddresses?.length;
const allowedAddresses = [...(network.proxyAddresses ?? []), macAddress];
const hosts = direct ? [publicHost + ":" + (network.port ?? 20883)] : [publicHost, publicHost + ":443"];
export const publicOrigin = "https://" + hosts[0];

export async function nasServer(directory, handle) {
  const [key, cert] = await Promise.all(
    ["backend.key", "backend.crt"].map((name) =>
      readFile(path.join(directory, name)),
    ),
  );
  return https.createServer({ key, cert, minVersion: "TLSv1.2" }, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      (!direct && !allowedAddresses.includes(req.socket.remoteAddress)) ||
      !hosts.includes(req.headers.host)
    ) {
      res.writeHead(403).end();
      return;
    }
    if ((req.headers.origin && req.headers.origin !== publicOrigin) ||
        (req.method === "POST" && (req.headers.origin !== publicOrigin ||
          req.headers["sec-fetch-site"] === "cross-site"))) {
      res.writeHead(403).end();
      return;
    }
    handle(req, res);
  });
}
