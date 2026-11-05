"""一気通貫ツール — 工程票の中核（Python版）

common/core.js と同じ決まりで、工程票の形の点検・決まりによる点検・Markdownへの書き出しを行う。
どちらかを直したら、もう一方も直す（test/ で両方の結果を突き合わせている）。
Pythonの標準機能だけで動く。どこにも通信しない。
"""
import copy
import json
import re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
FICTIONAL = "架空の基準"
FICTIONAL_NOTE = "架空の基準（見本のために作った基準で、実在の自治体の基準ではありません）"


def find_schema_path():
    """schema.json の場所。mcp/ だけを取り出して使うときのために、同じフォルダの複製も探す。"""
    for p in (HERE / "schema.json", HERE.parent / "common" / "schema.json"):
        if p.exists():
            return p
    raise FileNotFoundError("schema.json が見つかりません")


SCHEMA = json.loads(find_schema_path().read_text(encoding="utf-8"))
STAGES = SCHEMA["stages"]
STAGE = {st["id"]: st for st in STAGES}
PREFIX = {}
for _st in STAGES:
    for _sec in _st["sections"]:
        PREFIX[_sec["prefix"]] = (_st["id"], _sec["id"])
PREFIX["Q"] = (None, "open_questions")


def s(v):
    return "" if v is None else str(v)


def is_empty(v):
    return v is None or (isinstance(v, str) and v.strip() == "") or (isinstance(v, list) and len(v) == 0)


def as_list(v):
    if isinstance(v, list):
        return v
    return [] if is_empty(v) else [v]


def get_section(stage_id, section_id):
    st = STAGE.get(stage_id)
    if not st:
        return None
    for sec in st["sections"]:
        if sec["id"] == section_id:
            return sec
    return None


def field_of(sec, key):
    for f in sec["fields"]:
        if f["key"] == key:
            return f
    return None


def ref_owner(ref):
    m = re.fullmatch(r"([A-Z]+)-\d+", s(ref))
    return PREFIX.get(m.group(1)) if m else None


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_sheet(stage_id, case=None):
    if stage_id not in STAGE:
        raise ValueError("工程が見つかりません：" + s(stage_id))
    case = case or {}
    return {
        "kind": SCHEMA["sheet_kind"],
        "stage": stage_id,
        "schema_version": SCHEMA["schema_version"],
        "case": {"id": s(case.get("id")) or "case-1", "name": s(case.get("name")) or "名前のない案件"},
        "updated": now_iso(),
        "upstream": [],
        "items": [],
        "open_questions": [],
    }


def next_id(sheet, section_id):
    if section_id == "open_questions":
        prefix, items = "Q", sheet["open_questions"]
    else:
        sec = get_section(sheet["stage"], section_id)
        if not sec:
            raise ValueError("欄が見つかりません：" + s(section_id))
        prefix, items = sec["prefix"], sheet["items"]
    mx = 0
    for it in items:
        m = re.fullmatch(prefix + r"-(\d+)", s(it.get("id")))
        if m:
            mx = max(mx, int(m.group(1)))
    nn = (sheet.get("next_no") or {}).get(prefix)
    if nn:
        mx = max(mx, int(nn) - 1)
    return "%s-%02d" % (prefix, mx + 1)


def _is_number_like(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    return isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v.strip()) is not None


def validate_item(stage_id, item):
    if not isinstance(item, dict):
        return ["項目の形が正しくありません"]
    sec = get_section(stage_id, item.get("section"))
    if not sec:
        return ["欄「%s」はこの工程にありません" % s(item.get("section"))]
    errs = []
    label = s(item.get("id")) or "（番号なし）"
    if item.get("id") is not None and not re.fullmatch(sec["prefix"] + r"-\d+", s(item.get("id"))):
        errs.append("%s：番号は「%s-01」の形にしてください" % (label, sec["prefix"]))
    if item.get("from") is not None and not isinstance(item.get("from"), list):
        errs.append(label + "：from は番号の一覧にしてください")
    for r in as_list(item.get("from")):
        if not ref_owner(r):
            errs.append("%s：もとになった項目の番号「%s」の形が正しくありません" % (label, s(r)))
    for f in sec["fields"]:
        v = item.get(f["key"])
        if v is None or v == "":
            continue
        if f["type"] == "number":
            if not _is_number_like(v):
                errs.append("%s：「%s」は数にしてください" % (label, f["label"]))
        elif not isinstance(v, str):
            errs.append("%s：「%s」は文字にしてください" % (label, f["label"]))
        elif f["type"] == "select" and v not in f["options"]:
            errs.append("%s：「%s」は %s のどれかにしてください" % (label, f["label"], "・".join(f["options"])))
    for k in item.keys():
        if k in ("id", "section", "from", "note"):
            continue
        if not field_of(sec, k):
            errs.append("%s：欄「%s」は「%s」にありません" % (label, k, sec["name"]))
    return errs


