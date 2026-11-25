// Slack 사람 목록을 people 저장소에 맞춘다(나간 사람·봇은 뺀다).
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

// 조직(Enterprise Grid)에 설치된 앱은 users.list에 워크스페이스(team_id)를 줘야 한다(없으면 missing_argument).
// 이 앱이 들어간 워크스페이스를 auth.teams.list로 모두 받아 차례로 읽고, 같은 사람은 한 번만 담는다.
export default SlackFunction(SyncPeople, async ({ client }) => {
  const teams = await client.auth.teams.list({ limit: 100 });
  const teamIds: (string | undefined)[] = teams.ok && teams.teams?.length ? teams.teams.map((t: Member) => t.id) : [undefined];
  const people = new Map<string, ReturnType<typeof person>>();
  for (const team_id of teamIds) {
    let cursor = "";
    do {
      const out = await client.users.list({ limit: 200, ...(team_id && { team_id }), ...(cursor && { cursor }) });
      if (!out.ok) return { error: `사람 목록을 읽지 못했습니다: ${out.error}` };
      for (const m of out.members) if (!m.deleted && !m.is_bot && m.id !== "USLACKBOT") people.set(m.id, person(m));
      cursor = out.response_metadata?.next_cursor || "";
    } while (cursor);
  }
  // 200명씩 한 항목(id "0", "1", …)에 담고, 남는 옛 항목은 지운다
  const list = [...people.values()];
  let page = 0;
  for (; page * 200 < list.length; page++) {
    const put = await client.apps.datastore.put({ datastore: "people", item: { id: String(page), list: JSON.stringify(list.slice(page * 200, page * 200 + 200)) } });
    if (!put.ok) return { error: `사람 목록을 저장하지 못했습니다: ${put.error}` };
  }
  const old = await client.apps.datastore.query({ datastore: "people" });
  for (const item of old.items ?? []) if (Number(item.id) >= page) await client.apps.datastore.delete({ datastore: "people", id: item.id });
  return { outputs: {} };
});
