"""一気通貫ツールのMCPサーバー（Pythonの標準機能だけで動く）

AIアプリ（Claude Desktop、LM Studio）から、工程票の読み込み・書き出し・点検を道具として呼び出せるようにする。
- 通信は標準入出力（同じPCの中でのやり取り）だけ。外部へは通信しない。
- 読み書きするのは、案件フォルダ（既定は リポジトリ直下の cases/）の中だけ。
- 道具が返す文章は短く区切る（既定1,200字。手元のモデルは扱える文章量が小さいため）。
- 読み書きの記録を mcp/logs/access_log.jsonl に残す（中身ではなく、いつ・どの道具で・どの案件のどの工程か）。

    python mcp/ittsukan_mcp.py                       サーバーとして起動する（AIアプリが起動する）
    python mcp/ittsukan_mcp.py --cases D:\\案件       案件フォルダを指定する（環境変数 ITTSUKAN_CASES でも可）
    python mcp/ittsukan_mcp.py --init-sample         見本案件（放課後児童クラブの利用申請）を案件フォルダに置く
"""
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ittsukan_core as K  # noqa: E402

SERVER_NAME = "ittsukan-tool"
SERVER_VERSION = "1.0.0"
PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
MAX_CHARS = int(os.environ.get("ITTSUKAN_MAX_CHARS", "1200"))
FIELD_CUT = 240  # 一覧で1つの欄に出す字数の上限
CASE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
STAGE_IDS = [st["id"] for st in K.STAGES]


class ToolError(Exception):
    pass


def arg_value(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


CASES = Path(arg_value("--cases") or os.environ.get("ITTSUKAN_CASES") or (HERE.parent / "cases")).resolve()
LOG = Path(os.environ.get("ITTSUKAN_LOG") or (HERE / "logs" / "access_log.jsonl"))


def log(tool, **info):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        rec = {"time_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tool": tool}
        rec.update(info)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- 案件フォルダ

def case_dir(case_id, create=False):
    cid = K.s(case_id).strip()
    if not CASE_RE.match(cid):
        raise ToolError("案件の記号は半角英数字・-・_ だけにしてください（例：houkago-club）")
    d = (CASES / cid).resolve()
    if d.parent != CASES:
        raise ToolError("案件フォルダの外は読み書きできません")
    if not d.exists():
        if not create:
            raise ToolError("案件「%s」がありません。list_cases で案件を確かめてください" % cid)
        d.mkdir(parents=True)
    return d


def stage_id(name):
    sid = K.stage_by_any(name)
    if not sid:
        raise ToolError("工程「%s」はありません。工程は %s のどれかです" % (K.s(name), "・".join(STAGE_IDS)))
    return sid


def sheet_path(d, sid):
    return d / (K.file_base(sid) + ".json")


def load_sheet(d, sid, required=True):
    p = sheet_path(d, sid)
    if not p.exists():
        if required:
            raise ToolError("「%s」の工程票がまだありません（%s）" % (K.STAGE[sid]["name"], p.name))
        return None
    sheet, errors = K.normalize_sheet(p.read_text(encoding="utf-8"), sid)
    if sheet is None:
        raise ToolError("工程票を読めません：" + "／".join(errors))
    return sheet


def upstream_sheets(d, sid):
    out = {}
    for u in K.STAGE[sid]["upstream"]:
        sh = load_sheet(d, u, required=False)
        if sh:
            out[u] = sh
    return out


def save_sheet(d, sheet):
    sid = sheet["stage"]
    p = sheet_path(d, sid)
    if p.exists():
        b = d / "backup"
        b.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copyfile(p, b / ("%s-%s.json" % (K.file_base(sid), stamp)))
    ups = upstream_sheets(d, sid)
    sheet["upstream"] = [{"stage": u, "file": K.file_base(u) + ".json", "updated": ups[u]["updated"]} for u in K.STAGE[sid]["upstream"] if u in ups]
    sheet["updated"] = K.now_iso()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, p)
    (d / (K.file_base(sid) + ".md")).write_text(K.to_markdown(sheet), encoding="utf-8", newline="\n")


# ---------------------------------------------------------------- 短く区切る

def cut(text, n=FIELD_CUT):
    t = K.s(text).replace("\r\n", "\n").replace("\n", " / ")
    return t if len(t) <= n else t[:n] + "…（続きは item_id を指定して read_items）"


