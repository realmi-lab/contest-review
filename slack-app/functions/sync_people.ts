// Slack 사람 목록을 people 저장소에 맞춘다(나간 사람·봇은 뺀다). 쪽마다 한 항목에 담고, 남는 옛 항목은 지운다.
import { DefineFunction, SlackFunction } from "deno-slack-sdk/mod.ts";

export const SyncPeople = DefineFunction({
  callback_id: "sync_people",
  title: "사람 목록 맞추기",
  source_file: "functions/sync_people.ts",
  input_parameters: { properties: {}, required: [] },
  output_parameters: { properties: {}, required: [] },
});

// deno-lint-ignore no-explicit-any
type Member = any;
const person = (m: Member) => ({ id: m.id, name: m.profile?.real_name || m.real_name || m.name, nick: m.profile?.display_name || "", title: m.profile?.title || "" });

export default SlackFunction(SyncPeople, async ({ client }) => {
  let cursor = "", page = 0;
  do {
    const out = await client.users.list({ limit: 200, cursor });
    if (!out.ok) return { error: `사람 목록을 읽지 못했습니다: ${out.error}` };
    const list = out.members.filter((m: Member) => !m.deleted && !m.is_bot && m.id !== "USLACKBOT").map(person);
    const put = await client.apps.datastore.put({ datastore: "people", item: { id: String(page++), list: JSON.stringify(list) } });
    if (!put.ok) return { error: `사람 목록을 저장하지 못했습니다: ${put.error}` };
    cursor = out.response_metadata?.next_cursor || "";
  } while (cursor);
  const old = await client.apps.datastore.query({ datastore: "people" });
  for (const item of old.items ?? []) if (Number(item.id) >= page) await client.apps.datastore.delete({ datastore: "people", id: item.id });
  return { outputs: {} };
});
