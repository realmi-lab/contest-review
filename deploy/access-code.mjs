// 웹 주소 접속 코드.
// 코드 원문은 저장하지 않고 salt + scrypt 해시만 deploy/web-access.json에 둔다.
// 파일이 없으면 접속 보호가 꺼진다. 새 코드: node deploy/access-code.mjs
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const accessFile = fileURLToPath(new URL("./web-access.json", import.meta.url));
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 제외

// 대소문자·띄어쓰기·하이픈 차이는 무시한다.
const normalize = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const digest = (code, salt) => scryptSync(normalize(code), Buffer.from(salt, "hex"), 32);

export function readAccess() {
  try {
    const { salt, hash } = JSON.parse(readFileSync(accessFile, "utf8"));
    return salt && hash ? { salt, hash } : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function verifyCode(access, code) {
  return normalize(code).length >= 8 &&
    timingSafeEqual(digest(code, access.salt), Buffer.from(access.hash, "hex"));
}

// 12자리(약 60비트) 코드를 만들어 저장하고 원문을 돌려준다.
export function createAccess() {
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const salt = randomBytes(16).toString("hex");
  const temporary = accessFile + "." + randomBytes(6).toString("hex");
  writeFileSync(temporary, JSON.stringify({ salt, hash: digest(raw, salt).toString("hex") }) + "\n", { mode: 0o600 });
  renameSync(temporary, accessFile);
  return raw.match(/.{4}/g).join("-");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(createAccess());
