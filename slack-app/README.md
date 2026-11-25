# idea-review · Slack 평가 앱

아이디어정리의 **채점표 → 담당자에게 보내기**를 연결하는 앱입니다. 담당자는 Slack DM에서 제안의 요약·원본 캡처가 든 HTML을 읽고 **평가 작성하기**를 눌러 의견을 보냅니다. 운영자는 아이디어정리의 같은 작품에서 담당자별 최신 의견을 확인합니다. [아이디어정리 설치와 사용법](../README.md)

## 어느 쪽이 무슨 일을 하나요?

| 구성 | 담당하는 일 |
| --- | --- |
| 아이디어정리 서버 (운영 컴퓨터, Node.js) | 담당자를 검색하고 작품 HTML을 만들어 평가 요청 웹훅에 보냅니다. Slack CLI를 호출해 담당자 목록과 의견을 읽고 작품에 반영합니다. |
| idea-review (Slack이 호스팅하는 Deno 앱) | Deno는 이 폴더의 TypeScript를 실행하는 런타임입니다. 배포된 워크플로가 DM·파일을 보내고 의견 입력 창을 열며, Slack 데이터스토어에 의견을 저장합니다. |
| Slack CLI (운영 컴퓨터) | 설치·로그인·배포·트리거 관리를 하는 명령줄 도구입니다. 평소에도 아이디어정리가 데이터스토어를 읽는 데 사용하므로 **서버를 실행하는 OS 계정**에서 로그인해야 합니다. |

배포 뒤에는 운영 컴퓨터가 꺼져 있어도 Slack에서 이미 받은 DM의 의견을 제출할 수 있습니다. 아이디어정리는 다시 켜지면 최근 의견을 읽습니다. Slack 쪽에서 운영 컴퓨터로 들어오는 포트를 열거나 앱에 별도 봇 토큰을 입력할 필요는 없습니다.

## 1. 운영 컴퓨터 준비

