# 평가 단추 앱 (idea-review, Slack Deno 앱)

아이디어정리에서 담당자에게 보낸 작품에 **[평가 답장하기]** 단추를 붙이는 Slack 앱입니다.
단추와 입력 창은 Slack 서버에서 돌아가므로, 아이디어정리 서버가 꺼져 있어도 담당자는 의견을 보낼 수 있습니다.
아이디어정리는 켜질 때와 그 뒤 1분마다 이 앱이 남긴 의견 메시지를 찾아 채점표에 담습니다.

흐름: 아이디어정리 **보내기** → idea_proposal 봇이 담당자 + 이 앱 봇과 그룹 DM을 열어 HTML 파일을 올림 → 이 앱의 웹훅을 불러
같은 그룹 DM에 단추를 올림 → 담당자가 단추를 눌러 의견 보내기 → 이 앱이 의견 메시지를 남김 → 아이디어정리가 가져가 채점표에 담음.

## 처음 한 번 (맥 터미널)

Slack 유료 플랜(워크플로 앱 배포 가능)이어야 합니다. 명령은 **한 줄씩 따로** 붙여 넣으세요(설명 줄까지 붙여 넣으면 `command not found: #`가 납니다).

### 1. Deno·Slack CLI 설치

```sh
curl -fsSL https://deno.land/install.sh | sh
```
```sh
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
```

Deno 설치 끝에 `JSR package manifest … failed`가 나오면 터미널이 deno를 못 찾습니다. 길을 직접 넣습니다:

```sh
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.zshrc
```
```sh
source ~/.zshrc
```

회사망(보안 장비 인증서)에서는 deno가 deno.land에서 Slack 도구를 받다가 인증서 때문에 막힙니다. Mac에 등록된 인증서를 쓰게 합니다:

```sh
echo 'export DENO_TLS_CA_STORE=system' >> ~/.zshrc
```
```sh
source ~/.zshrc
```

확인: 아래가 `{"hooks": …}`로 시작하는 글을 내면 준비된 것입니다. (`slack deploy`가 `manifest.json: no such file`로 실패하면 이 단계가 안 된 것입니다.)

```sh
deno run -q --allow-read --allow-net https://deno.land/x/deno_slack_hooks@1.5.0/mod.ts
```

### 2. Slack 로그인

```sh
slack login
```

1. 터미널에 나온 `/slackauthticket …` 줄 전체를 복사해 Slack 아무 채널이나 내 DM에 붙여 넣고 보냅니다.
2. 승인 창에서 **허용** → 나온 **challenge code**를 복사해 터미널의 `Enter challenge code`에 붙여 넣고 Enter.

### 3. 배포

contest-review 폴더 안의 `slack-app`으로 이동합니다(위치를 모르면 아이디어정리 서버를 켠 터미널에서 `pwd`).

```sh
cd ~/(contest-review 폴더 위치)/slack-app
```
```sh
slack deploy
```

워크스페이스를 고르라고 하면 회사 워크스페이스를 고릅니다. `idea-review` 앱이 Slack에 올라갑니다.

### 4. 웹훅 만들기

```sh
slack trigger create --trigger-def triggers/review_webhook.ts
```

나온 주소(`https://hooks.slack.com/triggers/…`)를 복사해 둡니다.

### 5. 아이디어정리에 넣기

1. Slack에서 **idea-review** 앱 이름을 눌러 프로필을 열고 **⋮ → 멤버 ID 복사**(U로 시작)
2. 아이디어정리 `deploy/site.json`의 `slack`에 넣기(토큰·주소는 채팅이나 사진에 보이지 않게):

```json
"slack": {
  "botToken": "xoxb-…",
  "reviewWebhook": "https://hooks.slack.com/triggers/…",
  "reviewBotId": "U…"
}
```

3. idea_proposal 앱의 App Manifest `scopes: bot:`에 `- mpim:write`, `- mpim:history` 두 줄을 더하고 **Reinstall**(그룹 DM을 열고 읽기)
4. 아이디어정리를 `./start.sh`로 다시 켭니다.

## 고친 뒤 다시 올리기

`slack deploy` 한 번이면 됩니다(웹훅 주소는 그대로).
