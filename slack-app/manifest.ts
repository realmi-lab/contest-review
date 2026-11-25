// 평가 단추 앱(Slack이 운영하는 Deno 앱). 아이디어정리 서버가 꺼져 있어도 [평가 답장하기] 단추와 입력 창이 동작한다.
// 아이디어정리가 HTML을 실어 이 앱의 웹훅을 부르면, 이 앱이 담당자 DM에 HTML 파일과 단추를 보낸다.
// 내보내기 HTML 안에서 쓴 의견은 두 번째 웹훅(HTML 의견 받기)으로 받는다.
// 받은 의견(reviews)과 Slack 사람 목록(people)은 이 앱의 저장소에 두고, 아이디어정리가 Slack CLI로 읽는다(봇 토큰이 필요 없다).
import { Manifest } from "deno-slack-sdk/mod.ts";
import People from "./datastores/people.ts";
import Reviews from "./datastores/reviews.ts";
import Tickets from "./datastores/tickets.ts";
import AskReviewWorkflow from "./workflows/ask_review.ts";
import HtmlReviewWorkflow from "./workflows/html_review.ts";
import ReplyFormWorkflow from "./workflows/reply_form.ts";
import SyncPeopleWorkflow from "./workflows/sync_people.ts";

export default Manifest({
  name: "idea-review",
  description: "아이디어 리뷰 평가 의견 받기",
  icon: "assets/icon.png",
  workflows: [AskReviewWorkflow, SyncPeopleWorkflow, HtmlReviewWorkflow, ReplyFormWorkflow],
  datastores: [Reviews, People, Tickets],
  outgoingDomains: ["files.slack.com"], // 파일 올리기 주소
  botScopes: ["chat:write", "files:write", "im:write", "users:read", "datastore:read", "datastore:write", "triggers:write"], // triggers:write: 건마다 [평가 답장하기] 링크
});
