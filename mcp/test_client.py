"""MCPサーバー（ittsukan_mcp.py）の動作確認。Pythonの標準機能だけで動く。

    python mcp/test_client.py
        サーバーを起動し、MCPのやり取り（初期化・道具の一覧・7つの道具・区切り・誤りの扱い・記録）を確かめる。
        一時フォルダの案件だけを使い、リポジトリの cases/ には触らない。

    python mcp/test_client.py --lmstudio qwen3.5-4b [ほかのモデル名 ...]
        上に加えて、このPCの LM Studio（http://localhost:1234/v1）のモデルに、道具を使う課題を解かせる。
        このスクリプトがAIアプリの代わりになり、モデルが選んだ道具をMCPサーバーで実行して結果を返す。
        結果と使ったモデル名を mcp/model-check.md に書き足す。
        事前に LM Studio のサーバーを起動しておく（lms server start）。外部には通信しない（localhost だけ）。
"""
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ittsukan_core as K  # noqa: E402

SERVER = HERE / "ittsukan_mcp.py"
MAX_CHARS = 1200
LMSTUDIO = os.environ.get("LMSTUDIO_URL", "http://localhost:1234/v1")


class Client:
    def __init__(self, cases, log):
        env = dict(os.environ, ITTSUKAN_CASES=str(cases), ITTSUKAN_LOG=str(log), PYTHONIOENCODING="utf-8")
        self.p = subprocess.Popen([sys.executable, "-I", str(SERVER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.n = 0

    def send(self, method, params=None, notify=False):
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notify:
            self.n += 1
            msg["id"] = self.n
        self.p.stdin.write((json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8"))
        self.p.stdin.flush()
        if notify:
            return None
        return json.loads(self.p.stdout.readline().decode("utf-8"))

    def call(self, name, **args):
        r = self.send("tools/call", {"name": name, "arguments": args})
        res = r["result"]
        return res["content"][0]["text"], res.get("isError", False)

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=10)


RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("  OK " if cond else "  NG ") + name + ("" if cond or not detail else "：" + str(detail)[:300]))


def protocol_tests():
    tmp = Path(tempfile.mkdtemp(prefix="ittsukan-mcp-"))
    cases, log = tmp / "cases", tmp / "access_log.jsonl"
    try:
        # 見本案件を置く
        env = dict(os.environ, ITTSUKAN_CASES=str(cases), PYTHONIOENCODING="utf-8")
        subprocess.run([sys.executable, "-I", str(SERVER), "--init-sample"], env=env, check=True, capture_output=True)
        check("見本案件を案件フォルダに置ける", (cases / "houkago-club" / "01-yoken.json").exists())

        c = Client(cases, log)
        r = c.send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test_client", "version": "1"}})
        check("初期化", r["result"]["serverInfo"]["name"] == "ittsukan-tool" and r["result"]["protocolVersion"] == "2025-06-18", r)
        r2 = c.send("initialize", {"protocolVersion": "1999-01-01"})
        check("知らない版を求められたら、対応する版を返す", r2["result"]["protocolVersion"] in ("2025-06-18", "2025-03-26", "2024-11-05"))
        check("通知（notifications/initialized）には返事をしない", c.send("notifications/initialized", {}, notify=True) is None)
        check("ping", c.send("ping")["result"] == {})
        names = [t["name"] for t in c.send("tools/list")["result"]["tools"]]
        check("道具は7つ", names == ["list_cases", "get_overview", "read_items", "get_guide", "write_items", "check_sheet", "record_mark"], names)
        check("知らない method は誤りを返す", "error" in c.send("resources/list"))

        outputs = []

        def call(name, **a):
            t, err = c.call(name, **a)
            outputs.append((name, t))
            return t, err

        t, _ = call("list_cases")
        check("list_cases：見本案件と7工程が出る", "houkago-club" in t and "7定着(8)" in t, t)

        t, _ = call("get_overview", case="houkago-club", stage="yoken")
        check("get_overview：欄ごとの件数と点検", "必要な機能（R）6件" in t and "要対応 0件" in t, t)

        # 区切って読む：cursor をたどって全件を読める
        seen, cursor, rounds = [], 0, 0
        while True:
            t, _ = call("read_items", case="houkago-club", stage="shosai", cursor=cursor)
            rounds += 1
            for line in t.split("\n"):
                if line[:2] in ("DP", "DT", "DV", "DA", "DR", "DE") and "［" in line:
                    seen.append(line.split("［")[0])
            if "cursor=" not in t:
                break
            cursor = int(t.split("cursor=")[1].split("。")[0])
            if rounds > 40:
                break
        check("read_items：cursor をたどると全件（33件）を読める", len(seen) == 33 and len(set(seen)) == 33, (len(seen), rounds))
        check("read_items：1回の返事は短く区切る（2回以上に分かれる）", rounds >= 2, rounds)
        t, _ = call("read_items", case="houkago-club", stage="shosai", item_id="DR-01")
        check("read_items：item_id で1件を全文で読み、架空の基準と分かる", "【架空の基準】" in t and "1年〜3年：3点を加える" in t, t)
        t, _ = call("read_items", case="houkago-club", stage="yoken", section="kino")
        check("read_items：section で欄を絞る", t.count("［必要な機能］") == 6 and "W-01" not in t, t)

        t, _ = call("get_guide", stage="kihon")
        check("get_guide：工程の手引き", "section=gamen" in t and "前の工程" in t, t)
        t, _ = call("get_guide", stage="yoken", section="kino")
        check("get_guide：欄の手引きと書き方の例", "priority" in t and "必須・できれば・今回は見送り" in t and "write_items" in t, t)

        # 点検：MCPの結果は ittsukan_core と同じ
        ok_all = True
        for st in K.STAGES:
            t, _ = call("check_sheet", case="houkago-club", stage=st["id"])
            if "要対応 0件" not in t and "気になる点は見つかりませんでした" not in t:
                ok_all = False
        check("check_sheet：見本案件は7工程とも要対応なし", ok_all)

        # 書く：新しい案件
        t, err = call("write_items", case="new-case", stage="yoken", case_name="試しの案件",
                      items=[{"section": "kino", "title": "Webで申し込める", "detail": "保護者がWebで申し込める", "priority": "必須"},
                             {"section": "open_questions", "text": "受付期間をいつにするか"}])
        check("write_items：番号を自動で振って保存する", not err and "R-01" in t and "Q-01" in t, t)
        p = cases / "new-case" / "01-yoken.json"
        sheet = json.loads(p.read_text(encoding="utf-8"))
        check("write_items：JSONとMarkdownを書き出す", sheet["case"]["name"] == "試しの案件" and (cases / "new-case" / "01-yoken.md").exists())
        norm, _ = K.normalize_sheet(sheet)
        check("write_items：Markdownは画面と同じ形", (cases / "new-case" / "01-yoken.md").read_text(encoding="utf-8") == K.to_markdown(norm))
        t, err = call("write_items", case="new-case", stage="yoken", items=[
            {"section": "kino", "title": "OK", "detail": "x", "priority": "必須"},
            {"section": "kino", "title": "NG", "detail": "x", "priority": "とても大事"}])
        sheet2 = json.loads(p.read_text(encoding="utf-8"))
        check("write_items：1件でも誤りがあれば何も書き込まない", "書き込みませんでした" in t and len(sheet2["items"]) == 1, t)
        t, err = call("write_items", case="new-case", stage="yoken", items=[{"id": "R-01", "detail": "保護者がスマートフォンで申し込める"}])
        sheet3 = json.loads(p.read_text(encoding="utf-8"))
        check("write_items：id を付けると、その項目を直す", "直した：R-01" in t and sheet3["items"][0]["detail"] == "保護者がスマートフォンで申し込める" and sheet3["items"][0]["title"] == "Webで申し込める", t)
        call("write_items", case="new-case", stage="yoken", delete=["R-01"])
        t, _ = call("write_items", case="new-case", stage="yoken", items=[{"section": "kino", "title": "次", "detail": "x", "priority": "必須"}])
        check("write_items：消した番号は使い直さない", "R-02" in t, t)
        backups = list((cases / "new-case" / "backup").glob("01-yoken-*.json"))
        check("write_items：上書きの前に控えを残す", len(backups) >= 3, len(backups))
        t, err = call("write_items", case="new-case", stage="yoken", items=[{"section": "kino", "title": "x"}])
        t2, _ = call("check_sheet", case="new-case", stage="yoken")
        check("check_sheet：必須の欄の空きを知らせる", "「内容」が空です" in t2 and "「優先度」が空です" in t2, t2)

        # 手元の小さなモデルがよく送る形
        t, err = call("write_items", case="str-case", stage="yoken",
                      items='[{"section":"kino","title":"文字で送った一覧","detail":"x","priority":"必須"}]')
        check("write_items：文字（JSON）で送られた一覧も読む", not err and "足した：R-01" in t, t)
        t, err = call("write_items", case="str-case", stage="yoken",
                      items='{"section":"kino","title":"1件だけのオブジェクト","detail":"x","priority":"必須"}')
        check("write_items：1件だけのオブジェクトも一覧として読む", not err and "足した：R-02" in t, t)
        t, err = call("write_items", case="str-case", stage="yoken", delete="R-02")
        check("write_items：消す番号は文字でも読む", not err and "消した：R-02" in t, t)
        t, err = call("write_items", case="str-case", stage="yoken", items='[{"section":"kino",')
        check("write_items：読めない文字の一覧は、理由を返して断る", err and "JSONの一覧" in t, t)
        t, err = call("write_items", case="str-case", stage="yoken", items="Webで申し込める")
        check("write_items：一覧でない文字は、書き方の例を添えて断る", err and "一覧（配列）" in t and "例" in t, t)
        t, err = call("read_items", case="houkago-club", stage="shosai", cursor="5")
        check("read_items：数だけの文字の cursor は読む", not err and "DP-0" not in t.split("\n")[0], t)
        for bad in ("next", "cursor=5", "", True, -1, 9999):
            t, err = call("read_items", case="houkago-club", stage="shosai", cursor=bad)
            if bad == "":
                ok_bad = not err  # 空は「初めから」
            else:
                ok_bad = err and ("cursor は数にしてください" in t or "範囲の外" in t) and "思わぬ問題" not in t
            check("read_items：cursor=%s は%s" % (json.dumps(bad, ensure_ascii=False), "初めから読む" if bad == "" else "理由を返して断る"), ok_bad, t)

        # 食い違いの印
        t, err = call("record_mark", case="houkago-club", tr_id="TR-01", type="寄せた", output_quote="点数の低い児童は利用できません。",
                      request_quote="定員までを入所、残りを待機とする。", reason="待機を利用できないと強めている")
        check("record_mark：印を記録する", not err and "TM-06" in t, t)
        t, err = call("record_mark", case="houkago-club", tr_id="TR-01", type="足した", output_quote="出力に無い文", request_quote="なし", reason="r")
        check("record_mark：出力に無い引用は断る", err and "見つかりません" in t, t)
        t, err = call("record_mark", case="houkago-club", tr_id="TR-09", type="足した", output_quote="x", request_quote="なし", reason="r")
        check("record_mark：無い TR は断る", err, t)

        # 外へ出ない・誤りの扱い
        t, err = call("get_overview", case="../houkago-club", stage="yoken")
        check("案件フォルダの外は読み書きしない", err and "半角英数字" in t, t)
        t, err = call("get_overview", case="houkago-club", stage="sekkei")
        check("無い工程は、工程の一覧を添えて断る", err and "yoken" in t, t)
        t, err = call("get_overview", case="nai", stage="yoken")
        check("無い案件は断る", err and "list_cases" in t, t)
        t, err = call("get_overview", case="houkago-club", stage="要件定義")
        check("工程は名前でも指定できる", not err and "要件定義" in t, t)

        longest = max(len(o[1]) for o in outputs)
        check("どの返事も短く区切っている（%d字以内）" % (MAX_CHARS + 80), longest <= MAX_CHARS + 80, longest)

        c.close()
        lines = log.read_text(encoding="utf-8").splitlines()
        recs = [json.loads(x) for x in lines]
        text = log.read_text(encoding="utf-8")
        check("読み書きの記録を残し、中身は記録しない", len(recs) >= 20 and "保護者がWebで申し込める" not in text and "架空第一小" not in text, len(recs))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- LM Studio のモデルで確かめる

def http_json(url, body=None, timeout=900):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


TASKS = [
    {"name": "点検して件数を答える",
     "prompt": "案件 houkago-club の要件定義（stage=yoken）の工程票を、道具で点検してください。そのうえで「要対応」が何件だったかを、数字で答えてください。",
     "judge": lambda calls, answer, cases: any(c[0] == "check_sheet" and c[1].get("case") == "houkago-club" and c[1].get("stage") == "yoken" for c in calls) and "0" in answer},
    {"name": "項目を1件書き込む",
     "prompt": "案件 lm-test の要件定義（stage=yoken）に、必要な機能（section=kino）を1件書き込んでください。title は「Webで申し込める」、detail は「保護者がWebで申し込める」、priority は「必須」です。書き込んだら、付いた番号を答えてください。",
     "judge": lambda calls, answer, cases: (cases / "lm-test" / "01-yoken.json").exists() and any(
         it.get("title") == "Webで申し込める" and it.get("priority") == "必須"
         for it in json.loads((cases / "lm-test" / "01-yoken.json").read_text(encoding="utf-8"))["items"])},
    {"name": "区切られた項目を読んで答える",
     "prompt": "案件 houkago-club の詳細設計（stage=shosai）の、判定の決まり DR-01 を道具で読んでください。そのうえで、1年〜3年の児童に何点を加えるかを答えてください。",
     "judge": lambda calls, answer, cases: any(c[0] == "read_items" for c in calls) and "3" in answer},
]


def lmstudio_version():
    """LM Studio の版（アプリの package.json）と、lms の CLI commit。"""
    parts = []
    for p in (Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "LM Studio" / "resources" / "app" / "package.json",
              Path("/Applications/LM Studio.app/Contents/Resources/app/package.json")):
        try:
            parts.append("アプリ " + json.loads(p.read_text(encoding="utf-8"))["version"])
            break
        except Exception:
            pass
    try:
        out = subprocess.run(["lms", "version"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30).stdout
        for line in out.splitlines():
            if "commit" in line:
                parts.append("lms " + line.strip())
    except Exception:
        pass
    return "、".join(parts) or "（版を読めませんでした）"


def lmstudio_tests(models):
    try:
        listed = [m["id"] for m in http_json(LMSTUDIO + "/models", timeout=10)["data"]]
    except Exception as e:
        print("LM Studio に接続できません（%s）。lms server start で起動してください：%s" % (LMSTUDIO, e))
        return []
    lms_ver = lmstudio_version()
    report = []
    for model in models:
        if model not in listed:
            print("モデル %s は LM Studio にありません（%s）" % (model, "、".join(listed)))
            continue
        tmp = Path(tempfile.mkdtemp(prefix="ittsukan-lm-"))
        cases = tmp / "cases"
        env = dict(os.environ, ITTSUKAN_CASES=str(cases), PYTHONIOENCODING="utf-8")
        subprocess.run([sys.executable, "-I", str(SERVER), "--init-sample"], env=env, check=True, capture_output=True)
        c = Client(cases, tmp / "log.jsonl")
        c.send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test_client", "version": "1"}})
        c.send("notifications/initialized", {}, notify=True)
        mcp_tools = c.send("tools/list")["result"]["tools"]
        oa_tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}} for t in mcp_tools]
        print("\nモデル：%s" % model)
        for task in TASKS:
            messages = [
                {"role": "system", "content": "あなたは一気通貫ツールの工程票を扱う補助役です。答える前に、必ず道具（tools）を呼んで確かめてください。返事は日本語で短く。"},
                {"role": "user", "content": task["prompt"]}]
            calls, answer, t0, error, tool_errors = [], "", time.time(), "", []
            try:
                for _ in range(6):
                    r = http_json(LMSTUDIO + "/chat/completions", {"model": model, "messages": messages, "tools": oa_tools, "tool_choice": "auto", "temperature": 0})
                    msg = r["choices"][0]["message"]
                    tcs = msg.get("tool_calls") or []
                    if not tcs:
                        answer = msg.get("content") or ""
                        break
                    messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tcs})
                    for tc in tcs:
                        name = tc["function"]["name"]
                        try:
                            args = json.loads(tc["function"].get("arguments") or "{}")
                        except ValueError:
                            args = {}
                        calls.append((name, args))
                        text, is_err = c.call(name, **args) if name in [t["name"] for t in mcp_tools] else ("道具「%s」はありません" % name, True)
                        if is_err or text.startswith("書き込みませんでした"):
                            tool_errors.append(text.replace("\n", " ")[:100])
                        messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": text})
            except Exception as e:
                error = "%s: %s" % (type(e).__name__, e)
            secs = time.time() - t0
            passed = not error and task["judge"](calls, answer, cases)
            print("  %s %s（%.0f秒）道具：%s" % ("OK" if passed else "NG", task["name"], secs, "、".join(n for n, _ in calls) or "なし"))
            if error:
                print("     誤り：" + error)
            if tool_errors and not passed:
                print("     道具の返事（誤り）：" + tool_errors[0])
            report.append({"model": model, "task": task["name"], "passed": passed, "secs": round(secs), "calls": [n for n, _ in calls],
                           "answer": (answer or error).strip().replace("\n", " ")[:120],
                           "tool_error": tool_errors[0] if tool_errors and not passed else ""})
        c.close()
        shutil.rmtree(tmp, ignore_errors=True)
    if report:
        write_report(report, lms_ver)
    return report


