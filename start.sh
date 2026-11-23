#!/usr/bin/env bash
# 운영 서버 실행: ./start.sh
#   맥: 로그인하면 자동으로 켜지고 꺼지면 다시 켜지는 서비스(LaunchAgent)로 시작한다. 다시 실행하면 재시작한다.
#   맥이 아니거나 ./start.sh --foreground: 이 터미널에서 바로 실행한다(Ctrl+C로 끔).
# 망마다 다른 값(웹 주소·이 서버 IP·포트·앞단 프록시·MS Forms 연동)은 deploy/site.json 하나에 둔다.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

need() { command -v "$1" >/dev/null || { echo "$2"; exit 1; }; }
need python3 "python3를 설치하세요."
need openssl "openssl을 설치하세요."

# Node.js 22.21 이상(내장 SQLite와 회사 프록시 NODE_USE_ENV_PROXY를 플래그 없이 쓴다).
# 서버의 Node가 낮으면 nvm으로 이 앱만 .nvmrc의 Node 22를 쓴다. 서버의 기본 Node는 그대로 둔다.
node_ok() {
  command -v node >/dev/null &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 21) ? 0 : 1)'
}
if ! node_ok && [ -s "${NVM_DIR:=$HOME/.nvm}/nvm.sh" ]; then
  set +u # nvm 스크립트는 정의되지 않은 변수를 쓴다
  . "$NVM_DIR/nvm.sh"
  nvm install >/dev/null # 처음 한 번 받고, 이미 있으면 그대로 쓴다
  nvm use >/dev/null
  set -u
fi
node_ok || {
  echo "Node.js 22.21 이상이 필요합니다 (지금 $(node -v 2>/dev/null || echo '없음'))."
  echo "nvm을 설치하고 다시 실행하면 이 앱만 Node 22를 씁니다: https://github.com/nvm-sh/nvm#installing-and-updating"
  exit 1
}

# OCR 엔진 패키지는 비공개라 깃에 없다. 운영 서버의 vendor/에 따로 넣는다.
[ -f vendor/kordoc.tgz ] || { echo "vendor/kordoc.tgz(OCR 엔진 패키지)를 vendor 폴더에 넣은 뒤 다시 실행하세요."; exit 1; }

# 패키지: 처음이거나 package-lock.json이 바뀌었으면 설치한다(회사 프록시는 HTTPS_PROXY로 넘긴다).
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --omit=dev
  touch node_modules
fi

if [ ! -f deploy/site.json ]; then
  cp deploy/site.example.json deploy/site.json
  echo "deploy/site.json을 만들었습니다. network(웹 주소·이 서버 IP·포트·앞단 프록시 IP)를 운영망 값으로 고친 뒤 ./start.sh를 다시 실행하세요."
  exit 1
fi

if [ "$(uname)" = Darwin ] && [ "${1:-}" != --foreground ]; then
  exec python3 deploy/start-nas.py
fi
exec python3 deploy/start-nas.py --foreground
