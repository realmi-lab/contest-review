@echo off
rem 아이디어정리 실행 (Windows): start.bat 을 더블클릭하거나 명령 프롬프트에서 실행 → http://localhost:18765
rem Node 확인 → 패키지 설치 → 서버 실행을 한 번에 한다. 이 창에서 서버가 돌고, 끄려면 Ctrl+C 또는 창을 닫는다.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Node.js 22.21 이상(내장 SQLite를 쓴다). 없거나 낮으면 winget으로 LTS를 설치한다.
where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=21)?0:1)"
if errorlevel 1 goto install_node

rem 패키지: 처음 한 번 설치한다(package-lock.json이 바뀌면 node_modules 폴더를 지우고 다시 실행).
if not exist node_modules (
  call npm ci --omit=dev
  if errorlevel 1 goto failed
)

if defined HTTPS_PROXY set NODE_USE_ENV_PROXY=1
echo 아이디어정리를 실행합니다: http://localhost:18765 (끄려면 Ctrl+C)
start "" http://localhost:18765
rem --use-system-ca: Windows 인증서 저장소의 회사 인증서도 믿는다(회사망에서 Slack·AI 연결이 'fetch failed'로 끊기지 않게)
node --use-system-ca server.mjs
goto end

:install_node
echo Node.js 22.21 이상이 필요합니다. winget으로 Node.js LTS를 설치합니다.
where winget >nul 2>nul
if errorlevel 1 (
  echo winget이 없습니다. https://nodejs.org 에서 Node.js LTS를 설치한 뒤 start.bat 을 다시 실행하세요.
  goto failed
)
winget install -e --id OpenJS.NodeJS.LTS
echo 설치가 끝났으면 이 창을 닫고 start.bat 을 다시 실행하세요.
goto failed

:failed
pause
exit /b 1

:end
endlocal