def write_report(report, lms_ver):
    p = HERE / "model-check.md"
    head = "" if p.exists() else ("# LM Studio のモデルでの確認の記録\n\n"
                                  "`python mcp/test_client.py --lmstudio モデル名` の結果を書き足しています。"
                                  "test_client が AIアプリの代わりになり、LM Studio のモデルが選んだ道具を、このMCPサーバーで実行しました。\n\n")
    try:
        mem = subprocess.run(["powershell", "-NoProfile", "-c", "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)"],
                             capture_output=True, text=True, timeout=30).stdout.strip() if platform.system() == "Windows" else ""
        cpu = subprocess.run(["powershell", "-NoProfile", "-c", "(Get-CimInstance Win32_Processor).Name"], capture_output=True, text=True, timeout=30).stdout.strip() if platform.system() == "Windows" else platform.processor()
    except Exception:
        mem, cpu = "", ""
    lines = [head + "## %s" % datetime.now().strftime("%Y-%m-%d %H:%M"), "",
             "- 環境：%s %s、メモリ %sGB、%s" % (platform.system(), platform.release(), mem or "?", cpu or "?"),
             "- LM Studio：%s" % lms_ver, "",
             "| モデル | 課題 | 結果 | 時間 | 呼んだ道具 | 返事（先頭）／失敗のときの道具の返事 |", "|---|---|---|---|---|---|"]
    for r in report:
        lines.append("| %s | %s | %s | %d秒 | %s | %s |" % (r["model"], r["task"], "成功" if r["passed"] else "失敗", r["secs"], "、".join(r["calls"]) or "なし", (r["answer"] + (" ／ 道具の返事：" + r["tool_error"] if r.get("tool_error") else "")).replace("|", "｜")))
    lines.append("")
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("\n記録しました：%s" % p)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("MCPのやり取り")
    protocol_tests()
    passed = sum(1 for r in RESULTS if r[1])
    print("結果：%d/%d" % (passed, len(RESULTS)))
    if "--lmstudio" in sys.argv:
        models = sys.argv[sys.argv.index("--lmstudio") + 1:]
        lmstudio_tests(models or ["qwen3.5-4b"])
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