워크플로 앱을 배포할 수 있는 Slack 유료 워크스페이스 또는 개발 샌드박스와 앱 설치 권한이 필요합니다. 회사가 앱 승인을 사용하면 관리자의 승인을 받습니다. [Slack 워크플로 앱 시작 안내](https://docs.slack.dev/tools/deno-slack-sdk/guides/getting-started/)

먼저 Git으로 아이디어정리를 복제합니다. 이미 복제했으면 해당 운영체제에서 필요한 도구만 설치하고 **slack-app 폴더**로 이동합니다. 아래의 배포·트리거 명령도 이 폴더에서 실행합니다.

**macOS** · Homebrew를 쓰는 Mac의 예입니다. 다른 설치 경로도 공식 가이드에 있습니다. [Deno 설치](https://docs.deno.com/runtime/getting_started/installation/) · [Mac용 Slack CLI 설치](https://docs.slack.dev/tools/slack-cli/guides/installing-the-slack-cli-for-mac-and-linux/)

```sh
brew install deno
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
cd ~/git/idea_review/slack-app
```

**Windows** · PowerShell 7에서 실행합니다. 회사에서 설치 프로그램을 배포하면 그 경로를 이용할 수 있습니다. [Windows용 Slack CLI 설치](https://docs.slack.dev/tools/slack-cli/guides/installing-the-slack-cli-for-windows/)

```powershell
winget install -e --id DenoLand.Deno
irm https://downloads.slack-edge.com/slack-cli/install-windows.ps1 | iex
Set-Location "$HOME\git\idea_review\slack-app"
```

설치 후 새 터미널이 필요하면 다시 같은 폴더로 이동합니다. 두 운영체제 모두 다음 명령으로 도구와 로그인을 확인합니다.

```sh
deno --version
slack version
slack doctor
slack login
```

터미널이 표시한 `/slackauthticket …` 명령을 대상 워크스페이스의 **본인 DM**에서 실행합니다. 권한을 승인하고 Slack이 표시한 확인 코드를 터미널에 입력한 뒤 `slack auth list`에서 회사 워크스페이스를 확인합니다.

## 2. 새로 배포하거나 기존 운영 앱 연결하기

- **처음 설치하는 워크스페이스**라면 `slack deploy`를 실행해 운영 워크스페이스를 선택합니다. 완료 후 `slack app list`에 표시된 배포 앱 ID(`A…`)를 기록합니다. [Slack 배포 안내](https://docs.slack.dev/tools/deno-slack-sdk/guides/deploying-to-slack/)
- **기존 회사 앱이 있고 새 컴퓨터에 복제했다면** `slack app link`를 실행해 기존 앱 ID와 워크스페이스 ID로 연결하고 환경은 `deployed`를 고릅니다. 원래 배포자가 다른 경우 앱 협업 권한도 확인합니다. 앱 코드를 업데이트할 때만 이 앱을 선택해 `slack deploy`합니다. [기존 앱 연결](https://docs.slack.dev/tools/slack-cli/reference/commands/slack_app_link/) · [협업자 권한](https://docs.slack.dev/tools/deno-slack-sdk/guides/collaborating-with-teammates/)
- **개발 중** `slack run`으로 만든 local 앱에는 별도의 앱 ID와 데이터가 있습니다. 아래 웹훅·트리거·설정에는 모두 같은 **deployed 앱**을 선택합니다.

## 3. 트리거 만들기

먼저 `slack trigger list`에서 배포 앱의 기존 목록을 확인합니다. 아래 명령은 **없는 트리거에만** 한 번씩 실행합니다. 각 명령이 대상을 물으면 2단계의 배포 앱을 선택하세요.

| 용도 | 생성 명령 | 생성한 뒤 할 일 |
| --- | --- | --- |
| 평가 요청 DM · 필수 | `slack trigger create --trigger-def triggers/review_webhook.ts` | 출력된 웹훅 URL을 `reviewWebhook`에 복사합니다. |
| 담당자 검색 · 필수 | `slack trigger create --trigger-def triggers/people_daily.ts` | 약 1분 뒤 첫 동기화가 예정되고 이후 매일 실행됩니다. URL을 복사할 필요가 없습니다. |
| 내려받은 HTML 안에서 의견 제출 · 선택 | `slack trigger create --trigger-def triggers/html_review_webhook.ts` | 이 입력 방식도 사용할 때만 URL을 `htmlWebhook`에 복사합니다. |

**평가 작성하기** 단추의 워크플로 링크는 앱이 보낼 때마다 해당 작품용으로 만듭니다. 이 링크를 따로 생성할 필요는 없습니다.

## 4. 아이디어정리에 연결하기

프로젝트 루트의 **`deploy/site.json`**을 엽니다. 파일이 없으면 아래처럼 만들고, 이미 있다면 기존 `network`, `forms` 등은 유지하면서 `slack` 부분만 편집합니다. 따옴표 안의 설명을 실제 값으로 바꿉니다. HTML 의견을 쓰지 않으면 `htmlWebhook`은 빈 문자열로 둡니다.

```json
{
  "slack": {
    "reviewWebhook": "<평가 요청 트리거 URL>",
    "reviewApp": "<배포된 Slack 앱 ID>",
    "htmlWebhook": ""
  }
}
```

`reviewApp`을 생략하면 서버는 이 프로젝트의 `.slack/apps.json`에서 첫 번째 배포 앱 ID를 찾습니다. 여러 워크스페이스를 쓰거나 배포 컴퓨터와 운영 컴퓨터가 다르면 명시하세요. 서버에서 `slack` 명령을 찾지 못하면 `slack.cli`에 실행 파일의 절대 경로를 추가합니다. Mac은 `command -v slack`, Windows PowerShell은 `(Get-Command slack.exe).Source`로 확인합니다. Windows 경로를 JSON에 적을 때는 `C:/…/slack.exe`처럼 슬래시를 쓸 수 있습니다.

아이디어정리는 Slack 설정을 요청할 때 다시 읽습니다. CLI를 설치해 서비스의 실행 경로를 바꿨다면 **아이디어정리 서비스**를 다시 시작합니다. 웹훅 URL이 든 `deploy/site.json`, CLI의 로그인 정보와 로컬 배포 기록은 Git에 올리지 않습니다. [공유용 설정 예시](../deploy/site.example.json)

## 5. 본인에게 한 건 보내 확인하기

1. **채점표 → 담당자에게 보내기**에서 본인 이름을 검색합니다. 목록이 처음 비어 있으면 예약 트리거의 첫 실행을 기다립니다. 서버는 이름·표시 이름·직함을 검색하고 목록을 10분간 재사용합니다.
2. 본인을 골라 **보내기**를 누릅니다. Slack의 **idea-review** DM에 작품 HTML 파일과 **평가 작성하기** 단추가 도착하는지 확인합니다.
3. Slack에서 단추를 눌러 시험 의견을 제출합니다. 앱의 수신 확인 DM과 아이디어정리 **채점표 → 담당자 의견**에 같은 내용이 보이면 왕복 연결이 끝났습니다. 서버는 시작할 때와 이후 1분마다 최근 30일에 보낸 작품의 최근 30일 의견을 읽습니다.
4. 같은 단추로 의견을 수정해 다시 제출하면 한 작품에서 같은 사람의 최신 의견 한 건이 남습니다. HTML 입력도 켰다면 새로 보낸 파일을 열어 맨 아래에서 시험하고 Slack 확인 DM을 확인합니다.

**답변자 식별** · Slack 단추는 실제로 제출한 Slack 계정으로 기록합니다. HTML 입력은 파일에 든 표를 통해 원래 수신자 이름으로 기록하며, 발송 후 90일까지 제출할 수 있습니다. 다른 사람에게 전달할 자료라면 HTML 의견 입력을 비워 두고 Slack 단추로 받으세요. 90일은 HTML 표의 유효기간이고, 운영 서버의 자동 회수 기간은 30일입니다.

## 업데이트와 문제 해결

코드를 받은 뒤 앱 변경이 있으면 `slack deploy`로 기존 운영 앱을 갱신합니다. 트리거 입력이나 스케줄 정의가 바뀌었으면 `slack trigger list`에서 해당 ID를 확인하고 업데이트합니다. 아래의 `Ft…`는 기존 평가 요청 트리거 ID로 바꾸세요.

```sh
slack trigger update --trigger-id Ft… --trigger-def triggers/review_webhook.ts
```

| 증상 | 확인할 곳 |
| --- | --- |
| 담당자를 찾지 못함 | `slack auth list`의 계정, `reviewApp`과 `slack trigger list`의 앱이 일치하는지 봅니다. `slack activity --tail`로 ‘사람 목록 맞추기’가 성공했는지 확인합니다. |
| 보내기를 눌렀지만 DM이 없음 | 웹훅 성공은 요청 접수를 뜻합니다. 배포 앱의 `slack activity --tail`에서 DM·파일 업로드 결과를 확인하세요. HTTP 400이면 평가 요청 트리거 입력과 배포 코드를, 413이면 첨부한 HTML 크기를 확인합니다. |
| 의견을 제출했는데 채점표가 비어 있음 | 수신 확인 DM, 운영 서버 실행 상태, 최근 30일 발송 여부, 운영 계정의 CLI 로그인과 앱 ID를 차례로 확인합니다. |
| 인증서·권한 오류 | 운영 계정이 회사 인증서와 프록시를 사용하는지 확인합니다. 회사 CA가 등록된 Mac에서는 `export DENO_TLS_CA_STORE=system`, PowerShell은 `$env:DENO_TLS_CA_STORE="system"`으로 CLI를 실행할 수 있습니다. `missing_scope`이면 최신 manifest로 재배포하고 관리자 승인 상태를 확인합니다. |

## 코드와 데이터 찾기

[manifest.ts](manifest.ts)가 워크플로와 권한을 등록합니다. [workflows/](workflows/)는 평가 요청·Slack 입력 창·HTML 의견·담당자 동기화의 진입점이고, [functions/](functions/)는 실제 DM 전송·입력·저장을 수행합니다. [triggers/](triggers/)는 웹훅 두 개와 일일 일정의 정의, [datastores/](datastores/)는 `people`(담당자), `reviews`(작품별 의견), `tickets`(발송과 작품·수신자의 연결표)의 구조입니다. 아이디어정리 쪽 연결 코드는 [src/slack.mjs](../src/slack.mjs)입니다.

요청하는 앱 권한은 `chat:write`·`im:write`(DM), `files:write`(HTML 업로드), `users:read`(담당자 목록), `datastore:read`·`datastore:write`(목록·연결표·의견), `triggers:write`(작품별 답장 링크)입니다. 허용된 외부 파일 업로드 도메인은 `files.slack.com`입니다.
