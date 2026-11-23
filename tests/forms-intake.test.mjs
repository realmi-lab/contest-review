import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attachmentNames, copyAttachments, dayOf, distribute, evaluationFile, fileIndex, formEntries, formsConfig, fromOneDrive, workbookRows, writeResponse,
  readEvaluations, readResponses, safeName, shareState, workFolder,
} from "../src/intake/forms-intake.mjs";
import { readSheet, writeWorkbook } from "../src/intake/xlsx.mjs";
import { defaults, sheet } from "../src/review/review.mjs";

const columns = { id: "ID", submittedAt: "완료 시간", title: "제목", team: "소속", submitter: "이름", category: "분야", files: "첨부" };

async function onedrive() {
  const root = await mkdtemp(path.join(os.tmpdir(), "onedrive-"));
  await mkdir(path.join(root, "Apps/Microsoft Forms/공모/첨부"), { recursive: true });
  await mkdir(path.join(root, "공모"), { recursive: true });
  return { root, config: formsConfig({
    oneDriveRoot: root, formsWorkbook: "공모/응답.xlsx", columns, attachmentsDir: "Apps/Microsoft Forms/공모", reviewDir: "공모 심사",
    evaluators: [{ name: "김심사", email: "Kim@Example.com", categories: ["복지"] }, { name: "이심사", email: "lee@example.com", categories: ["보안", "복지"] }],
  }) };
}

test("Forms 날짜와 첨부 칸을 여러 형식으로 읽는다", () => {
  assert.equal(dayOf(46346.375), "2026-11-20");
  assert.equal(dayOf("2026. 11. 20. 오전 9:00:00"), "2026-11-20");
  assert.equal(dayOf("11/20/2026 9:00"), "2026-11-20");
  assert.equal(dayOf(""), "");
  assert.deepEqual(attachmentNames('[{"name":"기획서_홍길동.pptx","link":"https://x"},{"name":"표.xlsx"}]'), ["기획서_홍길동.pptx", "표.xlsx"]);
  assert.deepEqual(attachmentNames("https://a/b/%EA%B8%B0%ED%9A%8D.pdf?web=1; 메모.txt"), ["기획.pdf", "메모.txt"]);
  assert.equal(safeName('12 우산/공유: "비" 오는 날.'), "12 우산 공유 비 오는 날");
});

test("응답 엑셀의 열 이름으로 작품 항목을 만들고 없는 열은 알려 준다", () => {
  const rows = [[], ["ID", "완료 시간", "이름", "소속", "제목", "분야", "첨부"], [7, "2026-11-21 10:00", "홍길동", "운영팀", "공유 우산", "복지", '[{"name":"a.pdf"}]'], ["", "", "", "", "", "", ""]];
  assert.deepEqual(formEntries(rows, columns), [{ id: "7", title: "공유 우산", team: "운영팀", submitter: "홍길동", category: "복지", receivedOn: "2026-11-21", description: "", email: "", files: ["a.pdf"] }]);
  assert.throws(() => formEntries(rows, { ...columns, title: "아이디어 제목" }), /'아이디어 제목' 열이 없습니다. 있는 열: ID, 완료 시간/);
});

test("설정은 OneDrive 안의 상대 경로와 심사자 명단을 확인한다", async () => {
  const { root, config } = await onedrive();
  assert.equal(config.evaluators[0].email, "kim@example.com");
  assert.equal(config.formsWorkbook, path.join(root, "공모/응답.xlsx"));
  assert.throws(() => formsConfig({ oneDriveRoot: root, formsWorkbook: "../밖.xlsx", columns, attachmentsDir: "a", reviewDir: "b" }), /OneDrive 폴더 안의 상대 경로/);
  assert.throws(() => formsConfig({ oneDriveRoot: root, formsWorkbook: "a.xlsx", columns: { id: "ID" }, attachmentsDir: "a", reviewDir: "b" }), /title\(작품명\), files\(첨부 파일\)/);
  assert.equal(formsConfig(undefined), null);
});

