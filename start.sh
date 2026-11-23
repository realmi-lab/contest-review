#!/usr/bin/env bash
# 운영망 실행. Node 준비 → 패키지 설치 → 서버 실행을 한 번에 하고, 그 터미널에서 돈다(끄려면 Ctrl+C).
#   ./start.sh            = ./start.sh --localhost
#   ./start.sh --localhost  이 PC에서만 http://localhost:18765
#   ./start.sh --server     다른 PC에서 https://<이 PC IP>:20883 (처음엔 브라우저가 인증서 경고를 보여 준다)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 두 방식이 같은 데이터(작품·요약·설정)를 쓴다.
export REVIEW_DATA_DIR="${REVIEW_DATA_DIR:-$HOME/Library/Application Support/ContestReviewDesk}"
mode="${1:---localhost}"
case "$mode" in
  --localhost | --server) ;;
  *) echo "사용법: ./start.sh [--localhost | --server]"; exit 1 ;;
esac

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
    command -v curl >/dev/null || { echo "curl을 설치하세요."; exit 1; }
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

# 패키지: 처음이거나 package-lock.json이 바뀌었으면 설치한다.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --omit=dev
  touch node_modules
fi

# 먼저 띄운 이 앱이 남아 있으면 끄고 다시 띄운다. 예전 ./start.sh가 등록한 맥 서비스(LaunchAgent)도 내린다.
# (QA망 맥의 웹 서비스도 같은 이름이라, QA망 맥에서 이 스크립트를 돌리면 그 서비스가 내려간다. 되살리기: python3 deploy/start-nas.py)
label="net.realmi.contest-review.web"
if [ "$(uname)" = Darwin ] && launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "예전에 등록된 맥 서비스($label)를 내립니다."
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
fi
for port in 18765 20883; do
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null); do
    if [ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$PWD" ]; then
      echo "먼저 띄운 서버(포트 $port)를 끄고 다시 띄웁니다."
      kill "$pid"
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    fi
  done
done

if [ "$mode" = --server ]; then
  for tool in python3 openssl; do command -v $tool >/dev/null || { echo "$tool을 설치하세요."; exit 1; }; done
  # deploy/site.json에 network가 없으면 이 PC의 IP로 바로 여는 값을 넣는다(앞단 프록시를 두면 고친다).
  node -e '
    const fs = require("fs"), file = "deploy/site.json";
    const site = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    if (!site.network) {
      const ip = Object.values(require("os").networkInterfaces()).flat().find((n) => n.family === "IPv4" && !n.internal)?.address ?? "127.0.0.1";
      site.network = { publicHost: ip, listenAddress: ip, port: 20883, proxyAddresses: [] };
      fs.writeFileSync(file, JSON.stringify(site, null, 2) + "\n");
    }'
  exec python3 deploy/start-nas.py --foreground # 회사 프록시(HTTPS_PROXY)는 서버에 넘긴다
fi

# 회사 프록시(HTTPS_PROXY)가 있으면 AI 요청도 그 프록시로 보낸다.
if [ -n "${HTTPS_PROXY:-}" ]; then export NODE_USE_ENV_PROXY=1; fi
echo "아이디어정리를 실행합니다: http://localhost:18765 (끄려면 Ctrl+C)"
exec node server.mjs
