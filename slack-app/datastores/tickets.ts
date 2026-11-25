// 보낸 건마다 만든 일회용 표: 내보내기 HTML의 [의견 보내기]는 이 표만 들고 오고,
// 받는 사람·작품은 HTML이 아니라 여기 남긴 기록에서 꺼낸다(주소를 알아도 표 없이는 보낼 수 없고, 다른 사람·작품으로 꾸밀 수 없다).
// 평가 요청(post_review_ask.ts)이 보낼 때 남긴다.
import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export default DefineDatastore({
  name: "tickets",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string }, // 표(아이디어정리가 만든 긴 무작위 문자열)
    work_id: { type: Schema.types.string },
    user_id: { type: Schema.types.string }, // 받는 사람
    title: { type: Schema.types.string },
    at: { type: Schema.types.string }, // 보낸 시각(ISO)
  },
});