test("첨부는 맥 파일 이름(NFD)도 찾아 작품 폴더로 복사하고 아직 없는 파일을 알려 준다", async () => {
  const { root, config } = await onedrive();
  await writeFile(path.join(config.attachmentsDir, "첨부", "기획서_홍길동.pptx".normalize("NFD")), "보호 문서");
  const index = await fileIndex(config.attachmentsDir);
  const target = path.join(root, "공모 심사/작품/7 공유 우산");
  assert.deepEqual(await copyAttachments(["기획서_홍길동.pptx", "표.xlsx"], index, target), ["표.xlsx"]);
  assert.equal(await readFile(path.join(target, "기획서_홍길동.pptx"), "utf8"), "보호 문서");
});

test("심사 배포는 분야별 폴더·평가표·공유 요청을 만들고, 다시 배포해도 심사자가 적은 값을 지킨다", async () => {
  const { config } = await onedrive();
  await writeFile(config.formsWorkbook, writeWorkbook([{ name: "Form1", rows: [["ID", "완료 시간", "제목", "소속", "이름", "분야", "첨부"],
    [1, "2026-11-20", "공유 우산", "운영팀", "홍길동", "복지", '[{"name":"우산.pdf"}]'], [2, "2026-11-20", "출금 알림", "보안팀", "김보안", "보안", ""]] }]));
  await writeFile(path.join(config.attachmentsDir, "첨부", "우산.pdf"), "pdf");
  const entries = await readResponses(config);
  const works = entries.map((e) => ({ name: e.title, category: e.category, submitterName: e.submitter, source: { formId: e.id, files: e.files, folder: workFolder(e) } }));
  for (const w of works) await copyAttachments(w.source.files, await fileIndex(config.attachmentsDir), path.join(config.reviewDir, "작품", w.source.folder));

  const report = await distribute(config, works.slice(0, 1), defaults.criteria, sheet);
  assert.deepEqual(report, [{ name: "김심사", assigned: 1, added: 1 }, { name: "이심사", assigned: 1, added: 1 }]);
  const kim = config.evaluators[0];
  assert.deepEqual(await readdir(path.join(config.reviewDir, "심사자/김심사/1 공유 우산")), ["우산.pdf"]);
  assert.equal(await shareState(config, kim), "공유 대기");
  const request = JSON.parse(await readFile(path.join(config.reviewDir, "_공유 요청/김심사.json"), "utf8"));
  assert.deepEqual(request, { name: "김심사", email: "kim@example.com", folder: "/공모 심사/심사자/김심사", role: "write" });

  // 심사자가 평가표를 채운다(배점을 넘은 값도 그대로 둔다).
  const file = evaluationFile(config, kim);
  const rows = readSheet(await readFile(file), "평가표");
  assert.deepEqual(rows[0].slice(0, 6), ["접수 번호", "작품명", "분야", "제출자", "문제 정의 (1.5)", "효과 크기 (2.5)"]);
  rows[1].splice(4, 10, 1.5, 2, 2, 1.5, 9, "", "과제화", "채택 검토", "좋아요", "");
  await writeFile(file, writeWorkbook([{ name: "평가표", rows }]));
  let read = readEvaluations(await readFile(file), defaults.criteria, sheet);
  assert.deepEqual(read.get("1"), { scores: [1.5, 2, 2, 1.5, null], score: null, scale: "과제화", decision: "채택 검토", feedback: "좋아요", note: "", complete: false, problems: ["차별성 점수"] });

  // 새 작품이 배정되면 다시 쓰되 적은 값(고칠 값 포함)은 남긴다. 이심사는 새 작품(보안)만 추가된다.
  const again = await distribute(config, [...works].reverse(), defaults.criteria, sheet);
  assert.deepEqual(again, [{ name: "김심사", assigned: 1, added: 0 }, { name: "이심사", assigned: 2, added: 1 }]);
  read = readEvaluations(await readFile(file), defaults.criteria, sheet);
  assert.equal(read.get("1").scores[4], null);
  const lee = readSheet(await readFile(evaluationFile(config, config.evaluators[1])), "평가표");
  assert.deepEqual(lee.slice(1).map((r) => r[0]), ["1", "2"]); // 접수 번호 순

  // Power Automate가 공유한 뒤 요청 파일을 '완료'로 옮긴다.
  await mkdir(path.join(config.reviewDir, "_공유 요청/완료"), { recursive: true });
  await rename(path.join(config.reviewDir, "_공유 요청/김심사.json"), path.join(config.reviewDir, "_공유 요청/완료/김심사.json"));
  assert.equal(await shareState(config, kim), "공유 완료");
});

