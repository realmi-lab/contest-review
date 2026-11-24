# 평가 단추 앱 (idea-review, Slack Deno 앱)

아이디어정리에서 고른 담당자에게 작품 HTML 파일과 **[평가 답장하기]** 단추를 보내는 Slack 앱입니다(담당자에게는 이 앱 하나로 보입니다).
단추와 입력 창은 Slack 서버에서 돌아가므로, 아이디어정리 서버가 꺼져 있어도 담당자는 의견을 보낼 수 있습니다.
idea_proposal 앱 설정은 바꾸지 않습니다.

흐름: 아이디어정리 **보내기** → 이 앱의 웹훅에 HTML을 실어 보냄 → 이 앱이 담당자 DM에 HTML 파일과 단추를 보냄
→ 담당자가 단추를 눌러 의견 보내기 → 이 앱이 idea_proposal 봇의 토큰으로 그 봇의 DM에 의견을 남김(수집용)
→ 아이디어정리가 켜질 때·1분마다 그 DM에서 의견을 찾아 채점표에 담음.

## 지금 할 일 (체크리스트)

관리자 승인을 요청해 둔 뒤에는 이 순서로 합니다(모두 `slack-app` 폴더의 터미널에서).

1. [ ] **배포**: `slack deploy` (승인 전에 실패했으면 다시 실행. 배포가 설치까지 하므로 따로 재설치하지 않습니다)
2. [ ] **idea_proposal 토큰을 이 앱에 넣기**: 아래를 실행하고, 묻는 값에 idea_proposal의 `xoxb-…` 토큰(= site.json의 botToken)을 붙여 넣기

   ```sh
   slack env add PROPOSAL_BOT_TOKEN
   ```

   (이 앱이 의견을 idea_proposal DM에 남길 때 씁니다. 토큰은 Slack 서버의 이 앱에만 저장됩니다)
3. [ ] **웹훅 만들기**: `slack trigger create --trigger-def triggers/review_webhook.ts`
   - 앱을 고르라고 하면 `(local)`이 아닌 **배포한 앱**
   - 나온 `https://hooks.slack.com/triggers/…` 주소 복사 (처음 한 번만, 다시 배포해도 그대로)
4. [ ] **site.json에 넣기**: 아이디어정리 `deploy/site.json`의 `slack`에 `"reviewWebhook": "https://hooks.slack.com/triggers/…"`
5. [ ] **아이디어정리 다시 켜기**: `git pull` → `./start.sh`
6. [ ] **시험**: 채점표 탭 → 담당자 검색 → **보내기** → 담당자에게 idea-review DM(HTML 파일 + [평가 답장하기])이 오면, 단추로 의견을 보내고 1분 안에 채점표 **담당자 의견**에 담기는지 확인

idea-review는 CLI로 올린 앱이라 Slack 웹(api.slack.com) 설정 화면이 없습니다. 배포·환경 변수·웹훅·삭제는 모두 CLI로 합니다
(`slack deploy`, `slack env list`, `slack trigger list`, `slack delete`). 막히면 화면을 그대로 보여 주세요.

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

### 4. idea_proposal 토큰 넣기

```sh
slack env add PROPOSAL_BOT_TOKEN
```

묻는 값에 idea_proposal의 `xoxb-…` 토큰을 붙여 넣습니다.

### 5. 웹훅 만들기

```sh
slack trigger create --trigger-def triggers/review_webhook.ts
```

배포한 앱을 고르고, 나온 주소(`https://hooks.slack.com/triggers/…`)를 아이디어정리 `deploy/site.json`에 넣습니다(토큰·주소는 채팅이나 사진에 보이지 않게):

```json
"slack": {
  "botToken": "xoxb-…",
  "reviewWebhook": "https://hooks.slack.com/triggers/…"
}
```

그다음 아이디어정리를 `./start.sh`로 다시 켭니다.

## HTML을 이 앱이 보내도록 바꾼 뒤 (한 번)

권한이 늘어(`files:write`, `im:write`) 배포할 때 관리자 승인을 다시 요청할 수 있습니다. 승인 뒤 아래 'HTTP 400' 순서(`git pull` → `slack deploy` → `slack trigger update`)를 한 번 하고, 아이디어정리도 `git pull` → `./start.sh`로 다시 켭니다.
보내기는 됐는데 담당자에게 아무것도 오지 않으면 `slack activity --tail`을 켜 두고 다시 보내 오류를 확인합니다(HTML이 너무 커 막히면 웹훅이 HTTP 413을 줍니다).

## 보내기에서 '평가 단추 앱 웹훅 HTTP 400'이 나면

웹훅을 만든 뒤 앱 코드가 바뀌어(입력 이름이 달라져) 웹훅 정의가 옛것인 경우입니다. `slack-app` 폴더에서:

```sh
git pull
```
```sh
slack deploy
```
```sh
slack trigger list
```

목록에서 '아이디어정리 평가 요청'의 ID(`Ft…`)를 확인하고 웹훅 정의를 새로 고칩니다(주소는 그대로):

```sh
slack trigger update --trigger-id Ft여기에 --trigger-def triggers/review_webhook.ts
```

## 고친 뒤 다시 올리기

`slack deploy` 한 번이면 됩니다(웹훅 주소는 그대로).
