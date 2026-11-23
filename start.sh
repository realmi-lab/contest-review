#!/usr/bin/env bash
# 운영망 실행: ./start.sh → http://localhost:18765 (이 터미널에서 실행, 끄려면 Ctrl+C)
# Node 준비 → 패키지 설치 → 서버 실행을 한 번에 한다. 데이터는 ~/Library/Application Support/ContestReviewDesk/에 쌓인다.
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

# 회사 프록시(HTTPS_PROXY)가 있으면 AI 요청도 그 프록시로 보낸다.
if [ -n "${HTTPS_PROXY:-}" ]; then export NODE_USE_ENV_PROXY=1; fi
echo "아이디어정리를 실행합니다: http://localhost:18765 (끄려면 Ctrl+C)"
exec node server.mjs