def page(lines, cursor, footer_hint):
    """行の一覧を MAX_CHARS 以内で返す。続きがあれば cursor を示す。"""
    start = int(cursor or 0)
    if start < 0 or (start and start >= len(lines)):
        raise ToolError("cursor が範囲の外です（0〜%d）" % max(0, len(lines) - 1))
    out, size, i = [], 0, start
    while i < len(lines):
        line = lines[i]
        if out and size + len(line) + 1 > MAX_CHARS:
            break
        if not out and len(line) > MAX_CHARS:
            line = line[:MAX_CHARS - 20] + "…（長いため省略）"
        out.append(line)
        size += len(line) + 1
        i += 1
    if i < len(lines):
        out.append("（続きがあります：%s cursor=%d。全%d件中 %d〜%d件目）" % (footer_hint, i, len(lines), start + 1, i))
    return "\n".join(out)


def item_lines(sheet, it, full=False):
    sec = K.get_section(sheet["stage"], it.get("section"))
    title = K._item_title(sec, it)
    head = "%s［%s］%s" % (it["id"], sec["name"], title)
    if isinstance(it.get("basis_kind"), str) and K.FICTIONAL in it["basis_kind"]:
        head += " 【架空の基準】"
    parts = [head]
    for f in sec["fields"]:
        v = it.get(f["key"])
        if K.is_empty(v) or (f["key"] == "title" and f["type"] != "textarea"):
            continue
        parts.append("  %s：%s" % (f["label"], K._md_line(v) if full else cut(K._md_line(v))))
    if it.get("from"):
        parts.append("  もと：" + "、".join(it["from"]))
    if it.get("note"):
        parts.append("  メモ：" + (K.s(it["note"]) if full else cut(it["note"], 120)))
    return "\n".join(parts)


# ---------------------------------------------------------------- 道具

def t_list_cases(a):
    CASES.mkdir(parents=True, exist_ok=True)
    rows = []
    for d in sorted(p for p in CASES.iterdir() if p.is_dir() and CASE_RE.match(p.name)):
        have = []
        name = ""
        for st in K.STAGES:
            p = sheet_path(d, st["id"])
            if p.exists():
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    name = name or K.s((obj.get("case") or {}).get("name"))
                    have.append("%d%s(%d)" % (st["no"], st["name"].split("（")[0], len(obj.get("items") or [])))
                except ValueError:
                    have.append("%d%s(読めない)" % (st["no"], st["name"].split("（")[0]))
        rows.append("%s「%s」 %s" % (d.name, name or "名前なし", " ".join(have) if have else "工程票なし"))
    log("list_cases")
    if not rows:
        return "案件はまだありません。write_items で case と stage を指定して書くと、案件フォルダができます。"
    return page(rows, a.get("cursor"), "list_cases")


def t_get_overview(a):
    d = case_dir(a.get("case"))
    sid = stage_id(a.get("stage"))
    sheet = load_sheet(d, sid)
    st = K.STAGE[sid]
    issues = K.check_sheet(sheet, upstream_sheets(d, sid))
    sm = K.summarize(issues)
    lines = ["%s／%s（工程%d）更新 %s" % (sheet["case"]["name"], st["name"], st["no"], sheet["updated"])]
    for sec in st["sections"]:
        ids = [it["id"] for it in sheet["items"] if it.get("section") == sec["id"]]
        lines.append("- %s（%s）%d件%s" % (sec["name"], sec["prefix"], len(ids), "：" + "、".join(ids[:12]) + ("…" if len(ids) > 12 else "") if ids else ""))
    oq = [q for q in sheet["open_questions"] if q["status"] != "決まった"]
    lines.append("- 未決事項 %d件" % len(oq))
    ups = [K.STAGE[u]["name"] for u in st["upstream"] if sheet_path(d, u).exists()]
    lines.append("- 前の工程の工程票：" + ("、".join(ups) if ups else "なし"))
    lines.append("点検：要対応 %d件・参考 %d件（詳しくは check_sheet）" % (sm["must"], sm["info"]))
    log("get_overview", case=d.name, stage=sid)
    return page(lines, 0, "get_overview")