test("응답 엑셀에서 그 응답의 칸만 고친다: 빈 칸에도 적고 다른 행·시트는 그대로 둔다", async () => {
  const { config } = await onedrive();
  await writeFile(config.formsWorkbook, writeWorkbook([
    { name: "Form1", rows: [["ID", "완료 시간", "제목", "설명", "소속", "이름", "분야", "첨부"], [1, "", "우산", "", "운영팀", "홍길동", "", "a.png"], [2, "", "알림", "원래 설명", "", "", "", "b.png"]] },
    { name: "메모", rows: [["그대로"]] },
  ]));
  const withDescription = { ...config, columns: { ...config.columns, description: "설명" } };
  await writeResponse(withDescription, "1", { title: "우산\v2호", description: "새 설명 & <표>", email: "없는 열" }); // \v: Word에서 붙여 넣은 줄 바꿈
  const buffer = await readFile(config.formsWorkbook);
  assert.deepEqual(readSheet(buffer), [["ID", "완료 시간", "제목", "설명", "소속", "이름", "분야", "첨부"], [1, "", "우산 2호", "새 설명 & <표>", "운영팀", "홍길동", "", "a.png"], [2, "", "알림", "원래 설명", "", "", "", "b.png"]]);
  assert.deepEqual(readSheet(buffer, "메모"), [["그대로"]]);
  assert.deepEqual((await readResponses(withDescription)).map((e) => e.title), ["우산 2호", "알림"]);
  await assert.rejects(writeResponse(withDescription, "9", { title: "x" }), /응답 9을 찾지 못했습니다/);
});

test("빈 응답 엑셀은 열 이름을 따지지 않고 응답 0건이다", () => {
  assert.deepEqual(formEntries([[], ["", ""]], columns), []);
});

test("보호(암호화)된 엑셀은 이유를 알려 준다", () => {
  const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
  assert.throws(() => readSheet(cfb), /보호\(암호화\)된 엑셀/);
});

test("K열의 URL 인코딩된 한글 첨부 이름을 풀어 OneDrive에 내려받은 파일과 맞춘다", async () => {
  const encoded = encodeURIComponent("기획서_홍길동.pptx");
  assert.deepEqual(attachmentNames(`[{"name":"${encoded}","link":"https://x/${encoded}"}]`), ["기획서_홍길동.pptx"]);
  assert.deepEqual(attachmentNames(encodeURIComponent(encoded)), ["기획서_홍길동.pptx"]); // 두 번 인코딩
  assert.deepEqual(attachmentNames(`https://co-my.sharepoint.com/personal/a/Documents/Apps/Microsoft%20Forms/%EA%B3%B5%EB%AA%A8/${encoded}`), ["기획서_홍길동.pptx"]);
  // 머리글에 'K'가 없으면 열 문자로 읽는다 (A=0 … K=10)
  const head = ["ID", "완료 시간", "이름", "소속", "제목", "분야", "c", "d", "e", "f", "첨부 파일명"];
  const row = [3, "2026-11-23", "홍길동", "운영팀", "공유 우산", "복지", "", "", "", "", encoded];
  assert.deepEqual(formEntries([head, row], { ...columns, files: "K" })[0].files, ["기획서_홍길동.pptx"]);
  // 맥 OneDrive의 파일 이름은 자모가 분리된(NFD) 채로 내려올 수 있다
  const dir = await mkdtemp(path.join(os.tmpdir(), "forms-"));
  await writeFile(path.join(dir, "기획서_홍길동.pptx".normalize("NFD")), "x");
  const target = path.join(dir, "작품");
  assert.deepEqual(await copyAttachments(attachmentNames(encoded), await fileIndex(dir), target), []);
});

