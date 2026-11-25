# idea-review · Slack 평가 앱

**아이디어정리의 ‘담당자에게 보내기’를 Slack과 잇는 앱**입니다. 담당자는 Slack DM으로 제안 HTML을 받아 읽고 **평가 작성하기**를 눌러 의견을 보냅니다. 의견은 아이디어정리의 같은 작품 **채점표 → 담당자 의견**에 모입니다. [아이디어정리 README](../README.md)

Slack이 앱을 대신 돌려 주므로(Run on Slack) 별도 서버·봇 토큰·포트 열기가 필요 없습니다. 운영 컴퓨터가 꺼져 있어도 담당자는 의견을 보낼 수 있고, 아이디어정리는 다시 켜지면 읽어 옵니다.

## 어떻게 이어지나요?

```mermaid
flowchart LR
    A["아이디어정리<br/>담당자에게 보내기"] -->|웹훅| B["idea-review 앱<br/>(Slack에서 실행)"]
    B --> C["담당자 DM<br/>안내 · 평가 작성하기 · HTML"]
    C -->|평가 작성하기| D["Slack 저장소<br/>(의견)"]
    D -->|Slack CLI로 1분마다| E["아이디어정리<br/>담당자 의견"]
```

담당자 DM은 이렇게 옵니다(보낸 건끼리 구분선으로 나뉩니다).

```text
--------
💬 평가 의견을 보내 주세요
[ 평가 작성하기 ]
[제목] 한 줄 요약 · 안내
📎 제목.html
--------
```

| 구성 | 하는 일 |
|---|---|
| idea-review 앱 (이 폴더, Deno) | DM·파일을 보내고, 의견 입력 창을 열고, 의견을 Slack 저장소에 둡니다 |
| Slack CLI (운영 컴퓨터) | 앱 배포·트리거 관리. 아이디어정리가 담당자 목록과 의견을 읽을 때도 씁니다 |
| 아이디어정리 서버 | 담당자를 검색하고 작품 HTML을 만들어 앱에 보냅니다 |

## 처음 설정하기

처음 한 번은 아래 6단계를 순서대로 합니다. 30분쯤 걸리고, 관리자 승인이 필요하면 승인을 기다리는 시간이 더해집니다.

| 단계 | 하는 일 | 결과 |
|---|---|---|
| 1. 권한 확인 | Slack에서 앱을 올릴 수 있는지 확인 | 누가 승인해야 하는지 앎 |
| 2. 도구 설치 | Deno와 Slack CLI 설치 | `deno`, `slack` 명령 |
| 3. Slack 로그인 | CLI가 회사 워크스페이스를 쓰도록 허락 | 이 컴퓨터에 로그인 정보 |
| 4. 배포 | 이 폴더의 앱을 Slack에 올림 | 앱 ID(`A…`) |
| 5. 트리거 만들기 | 앱을 시작할 입구(웹훅·일정) 만들기 | 웹훅 주소 |
| 6. 연결·확인 | 아이디어정리에 웹훅 넣고 나에게 보내 보기 | 왕복 확인 |

### 1. 필요한 권한 확인

**Slack 쪽**

| 필요한 것 | 왜 | 없으면 |
|---|---|---|
| 유료 워크스페이스(Pro 이상) 또는 Enterprise Grid | Deno 앱(Run on Slack)은 유료 플랜에서만 돕니다 | 배포 단계에서 거절됩니다 |
| 앱 설치 권한 | 앱을 워크스페이스에 설치합니다 | 관리자에게 ‘앱 승인’을 요청하게 됩니다(아래) |
| Enterprise Grid면 조직 관리자 승인 | 조직 앱은 어느 워크스페이스에 허용할지 관리자가 정합니다 | 담당자 검색에 일부 사람만 나옵니다 |

회사가 **앱 승인**을 켜 두었으면, 4단계 배포 때 CLI가 승인 요청을 보내고 멈춥니다. 관리자가 Slack 관리 화면에서 승인하면 같은 명령(`slack deploy`)을 다시 실행합니다. 어떤 권한을 승인해 달라는지는 아래 ‘앱이 요청하는 권한’ 표를 그대로 보여 주면 됩니다.

**앱이 요청하는 권한** (`manifest.ts`의 `botScopes`)

