/* 実装の道具：実装依頼文の下書き、試作の雛形（1ファイルのHTML）、エラーの文章からの原因候補（AIは使わない） */
(function () {
  'use strict';
  var K = window.Ittsukan, UI = window.IttsukanUI, el = UI.el;

  function str(v) { return v == null ? '' : String(v); }
  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }
  function bySection(sheet, sec) { return sheet.items.filter(function (it) { return it.section === sec; }); }
  function isFict(it) { return typeof it.basis_kind === 'string' && it.basis_kind.indexOf(K.FICTIONAL) >= 0; }

  /* ---------- 実装依頼文 ---------- */

  function buildPrompt(shosai, dp) {
    var lines = [];
    lines.push('次の仕様で「' + str(dp.title) + '」の試作を作ってください。');
    lines.push('');
    lines.push('きっかけ：' + (str(dp.trigger) || '（未記入）'));
    lines.push('手順：');
    str(dp.steps).split('\n').forEach(function (l) { if (l.trim()) lines.push('  ' + l.trim()); });
    var checks = bySection(shosai, 'check');
    if (checks.length) {
      lines.push('');
      lines.push('入力チェック：');
      checks.forEach(function (c) { lines.push('  - ' + c.title + '（' + c.required + '・' + c.format + (c.options ? '：' + c.options : '') + '）' + (c.rule ? ' ' + c.rule : '')); });
    }
    var atts = bySection(shosai, 'tenpu');
    if (atts.length) {
      lines.push('');
      lines.push('添付書類：');
      atts.forEach(function (a) { lines.push('  - ' + a.title + '（' + a.need + (a.need === '条件付き' ? '：' + a.cond_field + 'が「' + a.cond_values + '」のとき' : '') + '）'); });
    }
    var rules = bySection(shosai, 'kimari').filter(function (r) { return (dp.from || []).some(function (f) { return (r.from || []).indexOf(f) >= 0; }); });
    if (rules.length) {
      lines.push('');
      lines.push('判定の決まり：');
      rules.forEach(function (r) {
        lines.push('  - ' + r.title + (isFict(r) ? '【' + K.FICTIONAL + '。見本のための基準なので、このとおりに作り、変えないでください】' : ''));
        str(r.rule).split('\n').forEach(function (l) { if (l.trim()) lines.push('    ' + l.trim()); });
      });
    }
    var errs = bySection(shosai, 'error').filter(function (e) { return (e.from || []).indexOf(dp.id) >= 0; });
    if (errs.length) {
      lines.push('');
      lines.push('エラー時の扱い：');
      errs.forEach(function (e) { lines.push('  - ' + e.title + '：' + str(e.message) + (e.action ? '（' + e.action + '）' : '')); });
    }
    lines.push('');
    lines.push('作り方の決まり：');
    lines.push('  - 1ファイルのHTMLにしてください。外部のサイトから部品を読み込まないでください。');
    lines.push('  - この依頼に書いていないことは決めずに、「未決」として最後に一覧にしてください。');
    return {
      prompt: lines.join('\n'),
      from: [dp.id].concat(rules.map(function (r) { return r.id; }), errs.map(function (e) { return e.id; }))
    };
  }

  /* ---------- 試作の雛形（1ファイルのHTML） ---------- */

  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function buildScaffold(shosai) {
    var checks = bySection(shosai, 'check');
    var atts = bySection(shosai, 'tenpu');
    var fict = bySection(shosai, 'kimari').filter(isFict);
    var fields = checks.map(function (c, i) {
      var id = 'f' + (i + 1);
      var req = c.required === '必須';
      var label = '<label for="' + id + '">' + esc(c.title) + (req ? '（必須）' : '') + '</label>';
      var input;
      if (c.format === '選択肢') {
        input = '<select id="' + id + '" name="' + esc(c.title) + '"><option value="">選んでください</option>' +
          str(c.options).split(/[、,]/).map(function (o) { o = o.trim(); return o ? '<option>' + esc(o) + '</option>' : ''; }).join('') + '</select>';
      } else {
        var type = { '日付': 'date', '電話番号': 'tel', '数字のみ': 'text', '金額': 'text', '郵便番号': 'text' }[c.format] || 'text';
        input = '<input id="' + id + '" name="' + esc(c.title) + '" type="' + type + '"' + (c.format === '数字のみ' || c.format === '金額' ? ' inputmode="numeric"' : '') + '>';
      }
      return { id: id, html: '<div class="field">' + label + input + '</div>', title: c.title, required: req, format: c.format };
    });
    var attHtml = atts.map(function (a, i) {
      return '<label class="check"><input type="checkbox" id="a' + (i + 1) + '"> ' + esc(a.title) + '（' + esc(a.need) + (a.need === '条件付き' ? '：' + esc(a.cond_field) + 'が「' + esc(a.cond_values) + '」のとき' : '') + '）</label>';
    }).join('\n      ');
    var spec = {
      fields: fields.map(function (f) { return { id: f.id, title: f.title, required: f.required, format: f.format }; }),
      atts: atts.map(function (a, i) { return { id: 'a' + (i + 1), title: a.title, need: a.need, field: a.cond_field || '', values: str(a.cond_values).split(/[、,]/).map(function (v) { return v.trim(); }).filter(Boolean) }; })
    };
    return [
      '<!doctype html>',
      '<html lang="ja">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + esc(shosai['case'].name) + '（試作の雛形）</title>',
      '<style>',
      ':root { color-scheme: light dark; --bg:#fff; --fg:#1b1f24; --line:#c9ced6; --bad:#b3261e; --ok:#176b35; }',
      '@media (prefers-color-scheme: dark) { :root { --bg:#16191d; --fg:#e8ebef; --line:#3a414a; --bad:#ff9c94; --ok:#7fd49b; } }',
      'body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font-family:system-ui,sans-serif; line-height:1.7; }',
      'main { max-width:640px; margin:0 auto; } .field { margin-bottom:12px; } label { display:block; font-weight:600; }',
      'input, select { width:100%; box-sizing:border-box; font:inherit; padding:8px; min-height:44px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }',
      '.check { font-weight:400; } .check input { width:auto; min-height:0; } button { font:inherit; padding:8px 16px; min-height:44px; }',
      '#errors { color:var(--bad); } #done { color:var(--ok); } .note { border:1px solid var(--line); padding:8px; border-radius:8px; }',
      '</style>',
      '</head>',
      '<body>',
      '<main>',
      '  <h1>' + esc(shosai['case'].name) + '</h1>',
      '  <p class="note">これは一気通貫ツールの詳細設計の工程票から作った、試作の雛形です。画面の形と入力チェックだけで、どこにも送信・保存しません。' + (fict.length ? '判定の決まり（' + fict.map(function (r) { return esc(r.title); }).join('、') + '）は' + K.FICTIONAL + 'で、この雛形には入れていません。' : '') + '</p>',
      '  <form id="form" novalidate>',
      '      ' + fields.map(function (f) { return f.html; }).join('\n      '),
      atts.length ? '    <fieldset><legend>添付書類（付けたものに印）</legend>\n      ' + attHtml + '\n    </fieldset>' : '',
      '    <button type="submit">確かめる</button>',
      '  </form>',
      '  <div id="errors" role="alert"></div>',
      '  <p id="done" role="status"></p>',
      '</main>',
      '<script>',
      'var SPEC = ' + JSON.stringify(spec) + ';',
      'function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }',
      'function byTitle(t) { for (var i = 0; i < SPEC.fields.length; i++) if (SPEC.fields[i].title === t) return SPEC.fields[i]; return null; }',
      'function checkFormat(f, v) {',
      '  var h = v.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });',
      '  if (f.format === "電話番号" && !/^0\\d{9,10}$/.test(h.replace(/[-()（）\\s]/g, ""))) return "電話番号の書式を確かめてください（0で始まる10桁か11桁）";',
      '  if (f.format === "郵便番号" && !/^\\d{3}-?\\d{4}$/.test(h)) return "郵便番号は7桁で入れてください";',
      '  if (f.format === "数字のみ" && !/^\\d+$/.test(h)) return "数字だけで入れてください";',
      '  if (f.format === "金額" && !/^\\d[\\d,]*$/.test(h.replace(/円$/, ""))) return "金額は数字で入れてください";',
      '  return "";',
      '}',
      'document.getElementById("form").addEventListener("submit", function (e) {',
      '  e.preventDefault();',
      '  var errors = [];',
      '  SPEC.fields.forEach(function (f) {',
      '    var v = val(f.id);',
      '    if (!v) { if (f.required) errors.push(f.title + "を入れてください"); return; }',
      '    var m = checkFormat(f, v); if (m) errors.push(f.title + "：" + m);',
      '  });',
      '  SPEC.atts.forEach(function (a) {',
      '    var need = a.need === "必須" || (a.need === "条件付き" && byTitle(a.field) && a.values.indexOf(val(byTitle(a.field).id)) >= 0);',
      '    if (need && !document.getElementById(a.id).checked) errors.push(a.title + "が添付されていません" + (a.need === "条件付き" ? "（" + a.field + "が「" + val(byTitle(a.field).id) + "」のため必要です）" : ""));',
      '  });',
      '  var box = document.getElementById("errors");',
      '  box.innerHTML = errors.length ? "<ul>" + errors.map(function (x) { return "<li>" + x.replace(/</g, "&lt;") + "</li>"; }).join("") + "</ul>" : "";',
      '  document.getElementById("done").textContent = errors.length ? "" : "入力チェックをすべて通りました（試作のため、どこにも送信していません）。";',
      '});',
      '</script>',
      '</body>',
      '</html>',
      ''
    ].filter(function (x) { return x !== ''; }).join('\n') + '\n';
  }

  /* ---------- エラーの文章から原因の候補（決まった表で引く。AIは使わない） ---------- */

  var ERROR_TABLE = [
    { re: /Cannot read propert(y|ies) of (null|undefined)|is null|null has no properties/i,
      causes: ['getElementById などに渡した名前が、画面の欄の id と違う', 'スクリプトが、画面の欄ができる前に動いている', 'まだ値の入っていない変数を使っている'],
      howto: ['エラーの行に出てくる名前で、HTMLの中を検索し、同じ id があるか確かめる', 'script の位置が </body> の直前にあるか確かめる', 'console.log でその変数の中身を出して確かめる'] },
    { re: /is not defined|ReferenceError/i,
      causes: ['関数や変数の名前の書き間違い（大文字・小文字の違いを含む）', 'その関数を定義したファイルを読み込んでいない、または読み込む順番が後ろ'],
      howto: ['エラーに出た名前でファイルの中を検索し、定義している場所があるか確かめる', 'script の読み込みの順番を確かめる'] },
    { re: /is not a function/i,
      causes: ['関数ではないもの（文字や数）を、関数として呼んでいる', '名前の書き間違い、または同じ名前の変数で関数を上書きしている'],
      howto: ['console.log(typeof 名前) で、function と出るか確かめる', '同じ名前を2回定義していないか検索する'] },
    { re: /Unexpected token\s*'?</i,
      causes: ['JavaScriptのファイルの代わりに、HTML（「見つかりません」の画面など）を読み込んでいる', 'script の src のファイル名が違う'],
      howto: ['開発者ツールのネットワークの欄で、そのファイルの中身がHTMLになっていないか確かめる', 'src のファイル名と、置いたファイルの名前を見比べる'] },
    { re: /SyntaxError|Unexpected (token|end of input|identifier)|missing \)/i,
      causes: ['かっこ・引用符の閉じ忘れ、またはカンマの抜け', '全角の記号（「（」「，」など）がプログラムの中に入っている'],
      howto: ['エラーの行と、その前の行のかっこと引用符の数を数える', '全角の記号を検索して半角に直す'] },
    { re: /JSON\.parse|in JSON at position|Unexpected token .* JSON|not valid JSON/i,
      causes: ['読み込んだ文字がJSONの形になっていない（説明文が混ざっている、途中で切れている）', 'ファイルの先頭にBOM（目に見えない印）が付いている'],
      howto: ['読み込もうとした文字を、そのまま画面に出して形を確かめる', '先頭のBOMを取り除いてから読む（text.replace(/^\\uFEFF/, "")）'] },
    { re: /CORS|Access-Control-Allow-Origin|blocked by CORS/i,
      causes: ['接続先のサーバーが、ブラウザからの接続を許していない', 'ファイルを直接開いている（file://）ため、接続先から許されていない'],
      howto: ['接続先の設定で、ブラウザからの接続を許す設定（LM Studio なら「Enable CORS」）があるか確かめる', 'ローカルのサーバー（python -m http.server など）で開き直して確かめる'] },
    { re: /Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED|net::ERR/i,
      causes: ['接続先のサーバーが起動していない', '接続先のURL（ポートの番号を含む）が違う'],
      howto: ['接続先のURLをブラウザで直接開き、応答があるか確かめる', 'サーバーの起動の画面やコマンドの出力に、エラーが出ていないか確かめる'] },
    { re: /\b404\b|Not Found/i,
      causes: ['ファイルの場所（パス）やファイル名が違う', '大文字・小文字の違い（公開先のサーバーでは区別される）'],
      howto: ['開発者ツールのネットワークの欄で、どのURLが404になっているか確かめる', 'そのURLとフォルダの中のファイル名を見比べる'] },
    { re: /QuotaExceeded|localStorage/i,
      causes: ['ブラウザの保存領域がいっぱい、またはプライベートの窓で保存が許されていない'],
      howto: ['普通の窓で開き直す', '保存するデータを小さくするか、ファイルとして書き出す形にする'] }
  ];

  function diagnose(text) {
    var hits = ERROR_TABLE.filter(function (r) { return r.re.test(text); });
    if (!hits.length) return null;
    var causes = [], howto = [];
    hits.forEach(function (h) {
      h.causes.forEach(function (c) { if (causes.indexOf(c) < 0) causes.push(c); });
      h.howto.forEach(function (c) { if (howto.indexOf(c) < 0) howto.push(c); });
    });
    var num = function (list) { return list.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'); };
    return { causes: num(causes), howto: num(howto) };
  }

  window.IttsukanJisso = { buildPrompt: buildPrompt, buildScaffold: buildScaffold, diagnose: diagnose };

  /* ---------- 画面の道具 ---------- */

  UI.addTool('詳細設計から、実装依頼文の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '詳細設計の工程票の「処理の手順（DP）」のうち、まだ依頼文に入っていない処理ごとに、AIへの実装依頼文（IP）の下書きを足します。入力チェック・添付書類・判定の決まり・エラー時の扱いも入れます。依頼文をコピーして、普段使っているAIアプリに渡してください。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-draft-prompts', text: '実装依頼文の下書きを作る', onclick: function () {
      var shosai = UI.getRef('shosai');
      if (!shosai) { say(out, '先に「前の工程の工程票」で、詳細設計の工程票を読み込んでください。', 'warn'); return; }
      var used = {};
      UI.getSheet().items.forEach(function (it) { if (it.section === 'irai') (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = bySection(shosai, 'shori').filter(function (dp) { return !used[dp.id]; }).map(function (dp) {
        var p = buildPrompt(shosai, dp);
        return { section: 'irai', title: dp.title + 'の試作の依頼', prompt: p.prompt, status: '下書き', from: p.from };
      });
      if (!drafts.length) { say(out, '下書きを作る処理はありません（すべての処理の手順が、どこかの依頼文に入っています）。'); return; }
      var ids = UI.addItems(drafts);
      say(out, '実装依頼文の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('試作の雛形（1ファイルのHTML）を書き出す', function (box) {
    box.appendChild(el('p', { text: '詳細設計の工程票の「入力チェック（DV）」と「添付書類（DA）」から、画面の形と入力チェックだけの1ファイルのHTMLを作ります。ブラウザで開くだけで動き、どこにも送信しません。AIに試作を頼むときの、たたき台にもなります。' }));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-scaffold', text: '雛形を書き出す', onclick: function () {
      var shosai = UI.getRef('shosai');
      if (!shosai) { say(out, '先に「前の工程の工程票」で、詳細設計の工程票を読み込んでください。', 'warn'); return; }
      if (!bySection(shosai, 'check').length) { say(out, '詳細設計の工程票に、入力チェック（DV）がありません。', 'warn'); return; }
      var name = 'hinagata-' + shosai['case'].id + '.html';
      UI.download(name, buildScaffold(shosai), 'text/html;charset=utf-8');
      var exists = bySection(UI.getSheet(), 'hinagata').some(function (it) { return it.file === name; });
      var ids = exists ? [] : UI.addItems([{ section: 'hinagata', title: '入力チェックの雛形', file: name, note: '「試作の雛形を書き出す」で作成。', from: bySection(shosai, 'check').map(function (c) { return c.id; }) }]);
      say(out, '雛形を書き出しました（' + name + '）。' + (ids.length ? '試作の雛形（' + ids[0] + '）として記録しました。' : ''), 'ok');
    } }));
    box.appendChild(out);
  });

  UI.addTool('エラーの文章から、原因の候補と確かめ方を出す', function (box) {
    box.appendChild(el('p', { text: 'ブラウザの開発者ツールなどに出たエラーの文章を貼り付けてください。よくあるエラーの表から、原因の候補と確かめ方を出します（AIは使いません）。' }));
    var ta = el('textarea', { id: 'tool-error-text', rows: 3, placeholder: "例：Uncaught TypeError: Cannot read properties of null (reading 'value')" });
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'tool-error-text', text: 'エラーの文章' }), ta]));
    var out = status();
    box.appendChild(el('button', { type: 'button', class: 'secondary', id: 'tool-diagnose', text: '原因の候補を出す', onclick: function () {
      var text = ta.value.trim();
      if (!text) { say(out, 'エラーの文章を貼り付けてください。', 'warn'); return; }
      var d = diagnose(text);
      if (!d) { say(out, '表に当てはまるエラーがありませんでした。エラーの文章と、そのとき何をしたかを、普段使っているAIアプリに聞いてみてください。', 'warn'); return; }
      var ids = UI.addItems([{ section: 'error', title: text, causes: d.causes, howto: d.howto, state: '調べ中' }]);
      ta.value = '';
      say(out, '原因の候補と確かめ方を ' + ids[0] + ' に記録しました。確かめた結果に合わせて、状態を直してください。', 'ok');
    } }));
    box.appendChild(out);
  });

  UI.start('jisso');
})();
