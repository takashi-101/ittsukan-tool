/* 基本設計の道具：必要な機能（R）から、画面の下書きを作る */
(function () {
  'use strict';
  var UI = window.IttsukanUI, el = UI.el;

  UI.addTool('必要な機能から、画面の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '要件定義の工程票の「必要な機能（R）」のうち、優先度が「必須」「できれば」で、まだどの画面・帳票・外部とのやり取りにも出てこない機能ごとに、画面（SG）の下書きを1件ずつ足します。使う人や項目は、下書きを直して埋めてください。' }));
    var out = el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    box.appendChild(el('div', { class: 'button-row' }, [el('button', { type: 'button', class: 'secondary', id: 'tool-draft-screens', text: '画面の下書きを作る', onclick: function () {
      var yoken = UI.getRef('yoken');
      if (!yoken) { out.className = 'msg warn'; out.textContent = '先に「前の工程の工程票」で、要件定義の工程票を読み込んでください。'; return; }
      var sheet = UI.getSheet();
      var used = {};
      sheet.items.forEach(function (it) { if (['gamen', 'chohyo', 'gaibu'].indexOf(it.section) >= 0) (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = yoken.items.filter(function (r) { return r.section === 'kino' && (r.priority === '必須' || r.priority === 'できれば') && !used[r.id]; })
        .map(function (r) { return { section: 'gamen', title: r.title + 'の画面', purpose: r.detail || r.title, from: [r.id], note: '下書き（' + r.id + ' から作成）。使う人と項目を埋めてください。' }; });
      if (!drafts.length) { out.className = 'msg'; out.textContent = '下書きを作る機能はありません（必須・できれば の機能は、すべてどこかに出てきます）。'; return; }
      var ids = UI.addItems(drafts);
      out.className = 'msg ok'; out.textContent = '画面の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。';
    } })]));
    box.appendChild(out);
  });

  UI.start('kihon');
})();
