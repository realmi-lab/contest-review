# 아이디어정리

[![점검](https://github.com/realmi-lab/contest-review/actions/workflows/ci.yml/badge.svg)](https://github.com/realmi-lab/contest-review/actions/workflows/ci.yml)

회사 아이디어 제안(MS Forms)을 받아 심사를 돕는 앱입니다.
아이디어가 들어오면 **첨부 캡처 → 글자 읽기 → AI 요약 → AI 점검**까지 알아서 하고, 사람은 **채점표**만 작성하면 됩니다.

## 1. 실행하기

**맥**

```sh
git clone https://github.com/realmi-lab/contest-review.git
cd contest-review
./start.sh
```

**윈도우**: 폴더를 받은 뒤 `start.bat`을 더블클릭합니다.

브라우저에서 **http://localhost:18765** 를 엽니다.
끌 때는 실행한 창에서 `Ctrl+C`를 누릅니다. 새 버전은 `git pull` 후 다시 실행하면 됩니다.

필요한 프로그램(Node.js 등)은 실행할 때 알아서 설치합니다. 인터넷이 되어야 합니다.

## 2. 처음 한 번 설정하기

왼쪽 메뉴 아래의 두 가지만 하면 됩니다.

1. **요약 설정** — AI 키를 넣습니다.
2. **공모 연동 설정** — '찾아보기'로 두 곳을 고르고 저장합니다.
   - MS Forms 응답 엑셀
   - 첨부 파일이 내려받아지는 OneDrive 폴더

맥에서 처음 실행할 때 macOS가 권한을 물으면 **허용**합니다.

- 터미널이 Word·PowerPoint·Excel을 제어 (시스템 설정 > 개인정보 보호 및 보안 > 자동화)
- 화면 기록 (같은 곳의 '화면 기록'. 허용한 뒤 터미널을 다시 실행)
- 터미널이 Microsoft Edge를 제어 (보호 PDF를 Edge로 열 때. 같은 '자동화' 화면)
- 손쉬운 사용 (보호 PDF를 Edge에서 '다른 이름으로 저장'할 때, Edge가 없어 Acrobat Reader로 넘길 때. 같은 곳의 '손쉬운 사용'에서 터미널을 허용)

설정을 마치면 왼쪽 메뉴의 **운영 맥 점검**을 누릅니다. 권한과 Edge·Word·PowerPoint·Excel을 시험 문서로 실제로 읽어 보고, 안 되는 곳과 고칠 곳, 실제로 읽힌 첫 쪽 그림을 보여 줍니다(1~3분, 그동안 앱이 잠깐 열렸다 닫힘).

## 3. 쓰는 방법

| 할 일 | 방법 |
| --- | --- |
| 새 아이디어 보기 | 자동으로 목록에 들어옵니다. 바로 보려면 **지금 가져오기** |
| 내용 확인 | 작품을 눌러 **캡처 자료 → 내용 요약 → 사실·논리 점검** 순서로 봅니다 |
| 캡처가 이상할 때 | 캡처를 눌러 크게 본 뒤 **이 쪽 다시 캡처** 또는 **캡처 삭제** |
| 자동으로 못 읽은 첨부 | 캡처 자료의 **파일 선택**(캡처가 있으면 **파일 더 올리기**)으로 그림이나 문서를 직접 올립니다 |
| 자료를 처음부터 다시 | 캡처 자료 아래 **캡처 모두 지우고 새로 올리기**를 누른 뒤 새 파일을 올립니다 |
| 채점 | **채점표**에서 점수와 결정을 적고 확정합니다 |

AI 비용은 목록 위에 **오늘 · 최근 7일**로 늘 보입니다. 아이디어 하나에 3센트쯤 듭니다.
왼쪽 메뉴 위의 숫자는 앱 빌드 번호입니다. 문제가 생기면 이 번호를 같이 알려 주세요.

## 4. 준비물

| 무엇 | 설명 |
| --- | --- |
| Node.js 22.21 이상 | 없으면 실행할 때 설치합니다 |
| 인터넷 | 처음 설치와 AI 요약에 필요합니다. 회사 프록시는 `HTTPS_PROXY`로 넘깁니다 |
| AI 키 | Anthropic API 키 또는 회사 LiteLLM 주소와 키 |
| Microsoft Office | 회사 계정으로 로그인된 Word·PowerPoint·Excel. 보호(MIP) 문서와 보호된 응답 엑셀을 여는 데 씁니다. 맥은 창을 캡처하고(Word는 쪽만 잘라 냄), 윈도우는 창 없이 열어 PDF로 내보냅니다 |
| Microsoft Edge (윈도우) | 보호(MIP) PDF와 보호된 Office 첨부를 읽는 데 씁니다. 이 앱 전용 Edge 프로필을 창 없이 열어 쪽마다 캡처합니다. 처음 한 번 `deploy/edge-login.bat`을 실행해 그 창에서 회사 계정으로 로그인하고 창을 닫습니다 |
| Microsoft Edge (맥) | 회사 계정으로 로그인. 보호(MIP) PDF를 새 창에 열어 '다른 이름으로 저장'한 사본을 읽고(사본은 읽자마자 지움), 저장이 안 되면 그 창을 캡처해 탭·주소창을 잘라 냅니다(Edge가 없으면 Adobe Acrobat Reader). 그동안 새 Edge 창이 잠깐 앞으로 나왔다 닫히고, 저장할 때 클립보드를 잠깐 씁니다(끝나면 되돌림). 문서 권한이 저장·캡처를 막으면 읽지 못합니다 |
| OneDrive | 응답 엑셀과 첨부 폴더가 이 PC에 동기화되어 있어야 합니다 |

글자 읽기(OCR) 엔진과 한국어 모델은 저장소에 들어 있어 따로 받을 것이 없습니다.

## 5. 맥과 윈도우 차이

| 기능 | 맥 | 윈도우 |
| --- | --- | --- |
| 그림 올리기 · 글자 읽기 · AI 요약·점검 · 채점표 | ○ | ○ |
| 첨부 문서 자동 캡처 (PDF·Word·PowerPoint·Excel, 보호 문서는 Edge) | ○ 앱 창을 캡처 | ○ 앱을 창 없이 열어 PDF로, 보호 문서는 창 없는 Edge |
| 보호(MIP)된 응답 엑셀 읽기·고치기 | ○ | ○ Excel을 창 없이 |
| 운영 맥 점검 | ○ | ✕ |

윈도우는 자동 점검(GitHub Actions)에서 `start.bat` 실행, 글자 읽기, 회귀 점검, PDF 쪽 그림, 전용 Edge 프로필 캡처까지 확인합니다. Office는 점검 PC에 없어 스크립트 문법만 확인하므로, 회사 PC에서 처음 쓸 때 Word·PowerPoint·Excel·보호 PDF 첨부를 한 번씩 직접 확인해 주세요.

## 6. 자주 생기는 문제

| 증상 | 해결 |
| --- | --- |
| 첨부가 '동기화 기다리는 중' | Finder에서 OneDrive의 그 폴더를 우클릭해 **항상 이 기기에 유지** |
| Office 문서·보호 PDF를 못 읽음 | **운영 맥 점검**으로 어느 권한·앱이 막혔는지 확인. Office·Edge가 회사 계정으로 로그인됐는지 보고 **지금 가져오기** |
| 포트를 이미 쓰고 있다고 나옴 | 먼저 띄운 창을 끄고 다시 실행 |

데이터는 맥 `~/Library/Application Support/ContestReviewDesk/`, 윈도우 `%APPDATA%\\ContestReviewDesk\\`에 저장됩니다.

더 자세한 내용과 폴더 구조는 [docs/GUIDE.md](docs/GUIDE.md)에 있습니다. 고친 뒤에는 `npm test`, `npm run smoke`, `npm run ui-check`로 점검합니다.

저작권은 realmi-lab에 있습니다([LICENSE](LICENSE)). 함께 쓰는 오픈소스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
