/* テストの道具：確認項目の下書き、自分のAIアプリでの食い違いの判定、AIが決めたことチェック（ai-decision-audit）の形での書き出し */
(function () {
  'use strict';
  var UI = window.IttsukanUI, A = window.IttsukanAdapters, el = UI.el;

  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }
  function trItems() { return UI.getSheet().items.filter(function (it) { return it.section === 'taisho'; }); }

  function trSelect(id) {
    var sel = el('select', { id: id });
    function fill() {
      var cur = sel.value;
      sel.textContent = '';
      var list = trItems();
      if (!list.length) sel.appendChild(el('option', { value: '', text: '（先に「依頼と出力（TR）」を追加してください）' }));
      list.forEach(function (t) { sel.appendChild(el('option', { value: t.id, text: t.id + ' ' + t.title })); });
      if (cur) sel.value = cur;
    }
    sel.addEventListener('focus', fill);
    fill();
    sel.refill = fill;
    return sel;
  }

  UI.addTool('必要な機能から、確認項目の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '要件定義の工程票の「必要な機能（R）」のうち、優先度が「必須」「できれば」で、まだ確認項目（TC）が無い機能ごとに下書きを足します。合格の条件には、機能の内容を入れておきます。確かめ方は書き足してください。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-draft-cases', text: '確認項目の下書きを作る', onclick: function () {
      var yoken = UI.getRef('yoken');
      if (!yoken) { say(out, '先に「前の工程の工程票」で、要件定義の工程票を読み込んでください。', 'warn'); return; }
      var used = {};
      UI.getSheet().items.forEach(function (it) { if (it.section === 'kakunin') (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = yoken.items.filter(function (r) { return r.section === 'kino' && (r.priority === '必須' || r.priority === 'できれば') && !used[r.id]; })
        .map(function (r) { return { section: 'kakunin', title: r.title, expected: r.detail || r.title, result: '未実施', from: [r.id] }; });
      if (!drafts.length) { say(out, '下書きを作る機能はありません。'); return; }
      var ids = UI.addItems(drafts);
      say(out, '確認項目の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。確かめ方を書き足してください。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('自分のAIアプリで、依頼と出力の食い違いを判定する（追加の料金はかかりません）', function (box) {
    box.appendChild(el('p', { text: '「依頼と出力（TR）」を選んで判定の依頼文を作り、普段使っているAIアプリ（Claude Desktop、LM Studio など）に貼り付けます。返ってきた返答を下の欄に貼り付けると、食い違いの印（TM）として足します。この画面からはどこにも送信しません。印は人が「採る・採らない」を選びます。' }));
    var sel = trSelect('tool-tr');
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'tool-tr', text: '対象の依頼と出力' }), sel]));
    var prompt = el('textarea', { id: 'tool-audit-prompt', rows: 5, readonly: true, class: 'output-box' });
    var promptWrap = el('div', { class: 'field', hidden: true }, [el('label', { for: 'tool-audit-prompt', text: '判定の依頼文（AIアプリに貼り付ける）' }), prompt]);
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-audit-make', text: '判定の依頼文を作る', onclick: function () {
      var tr = UI.getSheet().items.filter(function (t) { return t.id === sel.value; })[0];
      if (!tr) { say(out, '先に「依頼と出力（TR）」を追加して選んでください。', 'warn'); return; }
      prompt.value = A.auditPrompt(tr.request, tr.output);
      promptWrap.hidden = false;
      var done = function (ok) { say(out, ok ? '判定の依頼文をコピーしました。AIアプリに貼り付けて送り、返答を下の欄に貼り付けてください。' : '判定の依頼文を作りました。欄の中を全部選んでコピーしてください。', 'ok'); };
      try { navigator.clipboard.writeText(prompt.value).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    } }));
    box.appendChild(promptWrap);
    var answer = el('textarea', { id: 'tool-audit-answer', rows: 4, placeholder: '{"marks":[ … ]} の形の返答を、そのまま貼り付けてください。' });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'tool-audit-answer', text: 'AIアプリの返答' }), answer]));
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-audit-load', text: '返答を読み込んで印を足す', onclick: function () {
      if (!sel.value) { say(out, '対象の依頼と出力を選んでください。', 'warn'); return; }
      var r = A.fromAuditAnswer(answer.value, sel.value);
      if (!r.items.length) { say(out, '印を足せませんでした。' + (r.errors.length ? r.errors.join('／') : '返答に印がありませんでした。'), r.errors.length ? 'bad' : 'warn'); return; }
      var ids = UI.addItems(r.items);
      answer.value = '';
      say(out, '食い違いの印を' + ids.length + '件足しました（' + ids.join('、') + '）。' + (r.errors.length ? '形の合わない' + r.errors.length + '件は除きました。' : '') + '印ごとに「採る・採らない」を選んでください。', r.errors.length ? 'warn' : 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('AIが決めたことチェック（ai-decision-audit）の形で書き出す', function (box) {
    box.appendChild(el('p', { text: '「依頼と出力」1件と、その印を、AIが決めたことチェックの記録（JSON）と同じ形で書き出します。AIが決めたことチェックで開くときは、依頼文と出力を貼り付け、このファイルの中身を「AIアプリの返答」の欄に貼り付けて読み込みます。' }));
    var sel = trSelect('tool-tr-export');
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'tool-tr-export', text: '書き出す依頼と出力' }), sel]));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-audit-export', text: 'JSONで書き出す', onclick: function () {
      try {
        var rec = A.toAudit(UI.getSheet(), sel.value);
        UI.download('ai-decision-audit-' + sel.value + '.json', JSON.stringify(rec, null, 2) + '\n', 'application/json');
        say(out, '書き出しました（印 ' + rec.marks.length + '件）。', 'ok');
      } catch (e) { say(out, e.message, 'warn'); }
    } }));
    box.appendChild(out);
  });

  UI.start('test');
})();
