// 운영 맥 점검: 공모 첨부를 읽는 데 필요한 권한과 앱을, 함께 넣어 둔 시험 문서(assets/self-check, 글 몇 줄짜리 2쪽)를
// 실제로 읽어 확인한다. 첨부를 읽을 때와 같은 코드(attachmentPages)를 쓰므로 여기서 되면 첨부도 읽힌다.
// 점검하는 동안 Edge·Word 등이 잠깐 열렸다 닫힌다. 결과는 메모리에만 두고, 읽은 첫 쪽 그림을 화면에 보여 준다.
import path from "node:path";
import sharp from "sharp";
import { root } from "./config.mjs";
import { attachmentPages } from "./intake/attachment-pages.mjs";
import { installed, macPermissions } from "./intake/pages-mac.mjs";

const SAMPLES = path.join(root, "assets", "self-check");
// name: 화면에 보일 이름 · file: 시험 문서 · app: 필요한 앱 · secured: Forms 첨부처럼 보호 문서로 읽기 · need: 없을 때 안내
const CHECKS = [
  { name: "PDF", file: "sample.pdf" },
  { name: "보호 PDF (Microsoft Edge)", file: "sample.pdf", app: "Microsoft Edge", secured: true, need: "Forms 첨부 PDF(보호 문서)를 읽으려면 필요합니다." },
  { name: "Word", file: "sample.docx", app: "Microsoft Word", need: "Word 첨부를 읽으려면 필요합니다." },
  { name: "PowerPoint", file: "sample.pptx", app: "Microsoft PowerPoint", need: "PowerPoint 첨부를 읽으려면 필요합니다." },
  { name: "Excel", file: "sample.xlsx", app: "Microsoft Excel", need: "Excel 첨부와 보호된 응답 엑셀을 읽으려면 필요합니다." },
];
const SETTINGS = "시스템 설정 > 개인정보 보호 및 보안";

// state: ok · warn(되지만 확인할 것) · error(안 됨). image: 읽은 첫 쪽 그림 번호(images)
export const selfCheck = { running: false, at: "", items: [], images: [] };

const permission = (name, granted, fix) =>
  granted === null ? { name, state: "warn", text: "확인하지 못했습니다. 아래 문서 점검 결과를 보세요." }
    : granted ? { name, state: "ok", text: "허용됨" } : { name, state: "error", text: fix };

async function readSample({ name, file, app, secured, need }) {
  if (app && !(await installed(app))) return { name, state: "warn", text: "이 맥에 설치되어 있지 않습니다. " + need };
  const options = { secured };
  try {
    const pages = await attachmentPages(path.join(SAMPLES, file), 0, options);
    const thumb = await sharp(pages[0]).resize({ width: 480, withoutEnlargement: true }).png().toBuffer().catch(() => null);
    const image = thumb ? selfCheck.images.push(thumb) - 1 : undefined;
    const captured = options.how?.includes("화면 캡처"); // 보호 PDF를 저장하지 못하고 화면으로 읽었다
    return { name, state: captured ? "warn" : "ok", text: `${pages.length}쪽 읽음${options.how ? " · " + options.how : ""}`, image };
  } catch (e) {
    return { name, state: "error", text: e.message };
  }
}

// 캡처 작업과 겹치지 않게 작업 줄(machine)에서 부른다. progress: 진행 중 표시
export async function runSelfCheck(progress = () => {}) {
  Object.assign(selfCheck, { running: true, at: new Date().toISOString(), items: [], images: [] });
  try {
    const { screen, accessibility } = await macPermissions();
    selfCheck.items.push(
      permission("화면 기록 권한", screen, `${SETTINGS} > 화면 및 시스템 오디오 녹화에서 터미널을 허용한 뒤 터미널을 다시 여세요. Word·Excel·보호 PDF 캡처에 필요합니다.`),
      permission("손쉬운 사용 권한", accessibility, `${SETTINGS} > 손쉬운 사용에서 터미널을 허용하세요. 보호 PDF를 Edge에서 저장하는 데 필요합니다.`),
    );
    for (const check of CHECKS) {
      progress("운영 맥 점검 · " + check.name);
      selfCheck.items.push(await readSample(check));
    }
  } finally {
    selfCheck.running = false;
  }
}
