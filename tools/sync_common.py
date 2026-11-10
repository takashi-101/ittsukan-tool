"""共通の部品を作り、各工程のフォルダへ配る。

    python tools/sync_common.py          作って配る
    python tools/sync_common.py --check  配った複製が元と同じかだけを確かめる（違えば終了コード1）

やること：
  1. common/schema.json から common/schema.js を作る（ブラウザ用。ファイルを直接開いても読めるように）
  2. samples/houkago-club/ の工程票から common/samples.js を作る
  3. 各工程のフォルダ（stages/NN-xxx/）に index.html と README.md を作り、common/ の部品を複製する
     → フォルダを1つ取り出すだけで、その工程の道具として動く
  4. mcp/schema.json に複製する（mcp/ だけを取り出しても動くように）
  5. test/expected.js を作る（Python版の点検とMarkdownの結果。ブラウザのテストで JavaScript版と突き合わせる）
Pythonの標準機能だけで動く。
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mcp"))

VERSION = "1.0.0"
COMMON_FILES = ["schema.js", "core.js", "samples.js", "adapters.js", "ui.js", "style.css"]
SAMPLE_DIR = ROOT / "samples" / "houkago-club"

CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")


def js_assign(name, obj):
    return "/* 自動で作ったファイル（tools/sync_common.py）。直接直さず、元のファイルを直して作り直す。 */\nwindow.%s = %s;\n" % (
        name, json.dumps(obj, ensure_ascii=False, indent=1))


def stage_html(st):
    scripts = "\n".join('<script src="common/%s?v=%s"></script>' % (f, VERSION) for f in COMMON_FILES if f.endswith(".js"))
    return """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>{name}｜一気通貫ツール</title>
