// 담당자 DM에 HTML 파일, 이어서 [평가 답장하기] 링크를 보낸다(파일 글 맨 위·안내 맨 아래에 구분선 --------). 링크는 이 건만의 워크플로 링크(reply_form, 일회용 표를 담음)라
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
const ask = (link: string) =>
  `💬 *평가 의견을 보내 주세요*\n위 HTML 파일을 열어 보고 아래 링크를 눌러 의견을 적어 보내 주시면 감사하겠습니다. 다시 누르면 보낸 의견을 고칠 수 있습니다.\n👉 *<${link}|평가 답장하기>*\n--------`;

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
  return done.ok ? "" : done.error;
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
    name: "평가 답장하기",
    workflow: `#/workflows/${ReplyFormWorkflow.definition.callback_id}`,
    inputs: { ticket: { value: inputs.ticket }, interactivity: { value: TriggerContextData.Shortcut.interactivity } },
  });
  if (!link.ok || !link.trigger?.shortcut_url) return { error: `평가 답장 링크를 만들지 못했습니다: ${link.error}` };
  const failed = await uploadHtml(client, dm.channel.id, inputs.filename, inputs.html, inputs.comment); // HTML 먼저
  if (failed) return { error: `HTML 파일을 보내지 못했습니다: ${failed}` };
  const posted = await client.chat.postMessage({
    channel: dm.channel.id,
    text: "평가 의견을 보내 주세요",
    unfurl_links: false,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: ask(link.trigger.shortcut_url) } }],
  });
  if (!posted.ok) return { error: `안내 메시지를 보내지 못했습니다: ${posted.error}` };
  return { outputs: {} };
});
