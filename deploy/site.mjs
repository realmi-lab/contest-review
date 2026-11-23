// 서버가 놓인 망(QA망·회사망)마다 다른 설정: deploy/site.json 하나 (회사망 예시: deploy/site.example.json)
//   network: 웹 주소·이 맥의 주소·포트·앞단 프록시 주소   forms: MS Forms 공모 연동
// network는 서버를 다시 시작할 때, forms는 1분마다 다시 읽는다. AI 키·연결 주소·모델은 웹앱의 요약 설정에서 정한다.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const file = new URL("./site.json", import.meta.url);

export function readSite() {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error("deploy/site.json을 읽지 못했습니다: " + e.message);
  }
}

// 웹앱의 '공모 연동 설정'이 forms를 바꿀 때 쓴다. 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 바꿔 넣는다.
export function writeSite(site) {
  const temp = new URL("./site.json.tmp", import.meta.url);
  writeFileSync(temp, JSON.stringify(site, null, 2) + "\n");
  renameSync(temp, file);
}
