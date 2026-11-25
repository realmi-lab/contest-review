# 평가 단추 앱 (idea-review, Slack Deno 앱)

아이디어정리의 Slack 보내기를 이 앱 하나로 합니다. 봇 토큰(idea_proposal)은 필요 없습니다.

- **보내기**: 아이디어정리가 이 앱의 웹훅에 HTML을 실어 보냄 → 이 앱이 담당자 DM에 HTML 파일과 **[평가 답장하기]** 단추를 보냄
- **의견**: 담당자가 단추를 눌러 의견을 보내면 이 앱의 저장소(reviews)에 담김 → 아이디어정리가 켜질 때·1분마다 Slack CLI로 읽어 채점표에 담음
- **담당자 검색**: 이 앱이 매일 Slack 사람 목록을 저장소(people)에 맞춰 둠 → 아이디어정리가 Slack CLI로 읽어 검색

단추와 입력 창은 Slack 서버에서 돌아가므로 아이디어정리가 꺼져 있어도 담당자는 의견을 보낼 수 있습니다.
아이디어정리를 켜는 컴퓨터에 Slack CLI가 설치·로그인돼 있어야 합니다(아래 '처음 한 번'의 1·2).

## 지금 할 일 (체크리스트)

모두 `slack-app` 폴더의 터미널에서 합니다.

1. [ ] **코드 받기**: `git pull`
2. [ ] **배포**: `slack deploy` (권한이 늘어 관리자 승인을 다시 요청할 수 있습니다. 승인 뒤 다시 실행)
3. [ ] **웹훅 새로 고치기**: `slack trigger list`로 '아이디어정리 평가 요청'의 ID(`Ft…`)를 확인하고

   ```sh
   slack trigger update --trigger-id Ft여기에 --trigger-def triggers/review_webhook.ts
   ```

   (웹훅이 아직 없으면 `slack trigger create --trigger-def triggers/review_webhook.ts` → 배포한 앱 고르기 → 나온 주소를 site.json에)
4. [ ] **사람 목록 맞추기 만들기** (처음 한 번): `slack trigger create --trigger-def triggers/people_daily.ts` → 배포한 앱 고르기. 1분 뒤 처음 돌고, 그 뒤 매일 돕니다
5. [ ] **site.json**: `slack`에는 `reviewWebhook`만 있으면 됩니다(botToken은 지워도 됩니다). 아이디어정리는 이 폴더의 배포 기록(.slack/apps.json)에서 앱 ID를 찾아 저장소를 읽습니다(못 찾으면 `"reviewApp": "A…"`에 `slack app list`의 App ID)
6. [ ] **아이디어정리 다시 켜기**: 아이디어정리 폴더에서 `git pull` → `./start.sh`
7. [ ] **시험**: 채점표 탭 → 담당자 검색 → **보내기** → 담당자에게 idea-review DM(HTML 파일 + [평가 답장하기])이 오면, 단추로 의견을 보내고 1분 안에 채점표 **담당자 의견**에 담기는지 확인
8. [ ] (선택) 옛 설정 지우기: `slack env remove PROPOSAL_BOT_TOKEN`

보내기는 됐는데 담당자에게 아무것도 오지 않으면 `slack activity --tail`을 켜 두고 다시 보내 오류를 확인합니다(HTML이 너무 커 막히면 보내기에서 웹훅 HTTP 413이 납니다).
검색에서 'Slack 저장소를 읽지 못했습니다'가 나오면 그 뒤의 까닭을 봅니다. 로그인이 풀렸으면 `slack login`을 다시 합니다.

idea-review는 CLI로 올린 앱이라 Slack 웹(api.slack.com) 설정 화면이 없습니다. 배포·웹훅·저장소·삭제는 모두 CLI로 합니다
(`slack deploy`, `slack trigger list`, `slack datastore query --datastore reviews '{}'`, `slack delete`). 막히면 화면을 그대로 보여 주세요.

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

### 4. 웹훅·사람 목록 맞추기 만들기

```sh
slack trigger create --trigger-def triggers/review_webhook.ts
```
```sh
slack trigger create --trigger-def triggers/people_daily.ts
```

둘 다 배포한 앱을 고릅니다. 첫 번째에서 나온 주소(`https://hooks.slack.com/triggers/…`)를 아이디어정리 `deploy/site.json`에 넣습니다(주소는 채팅이나 사진에 보이지 않게):

```json
"slack": {
  "reviewWebhook": "https://hooks.slack.com/triggers/…"
}
```

그다음 아이디어정리를 `./start.sh`로 다시 켭니다.

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

## 토큰·웹훅 주소가 사진이나 채팅에 보였으면

_작성 2026-11-25 09:10 (한국 시간)_

- **봇 토큰(botToken, xoxb-)**: 이제 쓰지 않으므로 `deploy/site.json`에서 `"botToken"` 줄을 지웁니다. 보였던 토큰은 idea_proposal 앱 설정 → OAuth & Permissions에서 Revoke(폐기)합니다(그 앱을 다른 데서 쓰면 Revoke 뒤 Reinstall로 새 토큰을 받습니다).
- **웹훅 주소(reviewWebhook)**: 주소만 있으면 누구나 이 앱이 DM을 보내게 할 수 있으므로 새로 만듭니다. `slack-app` 폴더에서:

  ```sh
  slack trigger list
  ```
  ```sh
  slack trigger delete --trigger-id Ft여기에
  ```
  ```sh
  slack trigger create --trigger-def triggers/review_webhook.ts
  ```

  배포한 앱을 고르고, 새로 나온 주소를 `deploy/site.json`에 넣습니다(새로 만들면 새 정의로 만들어지므로 `trigger update`는 필요 없습니다):

  ```json
  "slack": {
    "reviewWebhook": "https://hooks.slack.com/triggers/…새 주소…"
  }
  ```

  저장한 뒤 아이디어정리를 `./start.sh`로 다시 켭니다. 토큰·주소는 사진을 찍을 때 가립니다.

