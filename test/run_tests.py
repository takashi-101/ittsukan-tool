"""テストをコマンドから走らせる。

このフォルダをローカルで配信し、Google Chrome（または Microsoft Edge）を画面なしで起動して
test/index.html を開き、結果（PASS/FAIL）を表示する。外部には通信しない。

    python test/run_tests.py            画面のテスト（JavaScript）
    python test/run_tests.py --shots    画面写真も撮る（375px と 1280px、ライト／ダーク。test/screenshots/）

MCPサーバーのテストは mcp/test_client.py、配った複製の確認は tools/sync_common.py --check。
"""
import functools
import http.server
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = ROOT / "test" / "screenshots"
DOC_IMG_DIR = ROOT / "docs" / "images"

BROWSER_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


def find_browser():
    for name in ("google-chrome", "chromium", "chrome", "msedge"):
        p = shutil.which(name)
        if p:
            return p
    for p in BROWSER_CANDIDATES:
        if os.path.exists(p):
            return p
    sys.exit("Chrome または Edge が見つかりません。")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


def headless(browser, args, profile):
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--user-data-dir=" + profile] + args
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240)


def run_tests(browser, base, profile):
    r = headless(browser, ["--virtual-time-budget=120000", "--window-size=1400,900", "--dump-dom", base + "/test/index.html"], profile)
    dom = r.stdout
    m = re.search(r"<title>(.*?)</title>", dom)
    title = m.group(1) if m else "(結果を読めませんでした)"
    print("結果:", title)
    for li in re.findall(r'<li class="(pass|fail)">(.*?)(?:<pre>(.*?)</pre>)?</li>', dom, re.S):
        print(("  OK " if li[0] == "pass" else "  NG ") + re.sub(r"<[^>]+>", "", li[1]))
        if li[2]:
            for line in li[2].strip().splitlines()[:4]:
                print("       " + line)
    return title.startswith("PASS")


SHOTS = [
    # (ファイル名, 幅, 高さ, 開く画面, ダーク)
    ("home-1280.png", 1280, 1300, "index.html", False),
    ("home-375-dark.png", 375, 1800, "index.html", True),
    ("shosai-1280.png", 1280, 1500, "stages/03-shosai-sekkei/index.html", False),
    ("shosai-375.png", 375, 2200, "stages/03-shosai-sekkei/index.html", False),
    ("shosai-375-dark.png", 375, 2200, "stages/03-shosai-sekkei/index.html", True),
    ("test-1280-dark.png", 1280, 1500, "stages/05-test/index.html", True),
    ("yoken-375.png", 375, 1800, "stages/01-yoken/index.html", False),
]


def take_shots(browser, base, profile):
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    DOC_IMG_DIR.mkdir(parents=True, exist_ok=True)
    for name, width, height, page, dark in SHOTS:
        out = SHOT_DIR / name
        args = ["--virtual-time-budget=5000", "--window-size=%d,%d" % (width, height), "--screenshot=" + str(out)]
        if dark:
            args += ["--force-dark-mode", "--blink-settings=preferredColorScheme=0"]
        headless(browser, args + ["%s/test/shot.html?w=%d&page=%s" % (base, width, page)], profile)
        print(("  撮影 " if out.exists() else "  失敗 ") + str(out.relative_to(ROOT)))
    for src, dst in (("home-1280.png", "screen-home.png"), ("shosai-375.png", "screen-sp.png"), ("shosai-1280.png", "screen-pc.png")):
        if (SHOT_DIR / src).exists():
            shutil.copyfile(SHOT_DIR / src, DOC_IMG_DIR / dst)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    browser = find_browser()
    httpd, base = start_server()
    profile = tempfile.mkdtemp(prefix="ittsukan-test-")
    try:
        passed = run_tests(browser, base, profile)
        if "--shots" in sys.argv:
            take_shots(browser, base, profile)
    finally:
        httpd.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
