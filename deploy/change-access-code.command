#!/bin/zsh
# 웹 접속 코드를 새로 만들고 웹 서비스를 다시 시작합니다.
# 이전 코드로 들어온 브라우저는 새 코드를 다시 입력해야 합니다.
# 접속 보호를 끄려면 이 폴더의 web-access.json을 지우고 restart-web.command를 실행하세요.
set -eu
cd "${0:A:h}"
label=$(plutil -extract network.serviceLabel raw -o - site.json 2>/dev/null) || label=contest-review.web
code=$(node access-code.mjs)
launchctl kickstart -k "gui/$(id -u)/$label" || true
print "새 접속 코드: $code"
print "심사자에게 이 코드를 전달하세요."
read -k 1 '?아무 키나 누르면 창을 닫습니다.'