def t_read_items(a):
    d = case_dir(a.get("case"))
    sid = stage_id(a.get("stage"))
    sheet = load_sheet(d, sid)
    if a.get("item_id"):
        it = K.find_item(sheet, a["item_id"])
        if not it:
            raise ToolError("項目「%s」はありません" % a["item_id"])
        log("read_items", case=d.name, stage=sid, item=it["id"])
        return page(item_lines(sheet, it, full=True).split("\n"), a.get("cursor"), "read_items item_id=%s" % it["id"])
    items = sheet["items"]
    if a.get("section"):
        sec = [s for s in K.STAGE[sid]["sections"] if a["section"] in (s["id"], s["prefix"], s["name"])]
        if not sec:
            raise ToolError("欄「%s」はこの工程にありません。欄は %s です" % (a["section"], "・".join("%s(%s)" % (s["id"], s["prefix"]) for s in K.STAGE[sid]["sections"])))
        items = [it for it in items if it.get("section") == sec[0]["id"]]
    lines = [item_lines(sheet, it) for it in items]
    if not a.get("section"):
        lines += ["%s［未決事項・%s］%s" % (q["id"], q["status"], q["text"]) for q in sheet["open_questions"]]
    log("read_items", case=d.name, stage=sid, section=a.get("section") or "", cursor=a.get("cursor") or 0)
    if not lines:
        return "項目はまだありません。"
    return page(lines, a.get("cursor"), "read_items" + (" section=%s" % a["section"] if a.get("section") else ""))


def t_get_guide(a):
    sid = stage_id(a.get("stage"))
    st = K.STAGE[sid]
    if a.get("section"):
        sec = [s for s in st["sections"] if a["section"] in (s["id"], s["prefix"], s["name"])]
        if not sec:
            raise ToolError("欄「%s」はこの工程にありません" % a["section"])
        sec = sec[0]
        lines = ["%s（section=%s、番号 %s-01〜）：%s" % (sec["name"], sec["id"], sec["prefix"], sec["help"])]
        for f in sec["fields"]:
            opt = "（%s のどれか）" % "・".join(f["options"]) if f.get("options") else ""
            lines.append("- %s：%s%s%s" % (f["key"], f["label"], "【必須】" if f.get("required") else "", opt))
        if sec.get("from"):
            lines.append("- from：もとになった項目の番号の一覧（%s から）" % "・".join(sec["from"]))
        lines.append("聞くこと：" + "／".join("%sは？" % f["label"].split("（")[0] for f in sec["fields"] if f.get("required")))
        lines.append('書き方の例：write_items items=[{"section":"%s", %s}]' % (sec["id"], ", ".join('"%s":"…"' % f["key"] for f in sec["fields"] if f.get("required"))))
    else:
        lines = ["%s（stage=%s）：%s。こんなときに：%s。" % (st["name"], sid, st["plain"], st["stuck"])]
        if st["upstream"]:
            lines.append("前の工程：" + "、".join("%s(%s)" % (K.STAGE[u]["name"], u) for u in st["upstream"]))
        for sec in st["sections"]:
            req = [f["label"].split("（")[0] for f in sec["fields"] if f.get("required")]
            lines.append("- %s（section=%s、番号 %s）必須：%s" % (sec["name"], sec["id"], sec["prefix"], "・".join(req)))
        lines.append("欄の詳しい説明は get_guide に section を付けて呼んでください。")
    log("get_guide", stage=sid, section=a.get("section") or "")
    return page(lines, a.get("cursor"), "get_guide")


def _clean_value(f, v):
    if f["type"] == "number" and isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v.strip()):
        n = float(v)
        return int(n) if n.is_integer() else n
    return v