def normalize_sheet(obj, expect_stage=None):
    """読み込んだJSONを工程票として整える。戻り値：(sheet または None, errors)"""
    if isinstance(obj, str):
        try:
            obj = json.loads(obj.lstrip("﻿"))
        except ValueError:
            return None, ["JSONとして読めません"]
    if not isinstance(obj, dict):
        return None, ["工程票の形ではありません"]
    if obj.get("kind") != SCHEMA["sheet_kind"]:
        return None, ['工程票（kind: "kouteihyo"）のファイルではありません']
    if obj.get("stage") not in STAGE:
        return None, ["工程「%s」はありません" % s(obj.get("stage"))]
    if expect_stage and obj["stage"] != expect_stage:
        return None, ["この画面は「%s」です。読み込んだのは「%s」の工程票です" % (STAGE[expect_stage]["name"], STAGE[obj["stage"]]["name"])]
    sheet = new_sheet(obj["stage"], obj.get("case") if isinstance(obj.get("case"), dict) else None)
    sheet["updated"] = s(obj.get("updated")) or sheet["updated"]
    sheet["upstream"] = [u for u in (obj.get("upstream") or []) if isinstance(u, dict) and u.get("stage") in STAGE]
    if isinstance(obj.get("next_no"), dict):
        sheet["next_no"] = obj["next_no"]
    errors, seen = [], set()
    for i, it in enumerate(obj.get("items") or []):
        e = validate_item(obj["stage"], it)
        if not e and it.get("id") in seen:
            e = [s(it.get("id")) + "：番号が重なっています"]
        if e:
            errors.extend("%d件目 %s" % (i + 1, x) for x in e)
            continue
        c = copy.deepcopy(it)
        c["from"] = as_list(c.get("from"))
        seen.add(c.get("id"))
        sheet["items"].append(c)
    for q in obj.get("open_questions") or []:
        if isinstance(q, dict) and re.fullmatch(r"Q-\d+", s(q.get("id"))):
            sheet["open_questions"].append({"id": q["id"], "text": s(q.get("text")), "status": "決まった" if q.get("status") == "決まった" else "未決"})
    return sheet, errors


def find_item(sheet, item_id):
    if not sheet:
        return None
    for it in sheet["items"]:
        if it.get("id") == item_id:
            return it
    return None


def _matches_where(item, where):
    return all(item.get(k) == v for k, v in (where or {}).items())


def check_sheet(sheet, others=None):
    """工程票を点検する。others は {工程ID: 工程票}。戻り値：[{level, id, message}]（core.js と同じ並び）"""
    others = others or {}
    st = STAGE[sheet["stage"]]
    out = []
    sheets = {k: v for k, v in others.items() if v}
    sheets[sheet["stage"]] = sheet

    for it in sheet["items"]:
        sec = get_section(sheet["stage"], it.get("section"))
        if not sec:
            continue
        for f in sec["fields"]:
            if f.get("required") and is_empty(it.get(f["key"])):
                out.append({"level": "要対応", "id": it["id"], "message": "「%s」が空です" % f["label"]})

    unchecked = set()
    for it in sheet["items"]:
        for r in as_list(it.get("from")):
            owner = ref_owner(r)
            if not owner or not owner[0]:
                out.append({"level": "要対応", "id": it["id"], "message": "もとになった項目「%s」の番号の形が正しくありません" % r})
                continue
            if owner[0] not in sheets:
                unchecked.add(owner[0])
                continue
            if not find_item(sheets[owner[0]], r):
                out.append({"level": "要対応", "id": it["id"], "message": "もとになった項目「%s」が「%s」の工程票に見つかりません" % (r, STAGE[owner[0]]["name"])})

    for rule in st.get("coverage") or []:
        target = sheets.get(rule["must_cover"]["stage"])
        if not target:
            unchecked.add(rule["must_cover"]["stage"])
            continue
        secs = as_list(rule["section"])
        referenced = set()
        for it in sheet["items"]:
            if it.get("section") in secs:
                referenced.update(as_list(it.get("from")))
        for t in target["items"]:
            if t.get("section") != rule["must_cover"]["section"] or not _matches_where(t, rule["must_cover"].get("where")):
                continue
            if t["id"] not in referenced:
                out.append({"level": rule.get("level") or "要対応", "id": t["id"], "message": "%s（%s）" % (rule["message"], s(t.get("title")))})

    for fl in st.get("flags") or []:
        for it in sheet["items"]:
            if it.get("section") == fl["section"] and it.get(fl["field"]) == fl["equals"]:
                out.append({"level": fl.get("level") or "要対応", "id": it["id"], "message": fl["message"]})

    for it in sheet["items"]:
        bk = it.get("basis_kind")
        if isinstance(bk, str) and FICTIONAL in bk:
            out.append({"level": "参考", "id": it["id"], "message": "架空の基準です。本番で使う前に、実在の基準（例規・要綱など）に置き換えてください"})

    open_q = [q for q in sheet["open_questions"] if q.get("status") != "決まった"]
    if open_q:
        out.append({"level": "参考", "id": "", "message": "未決事項が%d件あります（%s）" % (len(open_q), "、".join(q["id"] for q in open_q))})

    for st2 in STAGES:
        if st2["id"] in unchecked:
            out.append({"level": "参考", "id": "", "message": "「%s」の工程票が無いため、そこへのつながりは確かめていません" % st2["name"]})
    return out


