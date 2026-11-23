import sharp from "sharp";
import { fileURLToPath } from "node:url";
const rows = [
  "입출금 문의 처리 개선안",
  "고객지원 담당자는 입금 지연 문의마다 거래 상태를 수동 확인한다.",
  "제안: 상담 화면에서 입금 처리 단계와 지연 사유를 함께 표시한다.",
  "기존 상담 화면을 사용하며 상담원에게 조회 권한만 부여한다.",
  "상태를 조회하지 못하면 수동 확인 절차로 돌아간다.",
  "목표는 평균 처리 시간 20% 단축이다. 아직 실측 결과는 없다.",
  "2주 동안 상담원 3명이 시범 운영 후 변경 전후 시간을 측정한다.",
];
export const umbrellaRows = [
  "비 오는 날을 위한 공유 우산",
  "대상은 퇴근할 때 갑자기 비를 만난 직원과 방문객이다.",
  "현관 안내 데스크에 공용 우산 10개를 비치한다.",
  "대여일과 반납 여부를 기록하고 총무 담당자가 매주 수량을 확인한다.",
  "4주 동안 시험 운영한 뒤 대여 횟수와 미반납 수를 집계한다.",
  "만족도는 시범 운영 후 익명 설문으로 확인할 예정이다.",
];
export const sampleText = rows.join("\n");
export async function sampleImage(kind) {
  const content = (kind === "umbrella" ? umbrellaRows : rows)
    .map(
      (x, i) =>
        '<text x="55" y="' +
        (85 + i * 71) +
        '" font-family="Apple SD Gothic Neo, sans-serif" font-size="' +
        (i ? 27 : 42) +
        '" fill="#171c22">' +
        x +
        "</text>",
    )
    .join("");
  return sharp(
    Buffer.from(
      '<svg width="1280" height="610" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="610" fill="white"/>' +
        content +
        "</svg>",
    ),
  )
    .png()
    .toBuffer();
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(await sampleImage());
