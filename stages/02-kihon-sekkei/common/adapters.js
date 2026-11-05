/*
 * 一気通貫ツール — 既存のツールとのつなぎ口（読み込み・書き出しの形の変換だけ。どこにも送らない）
 *   gyomu-tanaoroshi   … 要件定義で読み込む（現状の業務）、定着で書き出す（手順書と事務引継ぎ記録）
 *   shinsei-fubi-check … 詳細設計で書き出す（入力チェックと添付書類を、確認項目の設定に）
 *   ai-decision-audit  … テストで書き出す（依頼と出力、食い違いの印）。判定の依頼文と返答の読み込みも同じ形
 *   madoguchi-kaito    … 導入で書き出す（よくある問い合わせを、標準回答台帳に）
 */
(function (global) {
  'use strict';
  var K = global.Ittsukan;

  function str(v) { return v == null ? '' : String(v); }
  function splitList(v) { return str(v).split(/[、,，\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function today() { return K.nowIso().slice(0, 10); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- gyomu-tanaoroshi ---------- */

  /** 業務棚卸しの1件の月の作業時間（時間）。gyomu-tanaoroshi と同じ換算。 */
  function gyomuMonthlyHours(t, settings) {
    settings = settings || {};
    var days = Number(settings.daysPerMonth) || 20;
    var weeks = Number(settings.weeksPerMonth) || 4.33;
    if (t.calcMode === 'cases') {
      if (t.casesPerMonth == null || t.minutesPerCase == null) return null;
      return round1(Number(t.casesPerMonth) * Number(t.minutesPerCase) / 60);
    }
    if (t.freqCount == null || t.minutes == null) return null;
    var per = { day: days, week: weeks, month: 1, year: 1 / 12 }[t.freqUnit];
    if (per == null) return null;
    return round1(Number(t.freqCount) * per * Number(t.minutes) / 60);
  }

  /** 業務棚卸しのJSONを、要件定義の「現状の業務」の項目（番号なし）にする。 */
  function fromGyomu(text, sheet) {
    var data;
    try { data = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text; } catch (e) { throw new Error('JSONとして読めません。'); }
    if (!data || data.app !== 'gyomu-tanaoroshi' || !Array.isArray(data.tasks)) throw new Error('業務棚卸し（gyomu-tanaoroshi）で書き出したJSONではありません。');
    var have = {};
    (sheet ? sheet.items : []).forEach(function (it) { var m = /tanaoroshi）の (\S+) から/.exec(str(it.note)); if (m) have[m[1]] = true; });
    var items = [], skipped = [];
    data.tasks.forEach(function (t) {
      if (have[t.id]) { skipped.push(str(t.name)); return; }
      var who = [t.division, t.section].filter(Boolean).join(' ') + (t.role ? '（' + t.role + '）' : '');
      var it = { section: 'genjo', title: str(t.name) || '（業務名なし）', flow: str(t.procedure), note: '業務棚卸し（gyomu-tanaoroshi）の ' + t.id + ' から読み込み' };
      if (who) it.who = who;
      var h = gyomuMonthlyHours(t, data.settings);
      if (h != null) it.hours = h;
      if (t.issues) it.issues = str(t.issues);
      items.push(it);
    });
    return { items: items, skipped: skipped };
  }

  var FREQ_UNIT = { '日': 'day', '週': 'week', '月': 'month', '年': 'year' };

  /** 定着の工程票（手順書・判断の分かれ目）を、業務棚卸しのJSONにする。「JSONを追加で取り込む」で足せる形。 */
  function toGyomu(sheet) {
    var mhs = sheet.items.filter(function (it) { return it.section === 'hikitsugi'; });
    var tasks = sheet.items.filter(function (it) { return it.section === 'manual'; }).map(function (mp) {
      var mine = mhs.filter(function (mh) { return (mh.from || []).indexOf(mp.id) >= 0; });
      var task = {
        id: 'it-' + sheet['case'].id + '-' + mp.id,
        name: str(mp.title), category: '', division: str(mp.division), section: str(mp.kakari), role: str(mp.role),
        procedure: str(mp.steps), freqUnit: FREQ_UNIT[mp.freq] || 'month', freqCount: null, minutes: null,
        casesPerMonth: null, calcMode: 'freq', minutesPerCase: null, forms: '', issues: '',
        kind: mine.length ? 'expert' : 'routine', need: 'need', ai: '', transferSoon: '',
        createdAt: K.nowIso(), updatedAt: K.nowIso()
      };
      if (mine.length) {
        var join = function (key) { return mine.map(function (m) { return str(m[key]); }).filter(Boolean).join('\n\n'); };
        task.handover = {
          decision: join('title'), reason: join('reason'), whyNot: join('whyNot'), exceptions: join('exceptions'),
          nonTransferable: join('nonTransferable'), steps: join('next'), updatedAt: K.nowIso()
        };
      }
      return task;
    });
    return {
      app: 'gyomu-tanaoroshi', version: 1, tasks: tasks, sections: [],
      settings: { daysPerMonth: 20, weeksPerMonth: 4.33, hoursThreshold: 10 }
    };
  }

  /* ---------- shinsei-fubi-check ---------- */

  var FORMAT = { '文字': 'text', '日付': 'date', '数字のみ': 'digits', '郵便番号': 'postal', '電話番号': 'phone', '金額': 'amount', '選択肢': 'choice', '記載の有無のみ': 'presence' };
  var NEED = { '必須': 'required', '条件付き': 'conditional', '任意': 'optional' };

  /** 詳細設計の入力チェック（DV）と添付書類（DA）を、確認項目の設定のJSONにする。戻り値：{ settings, warnings } */
  function toShinsei(sheet) {
    var warnings = [];
    var fields = sheet.items.filter(function (it) { return it.section === 'check'; }).map(function (dv) {
      return {
        id: 'f-' + dv.id.toLowerCase(), name: str(dv.title), required: dv.required === '必須',
        format: FORMAT[dv.format] || 'text', aliases: [], digitsMin: null, digitsMax: null, amountMin: null, amountMax: null,
        maxLength: null, options: dv.format === '選択肢' ? splitList(dv.options) : [], hint: str(dv.rule)
      };
    });
    var byName = {};
    fields.forEach(function (f) { byName[f.name] = f; });
    var attachments = sheet.items.filter(function (it) { return it.section === 'tenpu'; }).map(function (da) {
      var a = { id: 'a-' + da.id.toLowerCase(), name: str(da.title), need: NEED[da.need] || 'required', cond: null, note: '' };
      if (a.need === 'conditional') {
        var f = byName[str(da.cond_field)];
        if (!f) {
          warnings.push(da.id + '：条件の欄「' + str(da.cond_field) + '」が入力チェック（DV）に無いため、「必須」として書き出しました');
          a.need = 'required';
        } else {
          a.cond = { fieldId: f.id, op: 'equals', values: splitList(da.cond_values) };
        }
      }
      return a;
    });
    if (!fields.length) warnings.push('入力チェック（DV）が1件もありません');
    return {
      settings: {
        format: 'shinsei-fubi-check/settings', version: 1,
        types: [{ id: 't-' + sheet['case'].id, name: sheet['case'].name, note: '一気通貫ツールの詳細設計（' + K.nowIso().slice(0, 10) + '）から書き出し', fields: fields, attachments: attachments }]
      },
      warnings: warnings
    };
  }

  /* ---------- ai-decision-audit ---------- */

  var MARK_TYPES = ['落とした', '足した', '選んだ', '寄せた'];

  /** AIアプリに貼る判定の依頼文（ai-decision-audit と同じ指示）。 */
  function auditPrompt(request, output) {
    return [
      'あなたは、AIが書いた文章を点検する係です。',
      '「依頼文」と、その依頼を受けてAIが書いた「出力」が渡されます。',
      '出力の中から、依頼文に書かれていないのにAIが決めたことを見つけ、次の4種類に分けて挙げてください。',
      '',
      '- 落とした：依頼にあったのに、出力に無いもの',
      '- 足した：依頼に無いのに、出力に加わったもの',
      '- 選んだ：依頼では決まっていなかった選択肢を、AIが一つに決めたもの',
      '- 寄せた：範囲・語調・結論を、依頼より強める／弱める方向へ動かしたもの',
      '',
      '返答は、次の形のJSONだけにしてください。説明、前置き、コードブロックの記号などは書かないでください。',
      '{"marks":[{"type":"足した","output_quote":"（出力から抜き出した文字列）","request_quote":"なし","reason":"（理由を一文で）"}]}',
      '',
      '各項目の決まり：',
      '- type：「落とした」「足した」「選んだ」「寄せた」のどれか一つ。',
      '- output_quote：出力の該当箇所を、出力から一字一句そのまま抜き出す。言い換え・要約・省略をしない。必要な部分だけを短く。「落とした」で出力に該当箇所が無いときは「なし」。',
      '- request_quote：依頼文の対応箇所を、依頼文から一字一句そのまま抜き出す。対応箇所が無いときは「なし」。「落とした」では必ず依頼文から抜き出す。',
      '- reason：なぜその種類に当たるかを、日本語の一文（60字程度まで）で書く。改行しない。',
      '- 該当が一つも無いときは {"marks":[]} とだけ返す。',
      '',
      '<依頼文>\n' + str(request) + '\n</依頼文>\n\n<出力>\n' + str(output) + '\n</出力>'
    ].join('\n');
  }

  /** AIアプリの返答（{"marks":[...]}）を、食い違いの印（TM）の項目（番号なし）にする。戻り値：{ items, errors } */
  function fromAuditAnswer(text, trId) {
    var t = str(text).trim();
    var fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) t = fence[1];
    var obj = null;
    try { obj = JSON.parse(t); } catch (e) {
      var i = t.indexOf('{'), j = t.lastIndexOf('}');
      if (i >= 0 && j > i) { try { obj = JSON.parse(t.slice(i, j + 1)); } catch (e2) { obj = null; } }
    }
    if (!obj || !Array.isArray(obj.marks)) return { items: [], errors: ['返答に {"marks":[...]} の形のJSONが見つかりません'] };
    var items = [], errors = [];
    obj.marks.forEach(function (m, n) {
      var no = (n + 1) + '件目';
      if (!m || MARK_TYPES.indexOf(m.type) < 0) { errors.push(no + '：種類が4種類のどれでもありません'); return; }
      var oq = str(m.output_quote).trim() || K.NONE;
      var rq = str(m.request_quote).trim() || K.NONE;
      var reason = str(m.reason).replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (!reason) { errors.push(no + '：理由が空です'); return; }
      if (m.type === '落とした' && rq === K.NONE) { errors.push(no + '：「落とした」なのに依頼文の対応箇所がありません'); return; }
      if (m.type !== '落とした' && oq === K.NONE) { errors.push(no + '：出力の該当箇所がありません'); return; }
      var decision = { '採る': '採る', '採らない': '採らない' }[m.decision] || '未選択';
      var it = { section: 'shirushi', type: m.type, output_quote: oq, request_quote: rq, reason: reason, decision: decision, from: trId ? [trId] : [] };
      if (m.memo) it.memo = str(m.memo);
      items.push(it);
    });
    return { items: items, errors: errors };
  }

  /** テストの工程票の「依頼と出力」1件と、その印を、ai-decision-audit の記録（JSON）の形にする。 */
  function toAudit(sheet, trId) {
    var tr = K.findItem(sheet, trId);
    if (!tr || tr.section !== 'taisho') throw new Error('依頼と出力（TR）が見つかりません：' + trId);
    var marks = sheet.items.filter(function (it) { return it.section === 'shirushi' && (it.from || []).indexOf(trId) >= 0; });
    return {
      tool: 'ai-decision-audit',
      version: '0.4.0',
      exported_at: new Date().toISOString(),
      origin: '一気通貫ツール テストの工程票 ' + trId + '（' + str(tr.title) + '）',
      request: str(tr.request),
      output: str(tr.output),
      marks: marks.map(function (m, i) {
        return {
          no: i + 1, type: m.type, output_quote: m.output_quote, request_quote: m.request_quote, reason: m.reason,
          source: '一気通貫ツール（' + m.id + '）', decision: m.decision || '未選択', memo: str(m.memo)
        };
      })
    };
  }

  /* ---------- madoguchi-kaito ---------- */

  /** 導入の「よくある問い合わせ」（LQ）を、標準回答台帳のJSONにする。「JSONを追加で取り込む」で足せる形。 */
  function toMadoguchi(sheet) {
    var d = today();
    return {
      format: 'madoguchi-kaito', version: 1, exportedAt: new Date().toISOString(),
      ledger: sheet.items.filter(function (it) { return it.section === 'faq'; }).map(function (q) {
        return {
          id: 'L-it-' + sheet['case'].id + '-' + q.id, major: str(q.major), minor: str(q.minor), question: str(q.title), answer: str(q.answer),
          basisDoc: str(q.basis), basisSection: '', basisPage: '', basisQuote: '', kakari: str(q.kakari), updated: d
        };
      })
    };
  }

  global.IttsukanAdapters = {
    gyomuMonthlyHours: gyomuMonthlyHours,
    fromGyomu: fromGyomu,
    toGyomu: toGyomu,
    toShinsei: toShinsei,
    auditPrompt: auditPrompt,
    fromAuditAnswer: fromAuditAnswer,
    toAudit: toAudit,
    toMadoguchi: toMadoguchi
  };
})(window);
