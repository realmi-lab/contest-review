// 서버마다 다른 설정: deploy/site.json 하나 (예시: deploy/site.example.json, 설명: deploy/README.md)
//   network: 웹 주소·이 맥의 주소·포트·앞단 프록시 주소   forms: MS Forms 공모 연동
// network는 서버를 다시 시작할 때, forms는 1분마다 다시 읽는다. AI 키·연결 주소·모델은 웹앱의 요약 설정에서 정한다.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// REVIEW_SITE_FILE: 다른 설정 파일을 쓴다(회귀 점검 scripts/smoke.mjs가 실제 설정을 건드리지 않게)
const file = process.env.REVIEW_SITE_FILE ? pathToFileURL(process.env.REVIEW_SITE_FILE) : new URL("./site.json", import.meta.url);

export function readSite() {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error("deploy/site.json을 읽지 못했습니다: " + e.message);
  }
}

// 켜고 끄는 기능(웹앱의 설정 톱니바퀴에서 바꾼다): logic = AI 논리점검. 적지 않았으면 켠다.
// 끄면 요약 뒤 논리점검을 하지 않고, 작품 단계·목록 탭·내보내기에서 논리점검이 모두 빠진다.
export const features = () => ({ logic: readSite().features?.logic !== false });

// 웹앱의 '공모 연동 설정'이 forms를 바꿀 때 쓴다. 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 바꿔 넣는다.
export function writeSite(site) {
  const temp = new URL(file.href + ".tmp");
  writeFileSync(temp, JSON.stringify(site, null, 2) + "\n");
  renameSync(temp, file);
}