def t_write_items(a):
    sid = stage_id(a.get("stage"))
    d = case_dir(a.get("case"), create=True)
    sheet = load_sheet(d, sid, required=False)
    if sheet is None:
        sheet = K.new_sheet(sid, {"id": d.name, "name": a.get("case_name") or d.name})
    elif a.get("case_name"):
        sheet["case"]["name"] = K.s(a["case_name"])
    items = a.get("items") or []
    deletes = a.get("delete") or []
    if not isinstance(items, list) or not isinstance(deletes, list):
        raise ToolError("items と delete は一覧（配列）にしてください")
    if not items and not deletes:
        raise ToolError("items（足す・直す項目）か delete（消す番号）を指定してください")
    work = json.loads(json.dumps(sheet))
    added, updated, removed, errors = [], [], [], []
    for x in deletes:
        before = len(work["items"])
        work["items"] = [it for it in work["items"] if it.get("id") != x]
        qs = len(work["open_questions"])
        work["open_questions"] = [q for q in work["open_questions"] if q.get("id") != x]
        if len(work["items"]) == before and len(work["open_questions"]) == qs:
            errors.append("消す番号「%s」がありません" % x)
        else:
            removed.append(x)
    for n, raw in enumerate(items):
        if not isinstance(raw, dict):
            errors.append("%d件目：項目はオブジェクトにしてください" % (n + 1))
            continue
        it = dict(raw)
        if it.get("section") == "open_questions":
            if it.get("id") and any(q["id"] == it["id"] for q in work["open_questions"]):
                for q in work["open_questions"]:
                    if q["id"] == it["id"]:
                        q.update({k: K.s(v) for k, v in it.items() if k in ("text", "status")})
                updated.append(it["id"])
            elif not K.s(it.get("text")).strip():
                errors.append("%d件目：未決事項の text が空です" % (n + 1))
            else:
                qid = K.next_id(work, "open_questions")
                work["open_questions"].append({"id": qid, "text": K.s(it["text"]), "status": "決まった" if it.get("status") == "決まった" else "未決"})
                added.append(qid)
            continue
        sec = K.get_section(sid, it.get("section"))
        if sec is None and it.get("id"):
            owner = K.ref_owner(it["id"])
            if owner and owner[0] == sid:
                sec = K.get_section(sid, owner[1])
                it["section"] = owner[1]
        if sec is None:
            errors.append("%d件目：section は %s のどれかにしてください" % (n + 1, "・".join(s["id"] for s in K.STAGE[sid]["sections"])))
            continue
        for f in sec["fields"]:
            if f["key"] in it:
                it[f["key"]] = _clean_value(f, it[f["key"]])
        if "from" in it and isinstance(it["from"], str):
            it["from"] = [x for x in re.split(r"[、,，\s]+", it["from"]) if x]
        existing = K.find_item(work, it.get("id")) if it.get("id") else None
        if existing:
            merged = dict(existing)
            merged.update(it)
            e = K.validate_item(sid, merged)
            if e:
                errors.extend("%d件目 %s" % (n + 1, x) for x in e)
                continue
            work["items"] = [merged if x.get("id") == merged["id"] else x for x in work["items"]]
            updated.append(merged["id"])
        else:
            if it.get("id") and K.ref_owner(it["id"]) != (sid, sec["id"]):
                errors.append("%d件目：番号「%s」は「%s」の形（%s-01）ではありません。番号を付けずに送ると自動で振ります" % (n + 1, it["id"], sec["name"], sec["prefix"]))
                continue
            it["id"] = it.get("id") or K.next_id(work, sec["id"])
            it.setdefault("from", [])
            e = K.validate_item(sid, it)
            if e:
                errors.extend("%d件目 %s" % (n + 1, x) for x in e)
                continue
            m = re.fullmatch(r"([A-Z]+)-(\d+)", it["id"])
            work.setdefault("next_no", {})
            work["next_no"][m.group(1)] = max(int(work["next_no"].get(m.group(1), 0)), int(m.group(2)) + 1)
            # 同じ欄の最後に入れる
            last = max([i for i, x in enumerate(work["items"]) if x.get("section") == it["section"]], default=-1)
            if last < 0:
                work["items"].append(it)
            else:
                work["items"].insert(last + 1, it)
            added.append(it["id"])
    if errors:
        log("write_items", case=d.name, stage=sid, result="rejected", errors=len(errors))
        return page(["書き込みませんでした（1件でも誤りがあると、すべて書き込みません）："] + ["- " + e for e in errors], 0, "write_items")
    save_sheet(d, work)
    issues = K.check_sheet(work, upstream_sheets(d, sid))
    sm = K.summarize(issues)
    log("write_items", case=d.name, stage=sid, added=added, updated=updated, removed=removed)
    parts = []
    if added:
        parts.append("足した：" + "、".join(added))
    if updated:
        parts.append("直した：" + "、".join(updated))
    if removed:
        parts.append("消した：" + "、".join(removed))
    return "%s（%s）。点検：要対応 %d件・参考 %d件（詳しくは check_sheet）" % ("／".join(parts), K.file_base(sid) + ".json と .md に保存", sm["must"], sm["info"])


def t_check_sheet(a):
    d = case_dir(a.get("case"))
    sid = stage_id(a.get("stage"))
    sheet = load_sheet(d, sid)
    issues = K.check_sheet(sheet, upstream_sheets(d, sid))
    sm = K.summarize(issues)
    log("check_sheet", case=d.name, stage=sid, must=sm["must"], info=sm["info"])
    if not issues:
        return "%s：気になる点は見つかりませんでした。" % K.STAGE[sid]["name"]
    lines = ["%s：要対応 %d件・参考 %d件" % (K.STAGE[sid]["name"], sm["must"], sm["info"])]
    lines += ["- %s %s%s" % (x["level"], (x["id"] + " ") if x["id"] else "", x["message"]) for x in issues]
    return page(lines, a.get("cursor"), "check_sheet")