def summarize(issues):
    must = sum(1 for x in issues if x["level"] == "要対応")
    return {"must": must, "info": len(issues) - must}


def _item_title(sec, it):
    t = s(it.get("title"))
    if sec["id"] == "shirushi":
        t = "【%s】%s" % (s(it.get("type")), s(it.get("reason")))
    return t.split("\n")[0]


def _md_line(v):
    if isinstance(v, bool):
        v = "true" if v else "false"
    elif isinstance(v, float) and v.is_integer():
        v = int(v)
    return s(v).replace("\r\n", "\n").replace("\r", "\n")


def to_markdown(sheet):
    st = STAGE[sheet["stage"]]
    lines = ["# %s の工程票" % st["name"], ""]
    lines.append("- 案件：%s（%s）" % (sheet["case"]["name"], sheet["case"]["id"]))
    lines.append("- 更新：" + s(sheet["updated"]))
    if sheet["upstream"]:
        lines.append("- 前の工程の工程票：" + "、".join(STAGE[u["stage"]]["name"] + ("（%s）" % u["file"] if u.get("file") else "") for u in sheet["upstream"]))
    lines.append("")
    for sec in st["sections"]:
        items = [it for it in sheet["items"] if it.get("section") == sec["id"]]
        lines.append("## %s（%s）" % (sec["name"], sec["prefix"]))
        lines.append("")
        if not items:
            lines.extend(["（まだありません）", ""])
            continue
        for it in items:
            fict = isinstance(it.get("basis_kind"), str) and FICTIONAL in it["basis_kind"]
            head = "### %s %s" % (it["id"], _item_title(sec, it))
            if fict:
                head += " 【%s】" % FICTIONAL
            lines.extend([head, ""])
            if fict:
                lines.extend(["> " + FICTIONAL_NOTE, ""])
            for f in sec["fields"]:
                v = it.get(f["key"])
                if is_empty(v):
                    continue
                if f["key"] == "title" and sec["id"] != "kenshu" and f["type"] != "textarea":
                    continue
                text = _md_line(v)
                if "\n" in text:
                    lines.extend(["- %s：" % f["label"], ""])
                    lines.extend("    " + l for l in text.split("\n"))
                    lines.append("")
                else:
                    lines.append("- %s：%s" % (f["label"], text))
            if as_list(it.get("from")):
                lines.append("- もとになった項目：" + "、".join(as_list(it.get("from"))))
            if not is_empty(it.get("note")):
                lines.append("- メモ：" + _md_line(it["note"]).replace("\n", " "))
            lines.append("")
    lines.extend(["## 未決事項（Q）", ""])
    if not sheet["open_questions"]:
        lines.append("（ありません）")
    for q in sheet["open_questions"]:
        lines.append("- %s［%s］%s" % (q["id"], q["status"], q["text"]))
    lines.append("")
    return "\n".join(lines)


def file_base(stage_id):
    return STAGE[stage_id]["folder"]


def stage_by_any(name):
    """工程の指定（"yoken"、"01-yoken"、"1"、"要件定義"）から工程IDを返す。"""
    n = s(name).strip()
    for st in STAGES:
        if n in (st["id"], st["folder"], str(st["no"]), "%02d" % st["no"], st["name"]) or (n and st["name"].startswith(n)):
            return st["id"]
    return None