| 권한 | 쓰는 곳 |
|---|---|
| `chat:write` | 담당자 DM에 안내·구분선·‘의견을 받았습니다’ 보내기 |
| `im:write` | 앱과 담당자의 DM 열기 |
| `files:write` | 작품 HTML 파일 올리기 |
| `users:read` | 담당자 검색용 사람 목록(이름·표시 이름·직함) 읽기 |
| `datastore:read`, `datastore:write` | 사람 목록·보낸 건·의견을 Slack 저장소에 두고 읽기 |
| `triggers:write` | 보낼 때마다 그 작품의 [평가 작성하기] 링크 만들기 |

앱이 밖으로 연결하는 곳은 `files.slack.com`(파일 올리기) 하나입니다. 메시지 읽기 권한은 없어서 담당자의 다른 대화는 볼 수 없습니다.

**컴퓨터 쪽** · 프로그램 설치 권한만 있으면 됩니다(Mac은 Homebrew, Windows는 winget). Slack CLI 로그인은 **아이디어정리 서버를 실행하는 같은 OS 계정**에서 해야 합니다. 서버가 그 로그인으로 사람 목록과 의견을 읽기 때문입니다.

### 2. 도구 설치

두 가지를 설치합니다.

- **Deno** · 이 폴더의 TypeScript 앱을 실행·검사하는 프로그램입니다. 배포할 때 CLI가 이걸로 앱을 묶습니다.
- **Slack CLI** · 로그인·배포·트리거 관리를 하는 명령줄 도구입니다. 설치되면 `slack` 명령이 생깁니다(Mac은 `~/.slack/bin`).

**Mac · 터미널**

```sh
brew install deno
```

```sh
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
```

**Windows · PowerShell 7**

```powershell
winget install -e --id DenoLand.Deno
```

```powershell
irm https://downloads.slack-edge.com/slack-cli/install-windows.ps1 | iex
```

설치가 끝나면 **터미널을 새로 열고** 버전이 나오는지 봅니다.

```sh
deno --version
slack version
```

`command not found`면 새 창을 열지 않았거나 경로가 안 잡힌 것입니다. Mac은 `~/.slack/bin`이 PATH에 있는지 봅니다(설치 스크립트가 셸 설정에 넣어 줍니다).

> **회사망(Zscaler 등)** · 이후 `slack` 명령이 인증서 오류(`certificate`, `UnknownIssuer`)를 내면 그 터미널에서 먼저 아래를 실행합니다. 회사 인증서를 쓰라는 뜻입니다. 아이디어정리 서버는 CLI를 부를 때 이 설정을 저절로 켭니다.
>
> ```sh
> export DENO_TLS_CA_STORE=system
> ```
>
> PowerShell은 `$env:DENO_TLS_CA_STORE="system"`입니다.

마지막으로 앱 폴더로 이동합니다. 이후 명령은 모두 이 폴더에서 실행합니다.

```sh
cd ~/git/idea_review/slack-app
```

Windows는 `Set-Location "$HOME\git\idea_review\slack-app"`입니다.

### 3. Slack 로그인

CLI가 내 계정으로 회사 워크스페이스에 앱을 올릴 수 있게 허락하는 단계입니다.

```sh
slack login
```

1. 터미널에 `/slackauthticket ABC…` 같은 한 줄이 나옵니다. 복사합니다.
2. Slack에서 회사 워크스페이스의 **나에게 보내는 DM**(내 이름 DM)에 그 줄을 붙여 보냅니다.
3. Slack에 권한 승인 창이 뜹니다. 내용을 보고 **승인**합니다.
4. Slack이 확인 코드를 보여 줍니다. 터미널에 붙여 넣고 Enter를 누릅니다.

잘 됐는지 봅니다.

```sh
slack auth list
```

회사 워크스페이스 이름이 보이면 됩니다. 로그인 정보는 이 계정의 `~/.slack/`에만 저장되고 Git에는 올라가지 않습니다.

### 4. 배포

이 폴더의 앱을 Slack에 올리는 단계입니다. 처음이면 앱이 새로 만들어지고, 다음부터는 같은 앱이 새 코드로 바뀝니다.

```sh
slack deploy
```

진행하면서 이렇게 묻고 보여 줍니다.

