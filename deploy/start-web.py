"""웹 모드 시작: 내부 HTTPS 인증서를 준비하고 서버를 맥 서비스(LaunchAgent)로 띄운다.

다른 PC에서 웹 주소로 열 때만 쓴다. 이 컴퓨터에서만 쓸 때는 ./start.sh(localhost)로 충분하다.
설정은 deploy/site.json의 network에서 읽는다(예시: deploy/site.example.json, 설명: deploy/README.md).
"""

import json
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

os.umask(0o077)
home = Path.home()
project = Path(__file__).resolve().parents[1]
runtime = home / "Library/Application Support/ContestReviewWeb"
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
# 망마다 다른 주소는 deploy/site.json의 network에서 읽는다(예시: deploy/site.example.json).
site = project / "deploy/site.json"
network = json.loads(site.read_text("utf-8")).get("network", {}) if site.exists() else {}
if not network.get("publicHost") or not network.get("listenAddress"):
    raise SystemExit("deploy/site.json의 network에 publicHost(웹 주소)와 listenAddress(이 서버 IP)를 적으세요.")
host = network["publicHost"]
address = network["listenAddress"]
port = str(network.get("port", 20883))
label = network.get("serviceLabel", "contest-review.web")  # 맥 서비스 이름


def prepare_certificate():
    cert, key = runtime / "backend.crt", runtime / "backend.key"
    if cert.exists() and key.exists():
        subprocess.run([shutil.which("openssl") or "/usr/bin/openssl", "x509", "-in", str(cert), "-checkend", "86400",
                        "-noout"], check=True, stdout=subprocess.DEVNULL)
        return
    if cert.exists() or key.exists():
        raise SystemExit("내부 TLS 인증서와 키 중 하나가 없습니다.")
    subprocess.run([shutil.which("openssl") or "/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes",
                    "-days", "365", "-subj", f"/CN={host}",
                    "-addext", f"subjectAltName=DNS:{host},IP:{address}",
                    "-keyout", str(key), "-out", str(cert)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def node_path():
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js 실행 파일을 찾지 못했습니다.")
    return node


def service_env():
    # nvm으로 받은 Node를 쓸 때도 서버가 같은 Node를 찾도록 그 폴더를 PATH 맨 앞에 둔다.
    env = {"REVIEW_WEB_MODE": "1", "REVIEW_PORT": port, "HOME": str(home),
           "PATH": os.path.dirname(node_path()) + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"}
    # 회사망 프록시: 이 스크립트를 실행한 터미널의 HTTPS_PROXY·NO_PROXY를 서버에 넘기고 Node가 따르게 한다.
    proxy = {k: os.environ[k] for k in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY") if os.environ.get(k)}
    if proxy:
        env.update(proxy, NODE_USE_ENV_PROXY="1")
    return env


def start():
    node = node_path()
    env = service_env()
    config = {
        "Label": label,
        "ProgramArguments": [node, "--use-system-ca", str(project / "server.mjs")],  # 키체인의 인증서도 믿는다(start.sh와 같다)
        "WorkingDirectory": str(project),
        "EnvironmentVariables": env,
        "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 15,
        "StandardOutPath": str(runtime / "web.log"),
        "StandardErrorPath": str(runtime / "web-error.log"),
    }
    folder = home / "Library/LaunchAgents"
    folder.mkdir(parents=True, exist_ok=True)
    agent = folder / (label + ".plist")
    with agent.open("wb") as stream:
        plistlib.dump(config, stream)
    domain = f"gui/{os.getuid()}"
    target = f"{domain}/{label}"
    if subprocess.run(["launchctl", "print", target], capture_output=True).returncode == 0:
        subprocess.run(["launchctl", "kickstart", "-k", target], check=True)
    else:
        subprocess.run(["launchctl", "bootstrap", domain, str(agent)], check=True)


if __name__ == "__main__":
    prepare_certificate()
    start()
    print(f"심사 웹앱을 시작했습니다. https://{host}/ 에서 열 수 있습니다.")
