#!/bin/zsh
# ai.realmi.net 심사 웹앱 서비스를 다시 시작합니다 (server.mjs 변경을 반영할 때 사용).
label="net.realmi.contest-review.web"
if launchctl kickstart -k "gui/$(id -u)/$label"; then
  print "심사 웹앱 서비스를 다시 시작했습니다."
else
  print "서비스를 찾지 못했습니다. 프로젝트 폴더에서 python3 deploy/start-nas.py 를 실행하세요."
fi
sleep 3
