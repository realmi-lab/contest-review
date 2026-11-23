#!/bin/zsh
set -eu
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export OLLAMA_HOST=127.0.0.1:11548 OLLAMA_NO_CLOUD=1 OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1
url=http://127.0.0.1:18765
if ! command -v node >/dev/null || ! command -v ollama >/dev/null; then
  print 'Node.js 24 이상과 Ollama가 필요합니다.'; read '?Enter 키로 닫기 '; exit 1
fi
if ! curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:11548/api/version >/dev/null 2>&1; then
  logdir="$HOME/Library/Application Support/ContestReviewDesk"
  mkdir -p -m 700 "$logdir"
  OLLAMA_DEBUG=0 nohup ollama serve >"$logdir/ollama.log" 2>&1 </dev/null &
  for i in {1..40}; do curl --noproxy '*' -fsS --max-time 1 http://127.0.0.1:11548/api/version >/dev/null 2>&1 && break; sleep .25; done
fi
if curl --noproxy '*' -fsS --max-time 3 "$url/api/state" 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.exit(JSON.parse(s).app==="contest-review-desk"?0:1)}catch{process.exit(1)}})'; then
  open "$url"
else
  (for i in {1..60}; do if curl --noproxy '*' -fsS --max-time 1 "$url/api/state" >/dev/null 2>&1; then open "$url"; break; fi; sleep .4; done) &
  exec node server.mjs
fi
