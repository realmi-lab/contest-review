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
# 서버의 Node가 낮으면 nvm(없으면 설치)으로 이 앱만 .nvmrc의 Node 22를 쓴다.
# 서버의 기본 Node와 셸 설정 파일(.zshrc 등)은 건드리지 않는다.
node_ok() {
  command -v node >/dev/null &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 21) ? 0 : 1)'
}
if ! node_ok; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    need curl "curl을 설치하세요."
    echo "Node.js $(node -v 2>/dev/null || echo '없음') → nvm을 설치해 이 앱만 Node 22를 씁니다 ($NVM_DIR)."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | PROFILE=/dev/null bash >/dev/null
  fi
  set +u # nvm 스크립트는 정의되지 않은 변수를 쓴다
  . "$NVM_DIR/nvm.sh"
  nvm install >/dev/null # 처음 한 번 받고, 이미 있으면 그대로 쓴다
  nvm use >/dev/null
  set -u
fi
node_ok || { echo "Node.js 22를 준비하지 못했습니다. 이 서버가 nodejs.org·GitHub에 접속할 수 있는지(회사 프록시는 HTTPS_PROXY) 확인하세요."; exit 1; }

# 패키지: 처음이거나 package-lock.json이 바뀌었으면 설치한다(회사 프록시는 HTTPS_PROXY로 넘긴다).
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --omit=dev
  touch node_modules
fi

# 처음이면 이 서버의 IP로 바로 여는 설정을 만든다(앞단 역방향 프록시를 두면 deploy/site.json의 network를 고친다).
if [ ! -f deploy/site.json ]; then
  node -e '
    const ip = Object.values(require("os").networkInterfaces()).flat().find((n) => n.family === "IPv4" && !n.internal)?.address ?? "127.0.0.1";
    require("fs").writeFileSync("deploy/site.json", JSON.stringify({ network: { publicHost: ip, listenAddress: ip, port: 20883, proxyAddresses: [] } }, null, 2) + "\n");
    console.log("deploy/site.json을 만들었습니다. https://" + ip + ":20883 에서 엽니다(처음엔 브라우저가 인증서 경고를 보여 줍니다).");'
fi

if [ "$(uname)" = Darwin ] && [ "${1:-}" != --foreground ]; then
  exec python3 deploy/start-nas.py
fi
exec python3 deploy/start-nas.py --foreground