## 검색에서 'Slack 사람 목록이 아직 없습니다'가 나오면

_작성 2026-11-25 09:13 (한국 시간)_

저장소 읽기는 되고, 사람 목록(people)이 비어 있는 경우입니다. `slack-app` 폴더에서:

1. **사람 목록 트리거가 있는지**: `slack trigger list`에 '아이디어정리 사람 목록 맞추기'가 보이는지 확인합니다. 없으면 만듭니다(배포한 앱 고르기):

   ```sh
   slack trigger create --trigger-def triggers/people_daily.ts
   ```

2. **돌았는지**: 트리거는 만든 1분 뒤 처음 돕니다. 1분쯤 기다린 뒤 저장소를 봅니다:

   ```sh
   slack datastore query --datastore people '{}'
   ```

3. **그래도 비어 있으면**: `slack activity`에서 '사람 목록 맞추기'의 오류를 확인합니다.

목록이 채워지면 아이디어정리는 다시 켤 필요 없이 다시 검색하면 됩니다.

### '사람 목록을 읽지 못했습니다: missing_argument'가 나면

_작성 2026-11-25 09:17 (한국 시간)_

회사처럼 조직(Enterprise Grid)에 설치된 앱은 워크스페이스를 정해 읽어야 합니다(지금 코드는 그렇게 읽습니다). `git pull` → `slack deploy`로 새 코드를 올린 뒤, 바로 다시 돌리려면 사람 목록 트리거를 지우고 새로 만듭니다(만든 1분 뒤 돕니다):

```sh
slack trigger list
```
```sh
slack trigger delete --trigger-id Ft여기에
```
```sh
slack trigger create --trigger-def triggers/people_daily.ts
```

### 사람 목록 트리거가 여러 개 생겼으면

_작성 2026-11-25 09:20 (한국 시간)_

`slack trigger list`에 '아이디어정리 사람 목록 맞추기'가 여러 개 보이면 모두 지우고 하나만 새로 만듭니다(여러 개면 같은 일을 여러 번 합니다). '아이디어정리 평가 요청'(웹훅)은 지우지 않습니다.

1. 목록에서 '사람 목록 맞추기'의 ID(`Ft…`)를 하나씩 복사해 지웁니다(개수만큼 반복):

   ```sh
   slack trigger list
   ```
   ```sh
   slack trigger delete --trigger-id Ft여기에
   ```

   2026-11-25 회사 Mac에 생긴 세 개(사진으로 읽은 ID라 'not found'가 나면 화면의 ID를 복사해 넣습니다):

   ```sh
   slack trigger delete --trigger-id Ft0CLUENGWQ4
   ```
   ```sh
   slack trigger delete --trigger-id Ft0CLKFJ96CV
   ```
   ```sh
   slack trigger delete --trigger-id Ft0CLQKW9H9Q
   ```

2. 새 코드로 올리고 하나만 만듭니다(배포한 앱 고르기):

   ```sh
   git pull
   ```
   ```sh
   slack deploy
   ```
   ```sh
   slack trigger create --trigger-def triggers/people_daily.ts
   ```

3. 1분 뒤 목록이 들어왔는지 봅니다:

   ```sh
   slack datastore query --datastore people '{}'
   ```

## HTML 안에서 의견 받기 (선택)

_작성 2026-11-25 10:55 (한국 시간)_

보내는 HTML 파일 맨 아래에 **평가 의견 보내기** 칸을 넣습니다. 받은 사람이 파일을 열어 의견을 적고 [의견 보내기]를 누르면
이 앱의 두 번째 웹훅('아이디어정리 HTML 의견')으로 가서 reviews 저장소에 담기고, 보낸 사람의 idea-review DM에 '의견을 받았습니다'가 옵니다.
아이디어정리는 [평가 답장하기]로 받은 의견과 똑같이 채점표에 담습니다. 같은 사람이 다시 보내면 앞의 의견을 바꿉니다.

`slack-app` 폴더에서:

```sh
git pull
```
```sh
slack deploy
```
```sh
slack trigger create --trigger-def triggers/html_review_webhook.ts
```

배포한 앱을 고르고, 나온 주소를 아이디어정리 `deploy/site.json`의 `slack`에 넣은 뒤 `./start.sh`로 다시 켭니다:

```json
"slack": {
  "reviewWebhook": "https://hooks.slack.com/triggers/…",
  "htmlWebhook": "https://hooks.slack.com/triggers/…(HTML 의견)"
}
```

시험: 채점표에서 나에게 보내기 → 받은 HTML을 브라우저로 열어 맨 아래 칸에 의견을 적고 [의견 보내기] →
idea-review DM에 '의견을 받았습니다'가 오고 1분 안에 채점표 **담당자 의견**에 담기는지 확인합니다.
알림이 오지 않으면 `slack activity --tail`을 켜 두고 다시 보내 보세요(내려받은 파일에서 보내는 요청을 Slack이 받지 않거나,
회사 PC가 바깥으로 보내는 요청을 막으면 오지 않습니다). 그때는 [평가 답장하기] 단추를 쓰면 됩니다.

주의: HTML 안에는 받는 사람과 이 웹훅 주소가 들어갑니다. 파일이 다른 사람에게 전달되면 그 사람도 받는 사람 이름으로 의견을 보낼 수 있고,
누가 실제로 썼는지는 [평가 답장하기]처럼 확인되지 않습니다. 끄려면 site.json에서 `htmlWebhook`을 지우면 됩니다(칸이 빠집니다).

---

마지막 수정: 2026-11-25 10:55 (한국 시간)