def t_record_mark(a):
    d = case_dir(a.get("case"))
    sheet = load_sheet(d, "test")
    tr = K.find_item(sheet, a.get("tr_id"))
    if not tr or tr.get("section") != "taisho":
        raise ToolError("依頼と出力（TR）の「%s」がありません。read_items stage=test section=taisho で確かめてください" % K.s(a.get("tr_id")))
    mtype = a.get("type")
    if mtype not in ("落とした", "足した", "選んだ", "寄せた"):
        raise ToolError("type は 落とした・足した・選んだ・寄せた のどれかにしてください")
    oq = K.s(a.get("output_quote")).strip() or "なし"
    rq = K.s(a.get("request_quote")).strip() or "なし"
    reason = re.sub(r"\s*[\r\n]+\s*", " ", K.s(a.get("reason"))).strip()
    if not reason:
        raise ToolError("reason（理由を一行）を書いてください")
    if mtype == "落とした" and rq == "なし":
        raise ToolError("「落とした」は request_quote（依頼文の対応箇所）が要ります")
    if mtype != "落とした" and oq == "なし":
        raise ToolError("output_quote（出力の該当箇所）が要ります")

    def found(text, q):
        if q == "なし":
            return True
        if q in K.s(text):
            return True
        return re.sub(r"\s+", "", q) in re.sub(r"\s+", "", K.s(text))
    if not found(tr.get("output"), oq):
        raise ToolError("output_quote が出力の中に見つかりません。出力から一字一句そのまま抜き出してください")
    if not found(tr.get("request"), rq):
        raise ToolError("request_quote が依頼文の中に見つかりません。依頼文から一字一句そのまま抜き出してください")
    decision = a.get("decision") if a.get("decision") in ("採る", "採らない") else "未選択"
    item = {"section": "shirushi", "type": mtype, "output_quote": oq, "request_quote": rq, "reason": reason, "decision": decision, "from": [tr["id"]]}
    if a.get("memo"):
        item["memo"] = K.s(a["memo"])
    result = t_write_items({"case": d.name, "stage": "test", "items": [item]})
    log("record_mark", case=d.name, tr=tr["id"], type=mtype)
    return result


STAGE_PROP = {"type": "string", "enum": STAGE_IDS, "description": "工程：yoken=要件定義 kihon=基本設計 shosai=詳細設計 jisso=実装 test=テスト donyu=導入 teichaku=定着"}
CASE_PROP = {"type": "string", "description": "案件の記号（半角英数字。例：houkago-club）"}
CURSOR_PROP = {"type": "integer", "description": "続きを読むときの位置（前の返事に出た cursor）"}

