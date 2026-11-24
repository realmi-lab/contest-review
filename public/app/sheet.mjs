// 채점표 탭: 점수 없이 의견만 남긴다.
//   담당자에게 보내기(Slack 검색 → 보내기) · 담당자 의견(DM 답장, slack.mjs) · 검토 의견(직접 쓰는 메모 한 칸)
import { esc } from "../lib/html.mjs";
import { slackPanel } from "./slack.mjs";
import { state } from "./state.mjs";

export function reportPane() {
  return `${slackPanel()}
    <section class="panel review-note"><h3>검토 의견</h3>
      <form id="review-note" class="stack">
        <textarea name="note" rows="6" maxlength="4000" placeholder="이 작품에 대한 의견을 자유롭게 적으세요">${esc(state.work.reviewNote || "")}</textarea>
        <div><button class="primary">저장</button></div>
      </form>
    </section>`;
}
