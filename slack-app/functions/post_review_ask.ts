// 담당자 DM에 구분선 → 평가 안내와 [평가 작성하기] 단추 → HTML 파일 → 구분선 순서로 보낸다. 단추는 이 건만의 워크플로 링크(reply_form, 일회용 표를 담음)라
// 누를 때마다 새로 시작해 입력 창을 연다(open_reply_form.ts). 그래서 이 함수는 보내고 바로 마치고,
// 시간이 지나도·휴대폰에서도 링크가 동작한다(예전: 열어 둔 작업의 단추라 휴대폰에서 막혔다).
// Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 되고, 아이디어정리는 켜질 때·1분마다 저장소를 읽어 채점표에 담는다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import ReplyFormWorkflow from "../workflows/reply_form.ts";

export const PostReviewAsk = DefineFunction({
  callback_id: "post_review_ask",
  title: "평가 단추 보내기",
  source_file: "functions/post_review_ask.ts",
  input_parameters: {
    properties: {
      user_id: { type: Schema.types.string },
      work_id: { type: Schema.types.string },
      title: { type: Schema.types.string },
      filename: { type: Schema.types.string },
      comment: { type: Schema.types.string },
      html: { type: Schema.types.string },
      ticket: { type: Schema.types.string }, // 일회용 표: [평가 답장하기] 링크와 HTML [의견 보내기]가 들고 간다
    },
    required: ["user_id", "work_id", "title", "filename", "comment", "html", "ticket"],
  },
  output_parameters: { properties: {}, required: [] },
});

// 제목은 넣지 않는다(파일과 함께 가는 글에 있다). Slack 굵게(*…*)는 바로 뒤에 조사가 붙으면 별표가 그대로 보여 안내 글에는 쓰지 않는다.
// [평가 작성하기]는 Slack의 워크플로 단추(workflow_button): 우리가 글자를 정하는 단추지만 누르면 이 건의 워크플로 링크를
// Slack이 직접 시작해, 열어 둔 작업이 필요 없어 휴대폰에서도 눌린다(예전 앱 단추는 휴대폰에서 막히는 Slack 쪽 문제가 있었다).
// 이 단추를 못 쓰는 경우(메시지 거절)에는 링크를 Slack이 펼친 워크플로 카드([워크플로 보기])로 보낸다.
const ASK = "--------\n💬 *평가 의견을 보내 주세요*\n아래 HTML 파일을 보고 *평가 작성하기*를 누르면 작성 창이 열립니다(다시 누르면 고칠 수 있습니다).";
const askCard = (link: string) =>
  `--------\n💬 *평가 의견을 보내 주세요*\n아래 HTML 파일을 보고 카드의 *워크플로 보기*를 누르면 작성 창이 열립니다(다시 누르면 고칠 수 있습니다).<${link}|\u200b>`;
const workflowButton = (link: string) => ({
  type: "actions",
  elements: [{ type: "workflow_button", action_id: "reply_workflow", style: "primary", text: { type: "plain_text", text: "평가 작성하기" }, workflow: { trigger: { url: link } } }],
});

// 파일 올리기 3단계: 올릴 주소 받기 → 올리기 → 채널에 안내 글과 함께 붙이기
async function uploadHtml(client: any, channel: string, filename: string, html: string, comment: string) {
  const bytes = new TextEncoder().encode(html);
  const slot = await client.apiCall("files.getUploadURLExternal", { filename, length: bytes.length });
  if (!slot.ok) return slot.error;
  const up = await fetch(slot.upload_url, { method: "POST", body: bytes });
  if (!up.ok) return "HTTP " + up.status;
  const done = await client.apiCall("files.completeUploadExternal", {
    files: JSON.stringify([{ id: slot.file_id, title: filename }]),
    channel_id: channel,
    initial_comment: comment,
  });
  if (!done.ok) return done.error;
  await new Promise((r) => setTimeout(r, 3000)); // Slack은 파일을 몇 초 뒤에 붙인다: 다음 글(맨 아래 구분선)이 파일보다 먼저 보이지 않게 기다린다
  return "";
}

export default SlackFunction(PostReviewAsk, async ({ inputs, client }) => {
  const dm = await client.conversations.open({ users: inputs.user_id }); // 이 앱과 담당자의 DM
  if (!dm.ok) return { error: `DM을 열지 못했습니다: ${dm.error}` };
  // 일회용 표에 누구에게 어느 작품을 보냈는지 남긴다([평가 답장하기] 링크와 HTML 칸이 꺼내 쓴다)
  const kept = await client.apps.datastore.put({
    datastore: "tickets",
    item: { id: inputs.ticket, work_id: inputs.work_id, user_id: inputs.user_id, title: inputs.title, at: new Date().toISOString() },
  });
  if (!kept.ok) return { error: `일회용 표를 남기지 못했습니다: ${kept.error}` };
  // 이 건만의 워크플로 링크: 누르면 입력 창(누른 사람·이 표)
  const link = await client.workflows.triggers.create<typeof ReplyFormWorkflow.definition>({
    type: TriggerTypes.Shortcut,
    name: "평가 작성하기", // 카드 제목
    workflow: `#/workflows/${ReplyFormWorkflow.definition.callback_id}`,
    inputs: { ticket: { value: inputs.ticket }, interactivity: { value: TriggerContextData.Shortcut.interactivity } },
  });
  if (!link.ok || !link.trigger?.shortcut_url) return { error: `평가 답장 링크를 만들지 못했습니다: ${link.error}` };
  const url = link.trigger.shortcut_url;
  let posted = await client.chat.postMessage({
    channel: dm.channel.id,
    text: "평가 의견을 보내 주세요",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: ASK } }, workflowButton(url)],
  });
  if (!posted.ok) posted = await client.chat.postMessage({ channel: dm.channel.id, text: askCard(url), unfurl_links: true }); // 카드로
  if (!posted.ok) return { error: `안내 메시지를 보내지 못했습니다: ${posted.error}` };
  const failed = await uploadHtml(client, dm.channel.id, inputs.filename, inputs.html, inputs.comment);
  if (failed) return { error: `HTML 파일을 보내지 못했습니다: ${failed}` };
  await client.chat.postMessage({ channel: dm.channel.id, text: "--------" }); // 맨 아래 구분선(HTML 다음)
  return { outputs: {} };
});
