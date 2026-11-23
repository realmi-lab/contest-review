#!/bin/zsh
# 웹 모드 서비스를 다시 시작합니다(코드를 바꾼 뒤 반영할 때).
# 서비스 이름은 deploy/site.json의 network.serviceLabel(없으면 contest-review.web)입니다.
cd "${0:A:h}"
label=$(plutil -extract network.serviceLabel raw -o - site.json 2>/dev/null) || label=contest-review.web
if launchctl kickstart -k "gui/$(id -u)/$label"; then
  print "웹 서비스($label)를 다시 시작했습니다."
else
  print "서비스($label)를 찾지 못했습니다. 프로젝트 폴더에서 python3 deploy/start-web.py 를 실행하세요."
fi
sleep 3
