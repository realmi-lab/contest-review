#!/usr/bin/env bash
# 아이디어정리 실행: ./start.sh → http://localhost:18765 (이 터미널에서 돌고, 끄려면 Ctrl+C)
# Node 준비 → 패키지 설치 → 서버 실행을 한 번에 한다.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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

# 먼저 띄운 이 앱이 남아 있으면 끄고 다시 띄운다. 이 폴더의 server.mjs를 띄우는 맥 서비스(LaunchAgent)도 내린다
# (예전 ./start.sh나 웹 모드 deploy/start-web.py가 등록한 것. 웹 모드로 되살리기: python3 deploy/start-web.py).
if [ "$(uname)" = Darwin ]; then
  for plist in "$HOME"/Library/LaunchAgents/*.plist; do
    [ -f "$plist" ] && grep -qF "$PWD/server.mjs" "$plist" || continue
    label=$(basename "$plist" .plist)
    echo "이 앱을 띄우던 맥 서비스($label)를 내립니다."
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$plist"
  done
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

# 회사 프록시(HTTPS_PROXY)가 있으면 AI 요청도 그 프록시로 보낸다.
if [ -n "${HTTPS_PROXY:-}" ]; then export NODE_USE_ENV_PROXY=1; fi
echo "아이디어정리를 실행합니다: http://localhost:18765 (끄려면 Ctrl+C)"
# 맥: 시스템·로그인 키체인의 인증서(회사가 넣은 보안 장비 인증서 포함)를 꺼내 Node가 더 믿을 인증서로 준다.
# --use-system-ca만으로 안 되는 회사 맥(UNABLE_TO_GET_ISSUER_CERT_LOCALLY)을 위해서다. 켤 때마다 새로 꺼낸다.
if [ "$(uname)" = Darwin ]; then
  CA="$HOME/.idea_review-ca.pem"
  security find-certificate -a -p /Library/Keychains/System.keychain "$HOME/Library/Keychains/login.keychain-db" >"$CA" 2>/dev/null &&
    [ -s "$CA" ] && export NODE_EXTRA_CA_CERTS="$CA"
fi
# --use-system-ca: 이 컴퓨터(키체인·인증서 저장소)에 등록된 인증서도 믿는다. 회사 보안 장비가 HTTPS 인증서를 바꿔 끼우는 망에서
# 브라우저·curl은 되는데 서버만 Slack·AI에 'fetch failed'가 나는 것을 막는다.
exec node --use-system-ca server.mjs
