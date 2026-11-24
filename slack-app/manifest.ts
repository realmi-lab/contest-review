// 평가 단추 앱(Slack이 운영하는 Deno 앱). 아이디어정리 서버가 꺼져 있어도 [평가 답장하기] 단추와 입력 창이 동작한다.
// 아이디어정리가 HTML을 실어 이 앱의 웹훅을 부르면, 이 앱이 담당자 DM에 HTML 파일과 단추를 보낸다.
import { Manifest } from "deno-slack-sdk/mod.ts";
import AskReviewWorkflow from "./workflows/ask_review.ts";

export default Manifest({
  name: "idea-review",
  description: "아이디어정리 평가 의견 받기",
  icon: "assets/icon.png",
  workflows: [AskReviewWorkflow],
  outgoingDomains: ["files.slack.com"], // 파일 올리기 주소
  botScopes: ["chat:write", "files:write", "im:write"],
});
