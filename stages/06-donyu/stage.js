/* 導入の道具：手順の下書き、使う人向けの説明の印刷、よくある問い合わせの書き出し（madoguchi-kaito の台帳の形） */
(function () {
  'use strict';
  var UI = window.IttsukanUI, A = window.IttsukanAdapters, el = UI.el;

  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }

  UI.addTool('必要な機能から、現場へ渡す手順の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '要件定義の工程票の「必要な機能（R）」のうち、優先度が「必須」で、まだ現場へ渡す手順（LS）が無い機能ごとに下書きを足します。する人といつまでにを書き足してください。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-draft-steps', text: '手順の下書きを作る', onclick: function () {
      var yoken = UI.getRef('yoken');
      if (!yoken) { say(out, '先に「前の工程の工程票」で、要件定義の工程票を読み込んでください。', 'warn'); return; }
      var used = {};
      UI.getSheet().items.forEach(function (it) { if (it.section === 'tejun') (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = yoken.items.filter(function (r) { return r.section === 'kino' && r.priority === '必須' && !used[r.id]; })
        .map(function (r) { return { section: 'tejun', title: r.title + 'を使い始める準備', detail: r.detail || '', from: [r.id] }; });
      if (!drafts.length) { say(out, '下書きを作る機能はありません。'); return; }
      var ids = UI.addItems(drafts);
      say(out, '手順の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('使う人向けの説明を印刷する（A4）', function (box) {
    box.appendChild(el('p', { text: '「使う人向けの説明（LE）」を、読む人ごとに1枚ずつ印刷します。PDFにするときは、印刷の画面で「PDFに保存」を選びます。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-print', text: '説明を印刷する', onclick: function () {
      var sheet = UI.getSheet();
      var list = sheet.items.filter(function (it) { return it.section === 'setsumei'; });
      if (!list.length) { say(out, '使う人向けの説明（LE）がまだありません。', 'warn'); return; }
      var area = el('section', { class: 'card print-target', id: 'print-area' });
      list.forEach(function (it, i) {
        area.appendChild(el('article', { class: i ? 'print-page page-break' : 'print-page' }, [
          el('p', { class: 'muted', text: sheet['case'].name + '　／　' + it.audience + '向け' }),
          el('h1', { text: it.title }),
          el('div', { class: 'print-body', text: it.body })
        ]));
      });
      document.getElementById('main').appendChild(area);
      window.print();
      setTimeout(function () { area.remove(); }, 500);
      say(out, '印刷の画面を開きました（' + list.length + '枚）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('よくある問い合わせを、窓口回答標準化ツール（madoguchi-kaito）の台帳として書き出す', function (box) {
    box.appendChild(el('p', { text: '「よくある問い合わせ（LQ）」を、窓口・庁内問い合わせ 回答標準化ツールの標準回答台帳（JSON）にします。そのツールの「設定・データ」→「JSONを追加で取り込む」で足せます。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-madoguchi', text: '台帳のJSONを書き出す', onclick: function () {
      var data = A.toMadoguchi(UI.getSheet());
      if (!data.ledger.length) { say(out, 'よくある問い合わせ（LQ）がまだありません。', 'warn'); return; }
      UI.download('madoguchi-kaito-ledger-' + UI.getSheet()['case'].id + '.json', JSON.stringify(data, null, 2) + '\n', 'application/json');
      say(out, '書き出しました（' + data.ledger.length + '件）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.start('donyu');
})();