test("설정 화면에서 고른 절대 경로도 받는다", async () => {
  const { root } = await onedrive();
  const outside = path.resolve(root, "..", "공유", "응답.xlsx"); // OneDrive 밖의 절대 경로(윈도우면 C:\…)
  const config = formsConfig({ oneDriveRoot: root, formsWorkbook: outside, columns, attachmentsDir: path.join(root, "첨부"), reviewDir: "심사" });
  assert.equal(config.formsWorkbook, outside);
  assert.equal(config.attachmentsDir, path.join(root, "첨부"));
});

test("첨부 파일명 칸에 이어 쌓인 최대 5개를 나눠 읽는다", () => {
  const names = ["기획서.pptx", "예산, 일정.xlsx", "화면 설계.pdf", "참고.docx", "사진.png"];
  const encoded = names.map(encodeURIComponent);
  assert.deepEqual(attachmentNames(encoded.join(",")), names);
  assert.deepEqual(attachmentNames(encoded.join("; ")), names);
  assert.deepEqual(attachmentNames(encoded.join("\n")), names);
  assert.deepEqual(attachmentNames(JSON.stringify(encoded.map((name) => ({ name })))), names);
  assert.deepEqual(attachmentNames("예산, 일정.xlsx; 사진.png"), ["예산, 일정.xlsx", "사진.png"]); // 인코딩 안 된 이름의 쉼표는 이름의 일부
});

test("OneDrive 온라인 전용 파일(EDEADLK -11)은 내려받을 때까지 다시 읽고, 끝내 안 되면 할 일을 알려 준다", async () => {
  const online = () => Object.assign(new Error("Unknown system error -11"), { errno: -11 });
  let calls = 0;
  assert.equal(await fromOneDrive("응답.xlsx", async () => { if (++calls < 3) throw online(); return "읽음"; }, 1), "읽음");
  assert.equal(calls, 3);
  await assert.rejects(fromOneDrive("응답.xlsx", async () => { throw online(); }, 1, 3), /항상 이 기기에 유지/);
  await assert.rejects(fromOneDrive("응답.xlsx", async () => { throw Object.assign(new Error("없음"), { errno: -2 }); }, 1), /없음/);
});

test("MIP로 암호화된 엑셀(zip이 아님)은 맥의 Excel 앱으로 읽고, 보통 엑셀은 직접 읽는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mip-"));
  const plain = path.join(dir, "응답.xlsx"), locked = path.join(dir, "보호.xlsx");
  await writeFile(plain, writeWorkbook([{ name: "Form1", rows: [["ID", "제목"], [1, "공유 우산"]] }]));
  await writeFile(locked, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])); // 암호화된 Office 파일 머리
  assert.deepEqual((await workbookRows(plain))[1], [1, "공유 우산"]);
  if (process.platform !== "darwin") await assert.rejects(workbookRows(locked), /Excel 앱/);
});

test("OneDrive 문서 링크(Doc.aspx?…&file=)에서는 file= 값을 첨부 이름으로 읽는다", () => {
  const link = (n) => "https://co-my.sharepoint.com/:w:/r/personal/a/_layouts/15/Doc.aspx?sourcedoc=%7BAB-12%7D&file=" + encodeURIComponent(n) + "&action=default&mobileredirect=true";
  assert.deepEqual(attachmentNames(link("제안서_김일홍.docx")), ["제안서_김일홍.docx"]);
  assert.deepEqual(attachmentNames([link("제안서.pptx"), link("표.xlsx")].join(";")), ["제안서.pptx", "표.xlsx"]);
});
