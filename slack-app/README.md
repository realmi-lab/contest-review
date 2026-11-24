# 평가 단추 앱 (idea-review, Slack Deno 앱)

아이디어정리에서 담당자에게 보낸 작품에 **[평가 답장하기]** 단추를 붙이는 Slack 앱입니다.
단추와 입력 창은 Slack 서버에서 돌아가므로, 아이디어정리 서버가 꺼져 있어도 담당자는 의견을 보낼 수 있습니다.
아이디어정리는 켜질 때와 그 뒤 1분마다 이 앱이 남긴 의견 메시지를 찾아 채점표에 담습니다.

흐름: 아이디어정리 **보내기** → idea_proposal 봇이 담당자 + 이 앱 봇과 그룹 DM을 열어 HTML 파일을 올림 → 이 앱의 웹훅을 불러
같은 그룹 DM에 단추를 올림 → 담당자가 단추를 눌러 의견 보내기 → 이 앱이 의견 메시지를 남김 → 아이디어정리가 가져가 채점표에 담음.

## 처음 한 번 (맥 터미널)

Slack 유료 플랜(워크플로 앱 배포 가능)이어야 합니다.

```sh
# 1. Deno와 Slack CLI 설치
curl -fsSL https://deno.land/install.sh | sh
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash

# 2. 이 폴더에서 로그인·배포 (로그인은 Slack 창에서 /slackauthticket 명령을 붙여 넣으라고 안내합니다)
cd slack-app
slack login
slack deploy            # 워크스페이스를 고르면 idea-review 앱이 Slack에 올라갑니다

# 3. 웹훅 만들기 → 나온 주소(https://hooks.slack.com/triggers/…)를 복사
slack trigger create --trigger-def triggers/review_webhook.ts
```

4. Slack에서 **idea-review** 앱 이름을 눌러 프로필을 열고 **⋮ → 멤버 ID 복사**(U로 시작)
5. 아이디어정리 `deploy/site.json`의 `slack`에 넣기:

```json
"slack": {
  "botToken": "xoxb-…",
  "reviewWebhook": "https://hooks.slack.com/triggers/…",
  "reviewBotId": "U…"
}
```

6. idea_proposal 앱 권한에 `mpim:write`, `mpim:history`를 더하고 다시 설치(그룹 DM을 열고 읽기)

## 고친 뒤 다시 올리기

`slack deploy` 한 번이면 됩니다(웹훅 주소는 그대로).