TOOLS = [
    {"name": "list_cases", "description": "案件の一覧と、7工程それぞれの工程票の有無・件数を返す。",
     "inputSchema": {"type": "object", "properties": {"cursor": CURSOR_PROP}}, "fn": t_list_cases},
    {"name": "get_overview", "description": "1つの工程票のあらまし（欄ごとの件数と番号、未決事項、点検の件数）を返す。",
     "inputSchema": {"type": "object", "properties": {"case": CASE_PROP, "stage": STAGE_PROP}, "required": ["case", "stage"]}, "fn": t_get_overview},
    {"name": "read_items", "description": "工程票の項目を短く区切って返す。section で欄を絞る。item_id で1件を全文で読む。続きは cursor。",
     "inputSchema": {"type": "object", "properties": {"case": CASE_PROP, "stage": STAGE_PROP,
                                                       "section": {"type": "string", "description": "欄（例：kino）。get_guide で分かる"},
                                                       "item_id": {"type": "string", "description": "1件だけ全文で読むときの番号（例：R-01）"},
                                                       "cursor": CURSOR_PROP}, "required": ["case", "stage"]}, "fn": t_read_items},
    {"name": "get_guide", "description": "その工程で聞くこと・埋める欄の手引きを返す。section を付けると欄の項目と書き方の例を返す。",
     "inputSchema": {"type": "object", "properties": {"stage": STAGE_PROP, "section": {"type": "string", "description": "欄（例：kino）"}, "cursor": CURSOR_PROP},
                     "required": ["stage"]}, "fn": t_get_guide},
    {"name": "write_items", "description": "工程票に項目を足す・直す・消す。番号（id）を付けずに送ると自動で振る。id を付けると、その項目の欄を直す。1件でも誤りがあれば何も書き込まない。JSONとMarkdownに保存し、前の版を控える。",
     "inputSchema": {"type": "object", "properties": {
         "case": CASE_PROP, "stage": STAGE_PROP,
         "case_name": {"type": "string", "description": "案件の名前（初めて書くときに付ける）"},
         "items": {"type": "array", "description": '項目の一覧。例：[{"section":"kino","title":"Web申込","detail":"…","priority":"必須","from":["G-01"]}]。未決事項は {"section":"open_questions","text":"…"}',
                   "items": {"type": "object"}},
         "delete": {"type": "array", "items": {"type": "string"}, "description": "消す番号の一覧（例：[\"R-03\"]）"}},
         "required": ["case", "stage"]}, "fn": t_write_items},
    {"name": "check_sheet", "description": "工程票を決まりで点検する（必須の欄の空き、つながらない番号、前の工程の項目の抜けなど）。AIは使わない。",
     "inputSchema": {"type": "object", "properties": {"case": CASE_PROP, "stage": STAGE_PROP, "cursor": CURSOR_PROP}, "required": ["case", "stage"]}, "fn": t_check_sheet},
    {"name": "record_mark", "description": "テストの工程票に、依頼と出力（TR）の食い違いの印を1件記録する。引用は依頼文・出力から一字一句そのまま。",
     "inputSchema": {"type": "object", "properties": {
         "case": CASE_PROP, "tr_id": {"type": "string", "description": "依頼と出力の番号（例：TR-01）"},
         "type": {"type": "string", "enum": ["落とした", "足した", "選んだ", "寄せた"]},
         "output_quote": {"type": "string", "description": "出力の該当箇所。無ければ「なし」"},
         "request_quote": {"type": "string", "description": "依頼文の対応箇所。無ければ「なし」"},
         "reason": {"type": "string", "description": "理由（一行）"},
         "decision": {"type": "string", "enum": ["未選択", "採る", "採らない"]},
         "memo": {"type": "string"}},
         "required": ["case", "tr_id", "type", "output_quote", "request_quote", "reason"]}, "fn": t_record_mark},
]
TOOL_BY_NAME = {t["name"]: t for t in TOOLS}


# ---------------------------------------------------------------- MCP（JSON-RPC、標準入出力）

def handle(msg):
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if method == "initialize":
        req = params.get("protocolVersion")
        ver = req if req in PROTOCOLS else PROTOCOLS[0]
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": ver,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": "一気通貫ツールの工程票（要件定義〜定着の7工程）を読み書き・点検する道具です。まず list_cases、次に get_overview か get_guide を呼んでください。返事は短く区切って返します。"}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": [{k: v for k, v in t.items() if k != "fn"} for t in TOOLS]}}
    if method == "tools/call":
        name = params.get("name")
        tool = TOOL_BY_NAME.get(name)
        if not tool:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "道具「%s」はありません" % name}}
        args = params.get("arguments") or {}
        try:
            text = tool["fn"](args if isinstance(args, dict) else {})
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}], "isError": False}}
        except ToolError as e:
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "できませんでした：" + str(e)}], "isError": True}}
        except Exception as e:  # 思わぬ問題でもサーバーは止めない
            return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "思わぬ問題が起きました：%s" % type(e).__name__}], "isError": True}}
    if mid is None:
        return None  # 通知（notifications/initialized など）には返事をしない
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "知らない method です：%s" % method}}


def serve():
    stdin = sys.stdin.buffer
    out = sys.stdout.buffer
    for raw in stdin:
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSONとして読めません"}}
        else:
            if isinstance(msg, list):
                resp = [r for r in (handle(m) for m in msg if isinstance(m, dict)) if r] or None
            else:
                resp = handle(msg) if isinstance(msg, dict) else None
        if resp:
            out.write((json.dumps(resp, ensure_ascii=False) + "\n").encode("utf-8"))
            out.flush()


def init_sample():
    src = HERE.parent / "samples" / "houkago-club"
    dst = CASES / "houkago-club"
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for st in K.STAGES:
        for ext in (".json", ".md"):
            p = src / (st["folder"] + ext)
            if p.exists():
                shutil.copyfile(p, dst / p.name)
                n += 1
    print("見本案件を %s に置きました（%d件のファイル）" % (dst, n))


if __name__ == "__main__":
    if "--init-sample" in sys.argv:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        init_sample()
    else:
        serve()
