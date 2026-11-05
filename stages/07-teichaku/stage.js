/* 定着の道具：手順書の下書き、業務棚卸し・事務引継ぎ記録（gyomu-tanaoroshi）の形での書き出し */
(function () {
  'use strict';
  var UI = window.IttsukanUI, A = window.IttsukanAdapters, el = UI.el;

  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }

  UI.addTool('導入の手順から、手順書の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '導入の工程票の「現場へ渡す手順（LS）」のうち、まだ手順書（MP）が無い手順ごとに下書きを足します。課名・係名・頻度・手順を書き足してください。一度きりの準備で、手順書が要らないものは消してかまいません。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-draft-manuals', text: '手順書の下書きを作る', onclick: function () {
      var donyu = UI.getRef('donyu');
      if (!donyu) { say(out, '先に「前の工程の工程票」で、導入の工程票を読み込んでください。', 'warn'); return; }
      var used = {};
      UI.getSheet().items.forEach(function (it) { if (it.section === 'manual') (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = donyu.items.filter(function (s) { return s.section === 'tejun' && !used[s.id]; })
        .map(function (s) { return { section: 'manual', title: s.title, steps: s.detail || '', from: [s.id] }; });
      if (!drafts.length) { say(out, '下書きを作る手順はありません。'); return; }
      var ids = UI.addItems(drafts);
      say(out, '手順書の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('業務棚卸し・事務引継ぎ記録（gyomu-tanaoroshi）の形で書き出す', function (box) {
    box.appendChild(el('p', { text: '「手順書（MP）」を業務棚卸しの業務に、「判断の分かれ目と引継ぎ（MH）」をその業務の事務引継ぎ記録にして、業務棚卸しのJSONで書き出します。業務棚卸しのツールで「JSONを追加で取り込む」を使うと、今のデータを残したまま足せます。引継ぎの記録がある業務は「経験が要る」として書き出します。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-gyomu-export', text: '業務棚卸しのJSONを書き出す', onclick: function () {
      var data = A.toGyomu(UI.getSheet());
      if (!data.tasks.length) { say(out, '手順書（MP）がまだありません。', 'warn'); return; }
      UI.download('gyomu-tanaoroshi-' + UI.getSheet()['case'].id + '.json', JSON.stringify(data, null, 2) + '\n', 'application/json');
      var withHandover = data.tasks.filter(function (t) { return t.handover; }).length;
      say(out, '書き出しました（業務 ' + data.tasks.length + '件、うち事務引継ぎ記録つき ' + withHandover + '件）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.start('teichaku');
})();
