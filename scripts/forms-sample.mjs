// MS Forms 연동을 시험할 가짜 OneDrive를 만든다: 응답 엑셀 + 첨부 + 연동 설정.
// 사용: node scripts/forms-sample.mjs <가짜 OneDrive 폴더>   (deploy/site.json의 forms를 이 폴더로 맞춘다)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeWorkbook } from "../src/intake/xlsx.mjs";

const root = path.resolve(process.argv[2] || "qa-onedrive");
const files = path.join(root, "Apps/Microsoft Forms/아이디어 공모/첨부 파일");
await mkdir(files, { recursive: true });
await mkdir(path.join(root, "아이디어 공모"), { recursive: true });
const answers = [
  [101, "2026-11-20 09:12", "[QA 예시] 사내 공유 우산 대여함", "총무팀", "홍길동", "복지·근무환경", ["우산 대여 기획서_홍길동.pdf"]],
  [102, "2026-11-20 13:40", "[QA 예시] 출금 지연 시 자동 안내 문자", "고객지원팀", "김민지", "고객경험·서비스", ["출금 안내 개선_김민지.pptx", "문의 통계_김민지.xlsx"]],
  [103, "2026-11-21 10:05", "[QA 예시] 의심 로그인 알림 단계 줄이기", "보안운영팀", "박보안", "보안·이용자 보호", ["로그인 알림 개선_박보안.docx"]],
];
for (const [, , , , , , names] of answers)
  for (const name of names) await writeFile(path.join(files, name), "QA 예시 첨부 (실제로는 보호 문서)");
await writeFile(path.join(root, "아이디어 공모/아이디어 공모 응답.xlsx"), writeWorkbook([{
  name: "Form1",
  rows: [["ID", "시작 시간", "완료 시간", "이름", "소속 팀", "아이디어 제목", "분야", "첨부 파일"],
    ...answers.map(([id, at, title, team, name, category, names]) =>
      [id, at, at, name, team, title, category, JSON.stringify(names.map((n) => ({ name: n, link: "https://example.sharepoint.com/" + encodeURIComponent(n) })))])],
}]));
const siteFile = path.resolve("deploy/site.json");
const site = await readFile(siteFile, "utf8").then(JSON.parse, () => ({}));
site.forms = {
  oneDriveRoot: root,
  formsWorkbook: "아이디어 공모/아이디어 공모 응답.xlsx",
  formsSheet: "",
  columns: { id: "ID", submittedAt: "완료 시간", title: "아이디어 제목", team: "소속 팀", submitter: "이름", category: "분야", files: "첨부 파일" },
  attachmentsDir: "Apps/Microsoft Forms/아이디어 공모",
  reviewDir: "아이디어 공모 심사",
  evaluators: [
    { name: "QA 심사자1", email: "qa.reviewer1@example.com", categories: ["복지·근무환경", "고객경험·서비스"] },
    { name: "QA 심사자2", email: "qa.reviewer2@example.com", categories: ["고객경험·서비스", "보안·이용자 보호"] },
  ],
};
await writeFile(siteFile, JSON.stringify(site, null, 2) + "\n");
console.log("가짜 OneDrive:", root);
