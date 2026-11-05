/*
 * 一気通貫ツール — 工程票の中核（画面に依存しない処理）
 * 工程票の作成・番号の振り方・形の点検・決まりによる点検・Markdownへの書き出し。
 * 点検の決まりは mcp/ittsukan_mcp.py と同じ。どちらかを直したら、もう一方も直す（test で突き合わせている）。
 * このファイルはどこにも通信しない。
 */
(function (global) {
  'use strict';

  var SCHEMA = global.ITTSUKAN_SCHEMA;
  var NONE = 'なし';
  var FICTIONAL = '架空の基準';
  var FICTIONAL_NOTE = '架空の基準（見本のために作った基準で、実在の自治体の基準ではありません）';

  var STAGES = SCHEMA.stages;
  var STAGE = {};
  var PREFIX = {}; // 番号の頭文字 → { stage, section }
  STAGES.forEach(function (st) {
    STAGE[st.id] = st;
    st.sections.forEach(function (sec) { PREFIX[sec.prefix] = { stage: st.id, section: sec.id }; });
  });
  PREFIX.Q = { stage: null, section: 'open_questions' };

  function str(v) { return v == null ? '' : String(v); }
  function isEmpty(v) { return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0); }
  function asList(v) { return Array.isArray(v) ? v : (isEmpty(v) ? [] : [v]); }

  function getStage(id) { return STAGE[id] || null; }
  function getSection(stageId, sectionId) {
    var st = STAGE[stageId];
    if (!st) return null;
    for (var i = 0; i < st.sections.length; i++) if (st.sections[i].id === sectionId) return st.sections[i];
    return null;
  }
  function fieldOf(sec, key) {
    for (var i = 0; i < sec.fields.length; i++) if (sec.fields[i].key === key) return sec.fields[i];
    return null;
  }

  /** 番号（例：R-03）の頭文字から、どの工程・どの欄の項目かを返す。 */
  function refOwner(id) {
    var m = /^([A-Z]+)-\d+$/.exec(str(id));
    return m ? (PREFIX[m[1]] || null) : null;
  }

  /* ---------- 工程票を作る ---------- */

  function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  function newSheet(stageId, caseInfo) {
    if (!STAGE[stageId]) throw new Error('工程が見つかりません：' + stageId);
    caseInfo = caseInfo || {};
    return {
      kind: SCHEMA.sheet_kind,
      stage: stageId,
      schema_version: SCHEMA.schema_version,
      'case': { id: str(caseInfo.id) || 'case-1', name: str(caseInfo.name) || '名前のない案件' },
      updated: nowIso(),
      upstream: [],
      items: [],
      open_questions: []
    };
  }

  /** その欄の次の番号（例：R-04）。消した番号は使い直さない。 */
  function nextId(sheet, sectionId) {
    var sec = sectionId === 'open_questions' ? { prefix: 'Q' } : getSection(sheet.stage, sectionId);
    if (!sec) throw new Error('欄が見つかりません：' + sectionId);
    var list = sectionId === 'open_questions' ? sheet.open_questions : sheet.items;
    var max = 0;
    var re = new RegExp('^' + sec.prefix + '-(\\d+)$');
    list.forEach(function (it) { var m = re.exec(str(it.id)); if (m) max = Math.max(max, Number(m[1])); });
    if (sheet.next_no && sheet.next_no[sec.prefix]) max = Math.max(max, sheet.next_no[sec.prefix] - 1);
    var n = max + 1;
    return sec.prefix + '-' + (n < 10 ? '0' + n : String(n));
  }

  /* ---------- 形の点検（読み込み・書き込みの前） ---------- */

  /**
   * 項目1件の形を確かめる。戻り値はエラーの一覧（空なら問題なし）。
   * 必須の欄の空きは、ここでは止めない（点検で知らせる）。
   */
  function validateItem(stageId, item) {
    var errs = [];
    if (!item || typeof item !== 'object' || Array.isArray(item)) return ['項目の形が正しくありません'];
    var sec = getSection(stageId, item.section);
    if (!sec) return ['欄「' + str(item.section) + '」はこの工程にありません'];
    var label = str(item.id) || '（番号なし）';
    if (item.id != null && !new RegExp('^' + sec.prefix + '-\\d+$').test(str(item.id))) {
      errs.push(label + '：番号は「' + sec.prefix + '-01」の形にしてください');
    }
    if (item.from != null && !Array.isArray(item.from)) errs.push(label + '：from は番号の一覧にしてください');
    asList(item.from).forEach(function (r) {
      if (!refOwner(r)) errs.push(label + '：もとになった項目の番号「' + str(r) + '」の形が正しくありません');
    });
    sec.fields.forEach(function (f) {
      var v = item[f.key];
      if (v == null || v === '') return;
      if (f.type === 'number') {
        if (typeof v !== 'number' && !(typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()))) errs.push(label + '：「' + f.label + '」は数にしてください');
      } else if (typeof v !== 'string') {
        errs.push(label + '：「' + f.label + '」は文字にしてください');
      } else if (f.type === 'select' && f.options.indexOf(v) < 0) {
        errs.push(label + '：「' + f.label + '」は ' + f.options.join('・') + ' のどれかにしてください');
      }
    });
    Object.keys(item).forEach(function (k) {
      if (k === 'id' || k === 'section' || k === 'from' || k === 'note') return;
      if (!fieldOf(sec, k)) errs.push(label + '：欄「' + k + '」は「' + sec.name + '」にありません');
    });
    return errs;
  }

  /** 読み込んだJSONを工程票として整える。戻り値：{ sheet, errors } */
  function normalizeSheet(obj, expectStage) {
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj.replace(/^﻿/, '')); } catch (e) { return { sheet: null, errors: ['JSONとして読めません'] }; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { sheet: null, errors: ['工程票の形ではありません'] };
    if (obj.kind !== SCHEMA.sheet_kind) return { sheet: null, errors: ['工程票（kind: "kouteihyo"）のファイルではありません'] };
    if (!STAGE[obj.stage]) return { sheet: null, errors: ['工程「' + str(obj.stage) + '」はありません'] };
    if (expectStage && obj.stage !== expectStage) {
      return { sheet: null, errors: ['この画面は「' + STAGE[expectStage].name + '」です。読み込んだのは「' + STAGE[obj.stage].name + '」の工程票です'] };
    }
    var sheet = newSheet(obj.stage, obj['case']);
    sheet.updated = str(obj.updated) || sheet.updated;
    sheet.upstream = Array.isArray(obj.upstream) ? obj.upstream.filter(function (u) { return u && STAGE[u.stage]; }) : [];
    if (obj.next_no && typeof obj.next_no === 'object') sheet.next_no = obj.next_no;
    var errors = [];
    var seen = {};
    (Array.isArray(obj.items) ? obj.items : []).forEach(function (it, i) {
      var e = validateItem(obj.stage, it);
      if (!e.length && seen[it.id]) e = [it.id + '：番号が重なっています'];
      if (e.length) { errors.push.apply(errors, e.map(function (x) { return (i + 1) + '件目 ' + x; })); return; }
      var copy = JSON.parse(JSON.stringify(it));
      copy.from = asList(copy.from);
      seen[copy.id] = true;
      sheet.items.push(copy);
    });
    (Array.isArray(obj.open_questions) ? obj.open_questions : []).forEach(function (q) {
      if (q && /^Q-\d+$/.test(str(q.id))) sheet.open_questions.push({ id: q.id, text: str(q.text), status: q.status === '決まった' ? '決まった' : '未決' });
    });
    return { sheet: sheet, errors: errors };
  }

  /* ---------- 決まりによる点検（AIは使わない） ---------- */

  function findItem(sheet, id) {
    if (!sheet) return null;
    for (var i = 0; i < sheet.items.length; i++) if (sheet.items[i].id === id) return sheet.items[i];
    return null;
  }

  function matchesWhere(item, where) {
    if (!where) return true;
    return Object.keys(where).every(function (k) { return item[k] === where[k]; });
  }

  /**
   * 工程票を点検する。others は { 工程ID: 工程票 }（前の工程の工程票。無ければ、その分は確かめない）。
   * 戻り値：[{ level: '要対応'|'参考', id, message }]（並びは決まった順）
   */
  function checkSheet(sheet, others) {
    others = others || {};
    var st = STAGE[sheet.stage];
    var out = [];
    var sheets = {};
    Object.keys(others).forEach(function (k) { if (others[k]) sheets[k] = others[k]; });
    sheets[sheet.stage] = sheet;

    // 1. 必須の欄の空き
    sheet.items.forEach(function (it) {
      var sec = getSection(sheet.stage, it.section);
      if (!sec) return;
      sec.fields.forEach(function (f) {
        if (f.required && isEmpty(it[f.key])) out.push({ level: '要対応', id: it.id, message: '「' + f.label + '」が空です' });
      });
    });

    // 2. もとになった項目の番号がつながるか
    var unchecked = {};
    sheet.items.forEach(function (it) {
      asList(it.from).forEach(function (r) {
        var owner = refOwner(r);
        if (!owner || !owner.stage) { out.push({ level: '要対応', id: it.id, message: 'もとになった項目「' + r + '」の番号の形が正しくありません' }); return; }
        if (!sheets[owner.stage]) { unchecked[owner.stage] = true; return; }
        if (!findItem(sheets[owner.stage], r)) {
          out.push({ level: '要対応', id: it.id, message: 'もとになった項目「' + r + '」が「' + STAGE[owner.stage].name + '」の工程票に見つかりません' });
        }
      });
    });

    // 3. 抜けの点検（前の工程の項目が、この工程のどこかから参照されているか）
    (st.coverage || []).forEach(function (rule) {
      var target = sheets[rule.must_cover.stage];
      if (!target) { unchecked[rule.must_cover.stage] = true; return; }
      var secs = asList(rule.section);
      var referenced = {};
      sheet.items.forEach(function (it) {
        if (secs.indexOf(it.section) >= 0) asList(it.from).forEach(function (r) { referenced[r] = true; });
      });
      target.items.forEach(function (t) {
        if (t.section !== rule.must_cover.section || !matchesWhere(t, rule.must_cover.where)) return;
        if (!referenced[t.id]) out.push({ level: rule.level || '要対応', id: t.id, message: rule.message + '（' + str(t.title) + '）' });
      });
    });

    // 4. 印（結果が未実施、採る・採らないが未選択など）
    (st.flags || []).forEach(function (fl) {
      sheet.items.forEach(function (it) {
        if (it.section === fl.section && it[fl.field] === fl.equals) out.push({ level: fl.level || '要対応', id: it.id, message: fl.message });
      });
    });

    // 5. 架空の基準
    sheet.items.forEach(function (it) {
      if (typeof it.basis_kind === 'string' && it.basis_kind.indexOf(FICTIONAL) >= 0) {
        out.push({ level: '参考', id: it.id, message: '架空の基準です。本番で使う前に、実在の基準（例規・要綱など）に置き換えてください' });
      }
    });

    // 6. 未決事項
    var open = sheet.open_questions.filter(function (q) { return q.status !== '決まった'; });
    if (open.length) out.push({ level: '参考', id: '', message: '未決事項が' + open.length + '件あります（' + open.map(function (q) { return q.id; }).join('、') + '）' });

    // 7. 確かめられなかった工程
    STAGES.forEach(function (s) {
      if (unchecked[s.id]) out.push({ level: '参考', id: '', message: '「' + s.name + '」の工程票が無いため、そこへのつながりは確かめていません' });
    });
    return out;
  }

  function summarize(issues) {
    var must = issues.filter(function (x) { return x.level === '要対応'; }).length;
    return { must: must, info: issues.length - must };
  }

  /* ---------- Markdown（人が読む用） ---------- */

  function mdEscapeLine(s) { return str(s).replace(/\r\n?/g, '\n'); }

  function itemTitle(sec, it) {
    var t = it.title != null ? str(it.title) : '';
    if (sec.id === 'shirushi') t = '【' + str(it.type) + '】' + str(it.reason);
    if (sec.id === 'faq' && it.major) t = str(it.title);
    return t.split('\n')[0];
  }

  function toMarkdown(sheet) {
    var st = STAGE[sheet.stage];
    var lines = [];
    lines.push('# ' + st.name + ' の工程票');
    lines.push('');
    lines.push('- 案件：' + sheet['case'].name + '（' + sheet['case'].id + '）');
    lines.push('- 更新：' + sheet.updated);
    if (sheet.upstream.length) lines.push('- 前の工程の工程票：' + sheet.upstream.map(function (u) { return STAGE[u.stage].name + (u.file ? '（' + u.file + '）' : ''); }).join('、'));
    lines.push('');
    st.sections.forEach(function (sec) {
      var items = sheet.items.filter(function (it) { return it.section === sec.id; });
      lines.push('## ' + sec.name + '（' + sec.prefix + '）');
      lines.push('');
      if (!items.length) { lines.push('（まだありません）'); lines.push(''); return; }
      items.forEach(function (it) {
        var head = '### ' + it.id + ' ' + itemTitle(sec, it);
        if (typeof it.basis_kind === 'string' && it.basis_kind.indexOf(FICTIONAL) >= 0) head += ' 【' + FICTIONAL + '】';
        lines.push(head);
        lines.push('');
        if (typeof it.basis_kind === 'string' && it.basis_kind.indexOf(FICTIONAL) >= 0) {
          lines.push('> ' + FICTIONAL_NOTE);
          lines.push('');
        }
        sec.fields.forEach(function (f) {
          var v = it[f.key];
          if (isEmpty(v)) return;
          if (f.key === 'title' && sec.id !== 'kenshu' && f.type !== 'textarea') return;
          var text = mdEscapeLine(v);
          if (text.indexOf('\n') >= 0) {
            lines.push('- ' + f.label + '：');
            lines.push('');
            text.split('\n').forEach(function (l) { lines.push('    ' + l); });
            lines.push('');
          } else {
            lines.push('- ' + f.label + '：' + text);
          }
        });
        if (asList(it.from).length) lines.push('- もとになった項目：' + asList(it.from).join('、'));
        if (!isEmpty(it.note)) lines.push('- メモ：' + mdEscapeLine(it.note).replace(/\n/g, ' '));
        lines.push('');
      });
    });
    lines.push('## 未決事項（Q）');
    lines.push('');
    if (!sheet.open_questions.length) lines.push('（ありません）');
    sheet.open_questions.forEach(function (q) { lines.push('- ' + q.id + '［' + q.status + '］' + q.text); });
    lines.push('');
    return lines.join('\n');
  }

  function fileBase(stageId) { return STAGE[stageId].folder; }

  global.Ittsukan = {
    SCHEMA: SCHEMA,
    STAGES: STAGES,
    NONE: NONE,
    FICTIONAL: FICTIONAL,
    FICTIONAL_NOTE: FICTIONAL_NOTE,
    getStage: getStage,
    getSection: getSection,
    refOwner: refOwner,
    newSheet: newSheet,
    nextId: nextId,
    validateItem: validateItem,
    normalizeSheet: normalizeSheet,
    findItem: findItem,
    checkSheet: checkSheet,
    summarize: summarize,
    toMarkdown: toMarkdown,
    fileBase: fileBase,
    nowIso: nowIso
  };
})(typeof window !== 'undefined' ? window : this);