1. **어느 워크스페이스에 올릴지** · 회사 워크스페이스를 고릅니다.
2. **Enterprise Grid면 허용할 워크스페이스** · 담당자 검색에는 허용한 워크스페이스 사람만 나오므로, 담당자가 있는 곳을 모두 고릅니다. 나중에 늘리면 다음 날 사람 목록 맞추기 때 반영됩니다.
3. **앱 묶기·검사** · Deno가 코드를 검사하고 묶어 올립니다. 오류가 나면 메시지에 파일 이름이 나옵니다.
4. **설치** · 권한 표(1단계)대로 설치됩니다. 앱 승인을 쓰는 회사면 여기서 ‘승인 요청을 보냈다’고 멈춥니다. 관리자 승인 뒤 `slack deploy`를 다시 실행합니다.

끝나면 앱 ID를 확인해 적어 둡니다. 6단계에서 씁니다.

```sh
slack app list
```

`A`로 시작하는 ID가 배포된 앱(`deployed`)입니다. 배포 기록은 이 폴더의 `.slack/apps.json`에 남습니다(Git에는 올라가지 않음).

**이미 회사에 배포된 앱이 있고 새 컴퓨터에서 이어받는다면** `slack deploy` 대신 기존 앱에 연결합니다.

```sh
slack app link
```

기존 앱 ID와 워크스페이스를 고르고, 환경은 `deployed`를 고릅니다. 원래 배포한 사람이 따로 있으면 그 사람에게 앱 협업자로 추가해 달라고 합니다. 협업자가 아니면 이후 배포·트리거 명령이 거절됩니다.

### 5. 트리거 만들기

트리거는 앱을 시작하는 입구입니다. 먼저 이미 있는지 봅니다.

```sh
slack trigger list
```

목록에 **없는 것만** 한 번씩 만듭니다. 앱을 물으면 4단계의 배포 앱(`deployed`)을 고릅니다.

| 용도 | 만드는 명령 | 만든 뒤 |
|---|---|---|
| 평가 요청 DM (필수) | `slack trigger create --trigger-def triggers/review_webhook.ts` | 나온 웹훅 주소를 6단계 `reviewWebhook`에 넣음 |
| 담당자 목록 맞추기 (필수) | `slack trigger create --trigger-def triggers/people_daily.ts` | 1분 뒤 첫 실행, 이후 매일. 할 일 없음 |
| HTML 안에서 의견 보내기 (선택) | `slack trigger create --trigger-def triggers/html_review_webhook.ts` | 쓸 때만, 웹훅 주소를 `htmlWebhook`에 넣음 |

**평가 작성하기** 단추 링크는 앱이 보낼 때마다 만들므로 따로 만들 필요가 없습니다.

같은 트리거가 **두 개 이상** 생겼으면 하나만 남기고 지웁니다. 지울 ID(`Ft…`)는 `slack trigger list`에서 확인합니다. 웹훅 트리거를 지웠다면 남긴 쪽 주소가 `deploy/site.json`에 들어 있는지 확인합니다.

```sh
slack trigger delete --trigger-id Ft…
```

### 6. 아이디어정리에 연결하고 확인

