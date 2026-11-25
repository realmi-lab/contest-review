// 내보내기 HTML 파일 안의 [의견 보내기]로 온 의견을 reviews 저장소에 담고, 받는 사람의 DM에 받았다고 알린다.
// HTML은 일회용 표(ticket)와 의견만 보낸다. 받는 사람·작품은 보낼 때 남긴 표 기록(tickets)에서 꺼내므로,
// 웹훅 주소를 알아도 표 없이는 보낼 수 없고 다른 사람·작품으로 꾸밀 수 없다. 표는 보낸 지 90일까지 받는다.
// 같은 표로 다시 보내면 앞의 의견을 바꾼다(id = html:작품:사람). 아이디어정리가 저장소를 읽어 채점표에 담는다.
// 남는 위험: 그 HTML 파일이 다른 사람에게 전달되면 그 사람도 받는 사람 이름으로 보낼 수 있다.
import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const SaveHtmlReview = DefineFunction({
  callback_id: "save_html_review",
  title: "HTML 의견 받기",
  source_file: "functions/save_html_review.ts",
  input_parameters: {
    properties: {
      ticket: { type: Schema.types.string },
      text: { type: Schema.types.string },
    },
    required: ["ticket", "text"],
  },
  output_parameters: { properties: {}, required: [] },
});

const TICKET_DAYS = 90;

export default SlackFunction(SaveHtmlReview, async ({ inputs, client }) => {
  const text = inputs.text.trim().slice(0, 4000);
  if (!text || !inputs.ticket) return { error: "의견이나 표가 비어 있습니다" };
  const found = await client.apps.datastore.get({ datastore: "tickets", id: inputs.ticket });
  const sent = found.ok ? found.item : null;
  if (!sent?.work_id || Date.now() - Date.parse(sent.at) > TICKET_DAYS * 86_400_000) return { error: "맞는 표가 없거나 기한이 지났습니다" };
  const saved = await client.apps.datastore.put({
    datastore: "reviews",
    item: { id: `html:${sent.work_id}:${sent.user_id}`, work_id: sent.work_id, user_id: sent.user_id, text, at: new Date().toISOString() },
  });
  if (!saved.ok) return { error: `의견을 남기지 못했습니다: ${saved.error}` };
  const dm = await client.conversations.open({ users: sent.user_id });
  if (dm.ok) {
    const quote = text.split("\n").map((line) => "> " + line).join("\n");
    await client.chat.postMessage({
      channel: dm.channel.id,
      text: "HTML에서 보낸 의견을 받았습니다",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ *[${sent.title}]* HTML에서 보낸 의견을 받았습니다\n${quote}` } }],
    });
  }
  return { outputs: {} };
});
