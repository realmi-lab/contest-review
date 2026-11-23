@echo off
rem 보호(MIP) PDF를 읽을 때 쓰는 '이 앱 전용 Edge 프로필'을 연다(Windows). 처음 한 번 회사 계정으로 로그인해 둔다.
rem 열린 Edge 창 오른쪽 위 프로필 단추로 회사 계정에 로그인하고, 보호 PDF 하나를 끌어다 놓아 열리는지 본 뒤 창을 닫는다.
rem 이 창이 열려 있는 동안에는 앱이 보호 PDF를 읽지 못한다.
chcp 65001 >nul
set "PROFILE=%APPDATA%\ContestReviewDesk\edge-profile"
if defined REVIEW_EDGE_PROFILE set "PROFILE=%REVIEW_EDGE_PROFILE%"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" goto no_edge
start "" "%EDGE%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check https://www.office.com
exit /b 0

:no_edge
echo 이 PC에 Microsoft Edge가 없습니다.
pause
exit /b 1