프로젝트 루트의 `deploy/site.json`을 엽니다. 없으면 [README의 ‘설정 파일 만들기’](../README.md#처음-한-번-설정)대로 예시를 복사합니다. 다른 항목(`network`, `forms`)은 그대로 두고 `slack`만 채웁니다.

```json
"slack": {
  "reviewWebhook": "<평가 요청 웹훅 주소>",
  "reviewApp": "<앱 ID, A로 시작>",
  "htmlWebhook": ""
}
```

- `htmlWebhook`은 HTML 안 의견을 쓸 때만 넣고, 아니면 빈 문자열로 둡니다.
- `reviewApp`을 비우면 이 폴더의 `.slack/apps.json`에서 앱 ID를 찾습니다. 배포한 컴퓨터와 운영 컴퓨터가 다르면 꼭 넣습니다.
- 서버가 `slack` 명령을 못 찾으면 `"cli": "<slack 실행 파일 전체 경로>"`를 추가합니다. 경로는 Mac `command -v slack`, Windows `(Get-Command slack.exe).Source`로 봅니다.

설정은 보낼 때마다 다시 읽으므로 서버를 다시 켤 필요가 없습니다. 웹훅 주소는 비밀번호처럼 다루고 채팅·사진에 올리지 않습니다.

#### 나에게 한 건 보내 확인

1. 아이디어정리에서 작품을 열고 **채점표 → 담당자에게 보내기**에서 내 이름을 검색합니다. 목록이 비어 있으면 5단계의 담당자 목록 맞추기가 처음 돌 때까지(1분) 기다립니다.
2. 나를 골라 **보내기**를 누르고, Slack **idea-review** DM에 위 모양대로 오는지 봅니다.
3. **평가 작성하기**를 눌러 시험 의견을 보냅니다. ‘의견을 받았습니다’ DM이 오고, 1분 안에 **채점표 → 담당자 의견**에 같은 내용이 보이면 끝입니다.
4. 같은 단추를 다시 누르면 보낸 의견이 채워진 채 열리고, 고쳐 보내면 마지막 의견 하나만 남습니다. 휴대폰 Slack에서도 눌러 봅니다.

## 업데이트

아이디어정리에서 `git pull` 한 뒤, Slack 앱 코드가 바뀌었는지 봅니다.

```sh
git diff --name-only HEAD@{1} HEAD -- slack-app
```

| 나온 목록 | 할 일 (`slack-app` 폴더에서) |
|---|---|
| 아무것도 없음 | 할 일 없음 |
| `slack-app/` 파일 | `slack deploy` |
| `slack-app/triggers/` 파일도 있음 | `slack deploy` 후, 바뀐 트리거마다 아래 명령 |

```sh
slack trigger update --trigger-id Ft… --trigger-def triggers/<바뀐 파일>.ts
```

`Ft…`는 `slack trigger list`에서 그 트리거의 ID입니다. 업데이트는 웹훅 주소가 바뀌지 않으므로 `deploy/site.json`은 그대로 둡니다. 배포 때 권한(`manifest.ts`의 `botScopes`)이 늘었으면 관리자 승인을 다시 요청할 수 있습니다.

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 담당자 검색에 아무도 없음 | 담당자 목록 맞추기 트리거가 있는지(`slack trigger list`), 돌았는지(`slack activity --tail`) 봅니다. Enterprise Grid면 담당자가 있는 워크스페이스에 앱을 허용했는지 봅니다 |
| 보내기는 됐는데 DM이 없음 | `slack activity --tail`에서 DM·파일 올리기 오류를 봅니다 |
| ‘웹훅 HTTP 400’ | 트리거 정의가 옛것입니다. ‘업데이트’대로 `review_webhook.ts` 트리거를 고칩니다 |
| ‘웹훅 HTTP 413’ | HTML이 너무 큽니다. 캡처 수를 줄이거나 나눠 보냅니다 |
| 의견을 보냈는데 채점표가 비어 있음 | ‘의견을 받았습니다’ DM이 왔는지 → 아이디어정리가 켜져 있는지 → 최근 30일 안에 보낸 작품인지 → 서버 계정의 `slack auth list`와 `reviewApp`이 맞는지 차례로 봅니다 |
| ‘의견 읽기 실패’·인증서 오류 | 서버를 실행하는 계정에서 `slack auth list`가 되는지, 회사 인증서·프록시를 쓰는지 봅니다 |
| `missing_scope` | 최신 코드로 `slack deploy`하고 관리자 승인 상태를 봅니다 |

**누가 보냈는지** · Slack 단추는 실제로 누른 Slack 계정으로 기록합니다. HTML 안 의견은 받은 사람 이름으로 기록하고 보낸 뒤 90일까지 받습니다. 자료를 다른 사람에게 넘길 수 있다면 HTML 안 의견은 끄고 Slack 단추만 씁니다. 아이디어정리는 최근 30일에 보낸 작품의 의견만 읽어 옵니다.

## 폴더 구성

```text
manifest.ts    앱 이름 · 워크플로 · 권한 등록
workflows/     평가 요청 · 입력 창 · HTML 의견 · 담당자 동기화의 입구
functions/     실제 일: DM·파일 보내기, 입력 창, 의견 저장
triggers/      웹훅 두 개와 매일 일정
datastores/    people(담당자) · reviews(의견) · tickets(보낸 건과 작품의 연결)
```

아이디어정리 쪽 연결 코드는 [src/slack.mjs](../src/slack.mjs)입니다. 요청하는 권한은 `chat:write`·`im:write`(DM), `files:write`(HTML 올리기), `users:read`(담당자 목록), `datastore:read`·`datastore:write`(목록·의견), `triggers:write`(작품마다 평가 작성하기 링크)입니다.