<link rel="stylesheet" href="common/style.css?v={ver}">
</head>
<body>
<a class="visually-hidden" href="#main">本文へ移動</a>
<div id="app" data-stage="{id}"><noscript>この画面は JavaScript を使います。</noscript></div>
{scripts}
<script src="stage.js?v={ver}"></script>
</body>
</html>
""".format(csp=CSP, name=st["name"], ver=VERSION, id=st["id"], scripts=scripts)


TOOLS_TEXT = {
    "yoken": ["業務棚卸し（gyomu-tanaoroshi）で書き出したJSONから、現状の業務を読み込む"],
    "kihon": ["必要な機能から、画面の下書きを作る", "画面・帳票の項目から、扱うデータ項目の下書きを作る（個人情報に当たりそうな項目に印を付ける）",
              "画面・帳票の形を、下書きで見る（入力の形・一覧の形・1枚の書類の形。A4で印刷できる）",
              "機能と、画面・帳票・外部とのやり取りの対応表を見る"],
    "shosai": ["データ項目から、データの型の下書きを作る", "AIに渡す仕様書（Markdown）を書き出す",
               "入力チェックと添付書類を、申請書類 記載漏れ確認ツール（shinsei-fubi-check）の設定（JSON）として書き出す"],
    "jisso": ["詳細設計から、AIへの実装依頼文の下書きを作る", "試作の雛形（1ファイルのHTML。画面の形と入力チェックだけ）を書き出す",
              "エラーの文章から、原因の候補と確かめ方を出す（決まった表で引く。AIは使わない）"],
    "test": ["必要な機能から、確認項目の下書きを作る", "依頼と出力の食い違いを、自分のAIアプリで判定する（判定の依頼文を作り、返答を貼り付けて読み込む）",
             "AIが決めたことチェック（ai-decision-audit）の記録と同じ形で書き出す"],
    "donyu": ["必要な機能から、現場へ渡す手順の下書きを作る", "使う人向けの説明を印刷する（A4）",
              "よくある問い合わせを、窓口回答標準化ツール（madoguchi-kaito）の標準回答台帳（JSON）として書き出す"],
    "teichaku": ["導入の手順から、手順書の下書きを作る", "手順書と判断の分かれ目を、業務棚卸し・事務引継ぎ記録（gyomu-tanaoroshi）のJSONとして書き出す"],
}


def stage_readme(schema, st):
    by_id = {s["id"]: s for s in schema["stages"]}
    ups = "、".join(by_id[u]["name"] for u in st["upstream"]) or "なし（最初の工程）"
    lines = [
        "# %s（一気通貫ツールの工程%d）" % (st["name"], st["no"]), "",
        "## 概要（30秒で読めます）", "",
        "- **この工程で詰まっている会社向け**：%s。" % st["stuck"],
        "- この画面で、%s。" % st["plain"],
        "- 結果は「工程票（こうていひょう）」というJSONにまとまり、次の工程で読み込めます。人が読む用のMarkdownでも書き出せます。",
        "- AIを使わなくても、入力・点検・書き出しはすべて動きます。入力した内容はブラウザの中にだけ保存し、どこにも送信しません。",
        "- このフォルダだけを取り出しても動きます（`index.html` をブラウザで開くだけ）。", "",
        "## 入力と出力", "",
        "| | 内容 |", "|---|---|",
        "| 前の工程の工程票（任意） | %s |" % ups,
        "| この工程で書くもの | %s |" % "、".join("%s（%s）" % (s["name"], s["prefix"]) for s in st["sections"]),
        "| 書き出すもの | `%s.json`（工程票）、`%s.md`（人が読む用） |" % (st["folder"], st["folder"]), "",
        "## この工程の道具", "",
    ]
    lines += ["- " + t for t in TOOLS_TEXT[st["id"]]]
    lines += ["", "## 点検（AIは使わない）", "",
              "入力のたびに、決まりで次を調べて「点検の結果」に出します。", "",
              "- 必須の欄の空き",
              "- 「もとになった項目」の番号が、前の工程の工程票につながるか"]
    for c in st.get("coverage") or []:
        lines.append("- %s（%s）" % (c["message"], c["level"]))
    for f in st.get("flags") or []:
        lines.append("- %s（%s）" % (f["message"], f["level"]))
    lines += ["- 「架空の基準」と書いた決まり（参考。本番の前に実在の基準へ置き換える）", "",
              "## 欄の説明", ""]
    for s in st["sections"]:
        lines.append("### %s（%s）" % (s["name"], s["prefix"]))
        lines.append("")
        lines.append(s["help"])
        lines.append("")
        lines.append("| 欄 | 必須 | 選べる値 |")
        lines.append("|---|---|---|")
        for f in s["fields"]:
            lines.append("| %s | %s | %s |" % (f["label"], "必須" if f.get("required") else "", "・".join(f.get("options", []))))
        lines.append("")
    lines += ["## 見本", "",
              "画面の「見本案件（放課後児童クラブの利用申請）を読み込む」で、架空の市の案件を表示できます。前の工程の工程票も見本のものを読み込みます。", "",
              "## AIアプリから使う", "",
              "リポジトリの `mcp/` にあるMCPサーバーを Claude Desktop か LM Studio に登録すると、AIアプリがこの工程の工程票を読み書き・点検できます。手順はリポジトリ直下のREADMEにあります。", ""]
    return "\n".join(lines)


def build_expected(schema):
    import ittsukan_core as KP
    sheets = {}
    for st in schema["stages"]:
        sheets[st["id"]] = json.loads((SAMPLE_DIR / (st["folder"] + ".json")).read_text(encoding="utf-8"))
    cases = []
    for st in schema["stages"]:
        sh, _ = KP.normalize_sheet(sheets[st["id"]], st["id"])
        others = {u: KP.normalize_sheet(sheets[u], u)[0] for u in st["upstream"]}
        cases.append({"name": st["id"] + "（前の工程あり）", "sheet": sheets[st["id"]], "others": {u: sheets[u] for u in st["upstream"]},
                      "issues": KP.check_sheet(sh, others), "markdown": KP.to_markdown(sh)})
        cases.append({"name": st["id"] + "（この工程だけ）", "sheet": sheets[st["id"]], "others": {},
                      "issues": KP.check_sheet(sh, {}), "markdown": None})
    # 決まりをわざと破った工程票（空き・つながらない番号・抜け・印・未決）
    broken = copy.deepcopy(sheets["test"])
    broken["items"][0]["procedure"] = ""
    broken["items"][1]["from"] = ["R-99"]
    broken["items"] = [it for it in broken["items"] if it["id"] != "TC-03"]
    for it in broken["items"]:
        if it["id"] == "TM-02":
            it["decision"] = "未選択"
        if it["id"] == "TC-02":
            it["result"] = "不合格"
    broken["open_questions"] = [{"id": "Q-01", "text": "検収の日をいつにするか", "status": "未決"}]
    bsh, berr = KP.normalize_sheet(broken, "test")
    cases.append({"name": "test（決まりを破った工程票）", "sheet": broken, "others": {"yoken": sheets["yoken"], "jisso": sheets["jisso"]},
                  "issues": KP.check_sheet(bsh, {"yoken": KP.normalize_sheet(sheets["yoken"])[0], "jisso": KP.normalize_sheet(sheets["jisso"])[0]}),
                  "markdown": KP.to_markdown(bsh)})
    # 形の誤り（normalize で除かれる項目）
    bad = {"kind": "kouteihyo", "stage": "yoken", "case": {"id": "x", "name": "x"}, "items": [
        {"id": "R-01", "section": "kino", "title": "a", "detail": "b", "priority": "とても大事"},
        {"id": "R-2", "section": "kino", "title": "a"},
        {"id": "Z-01", "section": "nai", "title": "a"},
        {"id": "G-01", "section": "mokuteki", "title": "a", "measure": "b", "extra": "x"},
        {"id": "W-01", "section": "genjo", "title": "a", "flow": "b", "hours": "たくさん"},
        {"id": "P-01", "section": "komari", "title": "a", "from": ["W-01", "w1"]},
        {"id": "P-01", "section": "komari", "title": "dup"},
        {"id": "X-01", "section": "taishogai", "title": "ok"}
    ]}
    _, bad_errors = KP.normalize_sheet(bad, "yoken")
    return {"cases": cases, "normalize": {"input": bad, "errors": bad_errors}}


def generate():
    schema = json.loads((ROOT / "common" / "schema.json").read_text(encoding="utf-8"))
    out = {}
    out[ROOT / "common" / "schema.js"] = js_assign("ITTSUKAN_SCHEMA", schema)
    samples = {"case": None, "sheets": {}, "inputs": {}}
    for st in schema["stages"]:
        sh = json.loads((SAMPLE_DIR / (st["folder"] + ".json")).read_text(encoding="utf-8"))
        samples["sheets"][st["id"]] = sh
        samples["case"] = sh["case"]
    samples["inputs"]["gyomu"] = json.loads((SAMPLE_DIR / "input" / "gyomu-tanaoroshi.json").read_text(encoding="utf-8"))
    out[ROOT / "common" / "samples.js"] = js_assign("ITTSUKAN_SAMPLES", samples)
    for st in schema["stages"]:
        d = ROOT / "stages" / st["folder"]
        out[d / "index.html"] = stage_html(st)
        out[d / "README.md"] = stage_readme(schema, st)
    out[ROOT / "mcp" / "schema.json"] = (ROOT / "common" / "schema.json").read_text(encoding="utf-8")
    out[ROOT / "test" / "expected.js"] = js_assign("ITTSUKAN_EXPECTED", build_expected(schema))
    return schema, out


def copies(schema, generated):
    pairs = []
    for st in schema["stages"]:
        for f in COMMON_FILES:
            src = ROOT / "common" / f
            text = generated.get(src)
            if text is None:
                text = src.read_text(encoding="utf-8")
            pairs.append((ROOT / "stages" / st["folder"] / "common" / f, text))
    return pairs


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    check = "--check" in sys.argv
    schema, generated = generate()
    targets = list(generated.items()) + copies(schema, generated)
    diff = []
    for path, text in targets:
        cur = path.read_text(encoding="utf-8") if path.exists() else None
        if cur != text:
            diff.append(path)
            if not check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8", newline="\n")
    rel = [str(p.relative_to(ROOT)) for p in diff]
    if check:
        if rel:
            print("元と違う（tools/sync_common.py を走らせてください）:")
            for r in rel:
                print("  " + r)
            sys.exit(1)
        print("配った複製はすべて元と同じです（%d件）" % len(targets))
    else:
        print("作った・更新したファイル: %d件（全%d件）" % (len(rel), len(targets)))
        for r in rel:
            print("  " + r)


if __name__ == "__main__":
    main()
