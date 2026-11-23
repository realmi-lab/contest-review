# 배포

## 이 컴퓨터에서만 쓸 때

프로젝트 폴더에서 `./start.sh`(윈도우는 `start.bat`)를 실행하고 `http://localhost:18765`를 엽니다(README의 '실행하기'). 이 문서는 다른 PC에서 웹 주소로 여는 **웹 모드**만 다룹니다.

## 웹 모드(맥)

`deploy/site.json`에 `network`를 적고(예시: `site.example.json`, 깃에는 올리지 않습니다) `python3 deploy/start-web.py`를 실행합니다.

| 키 | 내용 |
| --- | --- |
| `network.publicHost` | 사용자가 여는 웹 주소(예: `contest.company.com`) |
| `network.listenAddress` | 이 서버의 내부 IP. 서버는 이 주소에서 HTTPS로 받습니다 |
| `network.port` | 받는 포트(기본 20883) |
| `network.proxyAddresses` | 이 서버로 전달하는 앞단 역방향 프록시 IP. 이 주소와 서버 자신만 접속할 수 있습니다 |
| `network.serviceLabel` | 맥 서비스(LaunchAgent) 이름(기본 `contest-review.web`) |
| `forms` | MS Forms 공모 연동. 웹앱의 '공모 연동 설정'에서 응답 엑셀과 첨부 폴더를 고르면 채워집니다 |

- 앞단 역방향 프록시가 `https://<publicHost>:443`을 `https://<listenAddress>:<port>`로 넘기고, 원래 Host 헤더를 그대로 전달해야 합니다. 바깥에 보일 인증서는 앞단에 둡니다.
- 서버와 앞단 사이의 내부 인증서(`backend.crt`)는 `start-web.py`가 처음 실행할 때 만들고, 데이터·로그와 함께 `~/Library/Application Support/ContestReviewWeb/`에 둡니다.
- 서버는 로그인하면 켜지는 맥 서비스로 돕니다. 코드를 바꾼 뒤에는 `restart-web.command`를 실행합니다.
- AI 키와 회사 LiteLLM 연결 주소는 웹앱의 요약 설정에서 넣습니다.
- 회사 프록시가 필요하면 `HTTPS_PROXY`(필요하면 `NO_PROXY`)를 설정한 터미널에서 `start-web.py`를 실행합니다. 서비스에 함께 들어갑니다.

## 접속 코드(선택)

`change-access-code.command`(또는 `node deploy/access-code.mjs`)로 웹 접속 코드를 만들면 그 코드를 입력한 브라우저만 씁니다. `deploy/web-access.json`을 지우면 접속 보호가 꺼집니다.
