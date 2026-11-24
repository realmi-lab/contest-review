// 사람 목록 맞추기를 만든 1분 뒤 한 번, 그 뒤 매일 같은 시각에 돌린다.
// 만들기: slack trigger create --trigger-def triggers/people_daily.ts (배포한 앱 고르기)
import type { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerTypes } from "deno-slack-api/mod.ts";
import SyncPeopleWorkflow from "../workflows/sync_people.ts";

const trigger: Trigger<typeof SyncPeopleWorkflow.definition> = {
  type: TriggerTypes.Scheduled,
  name: "아이디어정리 사람 목록 맞추기",
  workflow: `#/workflows/${SyncPeopleWorkflow.definition.callback_id}`,
  schedule: { start_time: new Date(Date.now() + 60_000).toISOString(), frequency: { type: "daily" } },
};

export default trigger;
