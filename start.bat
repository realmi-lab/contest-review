@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0" || exit /b 1

call :check_node
if not errorlevel 1 goto packages
echo Node.js 22.21 이상이 필요합니다. winget으로 Node.js LTS를 설치합니다.
where winget >nul 2>nul
if errorlevel 1 (
  echo https://nodejs.org 에서 Node.js LTS를 설치한 뒤 다시 실행하세요.
  goto failed
)
winget install -e --id OpenJS.NodeJS.LTS
if errorlevel 1 goto failed
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :check_node
if errorlevel 1 (
  echo 새 명령 프롬프트에서 node -v 를 확인한 뒤 start.bat 을 다시 실행하세요.
  goto failed
)

:packages
rem npm이 설치를 마치면 만든 잠금 파일과 저장소 잠금 파일의 시각을 비교한다.
node -e "const fs=require('node:fs');const installed=fs.statSync('node_modules/.package-lock.json',{throwIfNoEntry:false});process.exit(installed && installed.mtimeMs>=fs.statSync('package-lock.json').mtimeMs ? 0 : 1)"
if errorlevel 1 (
  call npm ci --omit=dev
  if errorlevel 1 goto failed
)

if defined HTTPS_PROXY set "NODE_USE_ENV_PROXY=1"
echo 아이디어정리를 실행합니다. 종료하려면 Ctrl+C를 누르세요.
node --use-system-ca server.mjs --open-browser
if errorlevel 1 goto failed
popd
exit /b 0

:check_node
where node >nul 2>nul || exit /b 1
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 || (a===22 && b>=21) ? 0 : 1)"
exit /b %errorlevel%

:failed
if not defined CI pause
popd
exit /b 1
