# 배포

## 운영 서버

프로젝트 루트에서 `./start.sh`를 실행한다. 망마다 다른 값은 `deploy/site.json` 하나에 둔다(예시: `site.example.json`, 깃에는 올리지 않는다).

| 키 | 내용 |
| --- | --- |
| `network.publicHost` | 사용자가 여는 웹 주소(예: `contest.company.com`) |
| `network.listenAddress` | 이 서버의 내부 IP. 서버는 이 주소에서 HTTPS로 받는다 |
| `network.port` | 받는 포트(기본 20883) |
| `network.proxyAddresses` | 이 서버로 전달하는 앞단 역방향 프록시 IP. 이 주소와 서버 자신만 접속할 수 있다. 비우면 프록시 없이 브라우저가 `https://<publicHost>:<port>`로 바로 연다(`./start.sh`가 처음 만드는 값) |
| `forms` | MS Forms 공모 연동. 웹앱의 '공모 연동 설정'에서 응답 엑셀과 첨부 폴더를 고르면 채워진다 |

- 앞단 역방향 프록시가 `https://<publicHost>:443`을 `https://<listenAddress>:<port>`로 넘기고, 원래 Host 헤더를 그대로 전달해야 한다. 바깥에 보일 인증서는 앞단에 둔다.
- 서버와 앞단 사이의 내부 인증서(`backend.crt`)는 `./start.sh`가 처음 실행할 때 만들고, 데이터·로그와 함께 `~/Library/Application Support/ContestReviewWeb/`에 둔다.
- 맥에서는 로그인하면 켜지는 서비스(LaunchAgent)로 돈다. 코드를 바꾼 뒤 `./start.sh`를 다시 실행하거나 `서버 재시작.command`를 실행한다.
- AI 키와 회사 LiteLLM 연결 주소는 웹앱의 요약 설정에서 넣는다.
- Node가 22.21보다 낮으면 `./start.sh`가 nvm(`~/.nvm`)으로 이 앱만 Node 22를 쓴다.

## 접속 코드(선택)

`접속 코드 변경.command`(또는 `node deploy/access-code.mjs`)로 웹 접속 코드를 만들면 그 코드를 입력한 브라우저만 쓴다. `deploy/web-access.json`을 지우면 접속 보호가 꺼진다.
