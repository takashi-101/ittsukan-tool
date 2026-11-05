/* 詳細設計の道具：データの型の下書き、AIに渡す仕様書、申請書類 記載漏れ確認ツール（shinsei-fubi-check）の設定の書き出し */
(function () {
  'use strict';
  var K = window.Ittsukan, UI = window.IttsukanUI, A = window.IttsukanAdapters, el = UI.el;

  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }

  UI.addTool('データ項目から、データの型の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '基本設計の工程票の「扱うデータ項目（SD）」のうち、まだ型（DT）が無い項目ごとに下書きを足します。型は空のままにするので、選んでください。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-draft-types', text: 'データの型の下書きを作る', onclick: function () {
      var kihon = UI.getRef('kihon');
      if (!kihon) { say(out, '先に「前の工程の工程票」で、基本設計の工程票を読み込んでください。', 'warn'); return; }
      var used = {};
      UI.getSheet().items.forEach(function (it) { if (it.section === 'kata') (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = kihon.items.filter(function (d) { return d.section === 'data' && !used[d.id]; })
        .map(function (d) { return { section: 'kata', title: d.title, detail: d.meaning || '', from: [d.id] }; });
      if (!drafts.length) { say(out, '下書きを作る項目はありません。'); return; }
      var ids = UI.addItems(drafts);
      say(out, 'データの型の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('AIに渡す仕様書（Markdown）を書き出す', function (box) {
    box.appendChild(el('p', { text: 'この工程票を、AIに試作を頼むときに渡せる仕様書（Markdown）にします。基本設計の工程票を読み込んでいれば、それも後ろに付けます。「書かれていないことは決めずに質問する」ようにAIへの断りを先頭に入れます。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-spec', text: '仕様書を書き出す', onclick: function () {
      var sheet = UI.getSheet();
      var kihon = UI.getRef('kihon');
      var hasFict = sheet.items.some(function (it) { return typeof it.basis_kind === 'string' && it.basis_kind.indexOf(K.FICTIONAL) >= 0; });
      var head = [
        '# 仕様書（AIに渡す用）：' + sheet['case'].name,
        '',
        '## AIへのお願い',
        '',
        '- この仕様書に書かれていないことは、決めずに「未決」として質問してください。',
        '- 選択肢が書かれていない項目で、自分で一つを選ばないでください。',
        '- 外部のサイトから部品を読み込まない作りにしてください。',
        hasFict ? '- 「' + K.FICTIONAL + '」と書いた決まりは、見本のための架空の基準です。そのまま使い、変えないでください。' : null,
        ''
      ].filter(function (x) { return x !== null; }).join('\n');
      var text = head + '\n' + K.toMarkdown(sheet) + (kihon ? '\n---\n\n' + K.toMarkdown(kihon) : '');
      UI.download('shiyosho-' + sheet['case'].id + '.md', text, 'text/markdown;charset=utf-8');
      say(out, '仕様書を書き出しました（shiyosho-' + sheet['case'].id + '.md）。実装の工程の「実装依頼文の下書き」でも同じ中身を使えます。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('入力チェックを、申請書類 記載漏れ確認ツール（shinsei-fubi-check）の設定として書き出す', function (box) {
    box.appendChild(el('p', { text: '「入力チェック（DV）」と「添付書類（DA）」を、申請書類 記載漏れ・添付漏れ確認ツールの「確認項目の設定」のJSONにします。そのツールの「JSONを追加で取り込む」で読み込むと、紙で受けた申請の確認にもそのまま使えます。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-shinsei', text: '設定のJSONを書き出す', onclick: function () {
      var r = A.toShinsei(UI.getSheet());
      UI.download('shinsei-fubi-check-settings-' + UI.getSheet()['case'].id + '.json', JSON.stringify(r.settings, null, 2) + '\n', 'application/json');
      var t = r.settings.types[0];
      say(out, '書き出しました（欄 ' + t.fields.length + '件・添付書類 ' + t.attachments.length + '件）。' + (r.warnings.length ? '注意：' + r.warnings.join('／') : ''), r.warnings.length ? 'warn' : 'ok');
    } }));
    box.appendChild(out);
  });

  UI.start('shosai');
})();
