/*
 * 一気通貫ツール — 入口（7工程の一覧と、要件定義から定着までの通しの点検）
 * 各工程の画面は、このブラウザに保存した工程票（ittsukan:sheet:工程）を読み書きする。ここでは一覧と通しの点検、まとめての読み書きを行う。
 */
(function (global) {
  'use strict';
  var K = global.Ittsukan;
  var doc = global.document;
  var KEY_SHEET = 'ittsukan:sheet:';
  var KEY_REF = 'ittsukan:ref:';

  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, children) {
    var n = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return n;
  }
  function load(key) { try { var r = global.localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function store(key, v) { try { if (v == null) global.localStorage.removeItem(key); else global.localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function msg(text, kind) { var m = $('home-msg'); m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text || ''; }

  function sheets() {
    var o = {};
    K.STAGES.forEach(function (st) {
      var raw = load(KEY_SHEET + st.id);
      var r = raw ? K.normalizeSheet(raw, st.id) : null;
      if (r && r.sheet) o[st.id] = r.sheet;
    });
    return o;
  }

  /** 通しの点検：各工程を、ほかのすべての工程の工程票と突き合わせて点検する。 */
  function throughCheck(all) {
    return K.STAGES.map(function (st) {
      var sh = all[st.id];
      if (!sh) return { stage: st, sheet: null, issues: null };
      var others = {};
      st.upstream.forEach(function (u) { if (all[u]) others[u] = all[u]; });
      return { stage: st, sheet: sh, issues: K.checkSheet(sh, others) };
    });
  }

  function render() {
    var all = sheets();
    var rows = throughCheck(all);
    var grid = $('stage-grid');
    grid.textContent = '';
    rows.forEach(function (r) {
      var st = r.stage;
      var sum = r.issues ? K.summarize(r.issues) : null;
      var state = r.sheet
        ? r.sheet.items.length + '件・' + (sum.must ? '要対応 ' + sum.must + '件' : '要対応なし') + '・参考 ' + sum.info + '件'
        : 'まだ工程票がありません';
      grid.appendChild(el('article', { class: 'card stage-card', id: 'stage-' + st.id }, [
        el('p', { class: 'no', text: '工程' + st.no }),
        el('h3', { text: st.name }),
        el('p', { text: st.plain + '。' }),
        el('p', { class: 'muted grow' }, [el('strong', { text: 'こんなときに：' }), st.stuck + '。']),
        el('p', { class: 'state ' + (sum && sum.must ? 'msg bad' : 'muted'), text: state }),
        el('div', { class: 'button-row' }, [el('a', { class: 'button primary', href: 'stages/' + st.folder + '/index.html', text: 'この工程を開く' })])
      ]));
    });

    var tbody = $('through-body');
    tbody.textContent = '';
    var any = false;
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', text: r.stage.no + ' ' + r.stage.name }));
      if (!r.sheet) {
        tr.appendChild(el('td', { text: '—' }));
        tr.appendChild(el('td', { text: '—' }));
        tr.appendChild(el('td', { class: 'muted', text: 'まだ工程票がありません' }));
      } else {
        any = true;
        var sum = K.summarize(r.issues);
        tr.appendChild(el('td', { text: String(r.sheet.items.length) }));
        tr.appendChild(el('td', { class: sum.must ? 'msg bad' : '', text: String(sum.must) }));
        var first = r.issues.filter(function (x) { return x.level === '要対応'; }).slice(0, 3)
          .map(function (x) { return (x.id ? x.id + ' ' : '') + x.message; });
        tr.appendChild(el('td', { text: first.length ? first.join('／') + (sum.must > 3 ? ' ほか' : '') : '（要対応なし）' }));
      }
      tbody.appendChild(tr);
    });
    var through = rows.every(function (r) { return r.sheet && K.summarize(r.issues).must === 0; });
    $('through-summary').textContent = !any ? 'まだ工程票がありません。見本案件を読み込むと、通しの点検を試せます。'
      : through ? '要件定義から定着まで、7工程すべてが要対応なしでつながっています。' : '要対応のある工程、または工程票の無い工程があります。';
    $('through-summary').className = 'check-summary ' + (through ? 'ok' : (any ? 'bad' : ''));
  }

  function loadSample() {
    var smp = global.ITTSUKAN_SAMPLES;
    var has = Object.keys(sheets()).length;
    if (has && !global.confirm('このブラウザに保存している7工程の工程票は、見本案件で置き換わります。続けますか。')) return;
    K.STAGES.forEach(function (st) {
      store(KEY_SHEET + st.id, smp.sheets[st.id]);
      st.upstream.forEach(function (u) { store(KEY_REF + st.id + ':' + u, null); });
    });
    render();
    msg('見本案件「' + smp.case.name + '」を、7工程すべてに読み込みました。', 'ok');
  }

  function exportBundle() {
    var all = sheets();
    if (!Object.keys(all).length) { msg('書き出す工程票がありません。', 'warn'); return; }
    var first = all[Object.keys(all)[0]];
    var bundle = { kind: 'ittsukan-case', schema_version: K.SCHEMA.schema_version, 'case': first['case'], exported: K.nowIso(), sheets: K.STAGES.filter(function (st) { return all[st.id]; }).map(function (st) { return all[st.id]; }) };
    var blob = new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'ittsukan-' + first['case'].id + '.json' });
    doc.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg('7工程の工程票をまとめて書き出しました（' + bundle.sheets.length + '枚）。', 'ok');
  }

  function importBundle(text) {
    var data;
    try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { msg('JSONとして読めません。', 'bad'); return; }
    var list = data && data.kind === 'ittsukan-case' && Array.isArray(data.sheets) ? data.sheets : (data && data.kind === 'kouteihyo' ? [data] : null);
    if (!list) { msg('まとめて書き出したファイル（kind: "ittsukan-case"）か、工程票のファイルを選んでください。', 'bad'); return; }
    var n = 0, errs = [];
    list.forEach(function (sh) {
      var r = K.normalizeSheet(sh);
      if (!r.sheet) { errs.push(r.errors.join('／')); return; }
      store(KEY_SHEET + r.sheet.stage, r.sheet);
      n++;
      if (r.errors.length) errs.push(K.getStage(r.sheet.stage).name + '：形の合わない項目' + r.errors.length + '件を除きました');
    });
    render();
    msg(n + '枚の工程票を読み込みました。' + (errs.length ? errs.join('／') : ''), errs.length ? 'warn' : 'ok');
  }

  function clearAll() {
    if (!global.confirm('このブラウザに保存している7工程の工程票をすべて消します。先に「まとめて書き出す」をしておくと元に戻せます。続けますか。')) return;
    K.STAGES.forEach(function (st) {
      store(KEY_SHEET + st.id, null);
      st.upstream.forEach(function (u) { store(KEY_REF + st.id + ':' + u, null); });
    });
    render();
    msg('消しました。');
  }

  function start() {
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-export').addEventListener('click', exportBundle);
    $('btn-clear').addEventListener('click', clearAll);
    $('file-bundle').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { e.target.value = ''; importBundle(String(r.result)); };
      r.readAsText(f, 'utf-8');
    });
    global.addEventListener('pageshow', render);
    global.addEventListener('storage', render);
    render();
  }

  global.IttsukanHome = { throughCheck: throughCheck, render: render, importBundle: importBundle };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
