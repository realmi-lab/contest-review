# 아이디어정리

[![자동 점검](https://github.com/realmi-lab/contest-review/actions/workflows/ci.yml/badge.svg)](https://github.com/realmi-lab/contest-review/actions/workflows/ci.yml)

사내 공모에 접수된 제안을 읽고 검토하는 앱입니다. PDF·Word·PowerPoint·Excel·이미지를 받아 쪽별 캡처와 인식 문자를 저장합니다. AI는 제안을 핵심·세부 요약으로 정리하고, 담당자는 근거가 된 쪽을 열어 본 뒤 의견을 남깁니다. 제안은 직접 등록하거나 Microsoft Forms에서 가져올 수 있습니다.

## 무엇을 어디서 실행하나요?

| 구성 | 실행 위치 | 하는 일 |
| --- | --- | --- |
| 아이디어정리 (Node.js) | 운영 Mac 또는 Windows PC | 브라우저 화면을 제공하고 접수, 캡처, OCR, AI 요청, 의견 회수를 관리합니다. 작품·캡처·AI 사용 기록은 이 컴퓨터의 SQLite에 저장합니다. |
| Kordoc · PaddleOCR | 같은 컴퓨터 | 쪽 이미지에서 한국어·숫자·표 안의 글자를 읽습니다. 엔진과 한국어 모델·사전이 저장소에 포함되어 있습니다. |
| Anthropic API 또는 회사 LiteLLM | 요약 설정에서 지정한 서비스 | OCR 텍스트와 ‘도식 검토’로 지정한 캡처를 받아 요약과 논리점검을 만듭니다. AI 연결 전에도 직접 접수와 OCR을 시험할 수 있습니다. |
| Microsoft Forms · OneDrive · Office | Microsoft 365와 운영 컴퓨터 | Forms가 응답·첨부를 모으고 OneDrive가 파일을 동기화합니다. 앱은 동기화된 응답 엑셀을 읽고, Office와 Edge는 회사 계정에 열람 권한이 있는 문서를 여는 데 사용합니다. |
| idea-review (Deno) · Slack CLI | 워크플로는 Slack, CLI는 운영 컴퓨터 | Slack 앱이 담당자에게 제안 HTML을 DM으로 보내고 의견을 저장합니다. 아이디어정리는 CLI로 담당자 목록과 의견을 읽습니다. [Slack 앱 설치·운영 안내](slack-app/README.md) |
| Power Automate (선택) | Microsoft 365 | 엑셀 평가표를 배포할 때 심사자별 OneDrive 폴더의 공유 권한을 부여하는 흐름입니다. [심사자 폴더 공유 설정](docs/GUIDE.md#power-automate-심사자-폴더-공유-흐름) |

## 1. 내 컴퓨터에서 실행하기

Git과 **Node.js 22.21 이상**을 사용합니다. 첫 실행은 npm 패키지를 받으므로 인터넷 또는 회사 프록시 연결이 필요합니다. 아래는 처음 설치하는 명령입니다.

**macOS · 터미널**

```sh
mkdir -p ~/git
git clone https://github.com/realmi-lab/contest-review.git ~/git/contest-review
cd ~/git/contest-review
./start.sh
```

회사 Mac에 이미 복제했다면 `cd ~/git/contest-review` 후 `git pull --ff-only`로 업데이트합니다. 개인용 실행은 `./start.sh`로 시작합니다. 스크립트가 필요할 때 nvm으로 Node를 준비합니다. **이미 사내 웹 서비스로 운영 중인 Mac**은 아래 ‘사내 웹 주소로 운영하기’ 절차로 재시작하세요. 같은 폴더에서 `./start.sh`를 실행하면 기존 웹 서비스를 내리고 localhost 모드로 전환합니다.

**Windows · PowerShell**

```powershell
New-Item -ItemType Directory -Force "$HOME\git" | Out-Null
git clone https://github.com/realmi-lab/contest-review.git "$HOME\git\contest-review"
Set-Location "$HOME\git\contest-review"
.\start.bat
```

다음부터는 탐색기에서 **start.bat**을 더블클릭해도 됩니다. Node가 없거나 버전이 낮으면 배치 파일이 `winget`으로 Node.js LTS 설치를 시도합니다. 회사 PC에 `winget`이 없으면 사내 소프트웨어 배포 경로나 [Node.js LTS](https://nodejs.org/en/download)를 이용하고 새 창에서 다시 실행하세요. 업데이트할 때는 실행 창에서 `Ctrl+C`를 누른 뒤 프로젝트 폴더에서 `git pull --ff-only`, `.\start.bat` 순서로 실행합니다.

**첫 실행 확인** · 브라우저에서 [아이디어정리 열기](http://localhost:18765). Windows는 서버가 준비되면 기본 브라우저를 엽니다. 작품명을 입력해 **작품 접수 → 캡처 자료**에서 시험용 PNG 한 장을 올리고 인식 글자가 나오는지 확인합니다. 창을 닫거나 `Ctrl+C`를 누르면 서버가 종료됩니다. 포트를 바꿨다면 실행 창에 표시된 주소를 사용하세요.

## 2. 사용할 기능 설정하기

| 기능 | 처음 한 번 할 일 | 확인 방법 |
| --- | --- | --- |
| AI 요약 | 왼쪽 아래 **설정 → 요약 설정**에 키를 넣습니다. Anthropic 직접 연결은 연결 주소를 비웁니다. 회사 LiteLLM은 기본 주소와 키를 넣고, 회사에 등록된 모델 이름이 다르면 그 이름도 입력합니다. 앱의 기본 모델 ID는 `claude-haiku-5-5`입니다. | 저장할 때 모델 연결을 확인합니다. 시험 작품에서 **AI 요약**을 열어 요약과 근거 쪽을 확인하세요. |
| AI 논리점검 | **설정 → AI 논리점검**에서 켜거나 끕니다. | 켜 두면 AI 요약에 이어 수치·조건 불일치, 논리 비약, 제안자에게 물을 내용을 검토합니다. |
| Forms 자동 접수 | 운영 컴퓨터에서 OneDrive에 로그인하고 응답 `.xlsx`와 첨부 폴더를 동기화합니다. **설정 → 공모 연동 설정 → 찾아보기**에서 두 경로를 선택하고 저장합니다. 파일 선택 창은 서버 컴퓨터에 뜹니다. | **지금 가져오기**를 눌러 작품명과 첨부 수를 원본 응답과 대조합니다. 서버는 시작할 때와 이후 1분마다 확인합니다. |
| 회사 보호 문서 | 아래 운영체제별 준비를 마치고, 실제 처리할 계정으로 허용된 시험 파일을 한 번 엽니다. | 작품의 **캡처 자료**에서 첫 쪽과 마지막 쪽을 확인합니다. |
| Slack 담당자 의견 | Slack 앱을 배포하고 운영 컴퓨터에 CLI를 로그인한 뒤 `deploy/site.json`에 웹훅과 앱 ID를 연결합니다. | **채점표 → 담당자에게 보내기**에서 본인에게 시험 자료를 보내 의견을 확인합니다. [처음부터 설정하기](slack-app/README.md) |

**Forms 열 매핑** · 기본값은 A 접수 ID, C 인입 시각, D 이메일, E 접수자, G 팀, H 작품명, I 설명, J 첨부입니다. 회사 양식이 다르면 `deploy/site.json`의 `forms.columns`를 맞춥니다. 응답 엑셀과 첨부 폴더는 OneDrive에서 **항상 이 기기에 유지**로 설정하세요. 네트워크·Forms·Slack 설정을 한 파일에 함께 보관하므로 기존 항목을 유지하며 편집합니다. [설정 예시](deploy/site.example.json)

**Mac 문서 열람** · 회사 계정으로 Office와 Edge에 로그인합니다. 시스템 설정의 **개인정보 보호 및 보안**에서 실행 주체(예: 터미널)에 필요한 자동화·화면 기록·손쉬운 사용 권한을 허용합니다. 앱의 **설정 → 운영 맥 점검**은 저장소에 포함된 시험 문서로 Word·Excel·PowerPoint·PDF를 열어 읽힌 첫 쪽과 실패한 단계를 보여 줍니다.

**Windows 문서 열람** · Word·PowerPoint·Excel 데스크톱 앱과 Edge를 설치하고 사용할 회사 계정에 로그인합니다. 보호 PDF용으로 프로젝트의 `deploy\edge-login.bat`을 한 번 실행해 **그 창의 전용 Edge 프로필**에 로그인합니다. 권한이 있는 보호 PDF가 열리는지 확인하고 해당 창을 닫아야 자동 캡처가 이 프로필을 사용할 수 있습니다. 계정에 부여된 열람·내보내기·캡처 권한에 따라 읽을 수 있는 범위가 달라집니다.

## 3. 작품 한 건 검토하기

1. **캡처 자료**에서 원본 쪽순서·글자·수치를 확인합니다. 인식이 어긋난 쪽을 확대하거나 다시 캡처할 수 있습니다. 표·도식의 배치까지 AI가 보아야 하는 쪽은 **도식 검토**로 지정합니다.
2. **AI 요약**에서 먼저 **핵심 요약**으로 제안의 배경·내용·효과를 읽습니다. **세부 요약**은 문제·목표·방법·결과·시사점을 정리하고 근거 쪽과 그림을 연결합니다. AI를 연결했고 첨부와 OCR 처리가 끝났다면 새 캡처가 없는 상태로 15초 후 자동 요약을 시도합니다.
3. **AI 논리점검**에서 확인할 주장과 질문을 원문과 대조합니다. **채점표**에서는 담당자 의견과 심사 메모를 모읍니다. 심사자별 숫자 평가가 필요한 경우 별도 OneDrive 엑셀 평가표 배포 절차가 있습니다. [평가표 운영 안내](docs/GUIDE.md)
4. 작품의 **내보내기**로 요약·점검·원본 캡처를 한 HTML 파일에 담습니다. AI 요청의 토큰과 추정 비용은 **요약 설정 → AI 사용량 확인**에서 봅니다.

## 운영·저장 위치

| 항목 | 위치 |
| --- | --- |
| 로컬 작품·캡처 DB | Mac `~/Library/Application Support/ContestReviewDesk/desk.sqlite3` · Windows `%APPDATA%\ContestReviewDesk\desk.sqlite3` |
| AI 키와 연결 설정 | 위 `ContestReviewDesk` 폴더의 `anthropic.key`, `ai.json`. 웹 모드에서도 같은 운영 계정의 설정을 사용합니다. |
| Forms·Slack·사내망 설정 | 프로젝트의 `deploy/site.json`. 별도 설정 파일은 `REVIEW_SITE_FILE`로 지정할 수 있습니다. |
| 사내 웹 모드의 자료와 로그 | Mac `~/Library/Application Support/ContestReviewWeb/`. 작품 데이터 위치를 지정할 때는 `REVIEW_DATA_DIR`를 사용합니다. |

**사내 웹 주소로 운영하기** · Mac의 `deploy/site.json`에 `network`의 도메인, 내부 IP, 포트, 앞단 프록시 IP를 채웁니다. 역방향 프록시를 연결하고 프로젝트 루트에서 `python3 deploy/start-web.py`를 실행합니다. 이후 코드 업데이트는 `git pull --ff-only` 후 `./deploy/restart-web.command`로 반영합니다. 접속 코드 설정과 HTTPS 연결 조건은 [웹 모드 배포 안내](deploy/README.md)에 있습니다.

**문제가 생겼을 때** · 화면이 열리지 않으면 실행 창에서 Node 버전·설치 오류·포트 사용 여부를 확인하세요. 첨부가 대기 중이면 OneDrive에서 그 파일이 실제로 열리는지 확인하고 **지금 가져오기**를 누릅니다. AI·Slack만 연결되지 않으면 운영 컴퓨터의 회사 인증서와 `HTTPS_PROXY` 설정을 확인합니다.

## 개발과 검증

```sh
npm ci
npm test
npm run smoke
npm run ui-check
```

`npm test`는 단위 테스트, `npm run smoke`는 임시 서버에서 접수·OCR·Forms 흐름, `npm run ui-check`는 Chrome과 모의 AI 응답으로 화면을 확인합니다. Chrome 위치가 다르면 `CHROME_PATH`를 지정합니다. Windows CI는 실제 `cmd.exe`에서 `start.bat`을 실행하고 `/api/state` 응답을 확인합니다. 회사 계정의 Office·MIP 권한과 Slack 실전송은 운영 환경에서 확인할 항목입니다. [자동 점검 내역](https://github.com/realmi-lab/contest-review/actions/workflows/ci.yml)

소스는 `public/`(화면), `src/`(서버·접수·OCR·AI), `vendor/`(OCR 엔진·모델), `slack-app/`(Slack 워크플로), `deploy/`(운영 설정·실행 도구), `scripts/`·`tests/`(검증)에 있습니다. 실제 설정·키·작품 DB·로그는 Git에서 제외합니다. [상세 운영 가이드](docs/GUIDE.md) · [라이선스](LICENSE) · [오픈소스 고지](THIRD_PARTY_NOTICES.md)
