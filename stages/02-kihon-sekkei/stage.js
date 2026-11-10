/*
 * 基本設計の道具
 *  1. 必要な機能（R）から、画面の下書きを作る
 *  2. 画面・帳票の項目から、扱うデータ項目の下書きを作る
 *  3. 画面・帳票の形を、下書きで見る（A4で印刷できる）
 *  4. 機能と、画面・帳票・外部とのやり取りの対応表を見る
 * どれも決まりで動く（AIは使わない）。どこにも通信しない。
 */
(function () {
  'use strict';
  var UI = window.IttsukanUI, el = UI.el;

  function status() { return el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' }); }
  function say(p, text, kind) { p.className = 'msg' + (kind ? ' ' + kind : ''); p.textContent = text; }
  function str(v) { return v == null ? '' : String(v); }
  function bySection(sheet, sec) { return sheet.items.filter(function (it) { return it.section === sec; }); }

  /* ---------- 決まり（画面を持たない部分。テストからも呼ぶ） ---------- */

  /** 「表示・入力する項目」「載せる項目」を、項目名の一覧にする（読点・カンマ・改行で区切る） */
  function splitItems(text) {
    var seen = {}, out = [];
    str(text).split(/[、,，\n]/).forEach(function (s) {
      var t = s.replace(/^[\s・\-]+/, '').trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    });
    return out;
  }

  /* 個人情報に当たりそうな語。当たらないとは決めない（決めるのは人） */
  var PERSONAL_WORDS = ['氏名', '名前', '宛名', '住所', '電話', 'メール', '生年月日', '年齢', '性別', '続柄', '世帯', '勤務先',
    '就労', '収入', '所得', '口座', '個人番号', 'マイナンバー', '障害', '疾病', '病', '介護', 'ひとり親', '利用の理由'];
  function guessPersonal(name) {
    for (var i = 0; i < PERSONAL_WORDS.length; i++) if (name.indexOf(PERSONAL_WORDS[i]) >= 0) return '当たる';
    return '分からない';
  }

  /** 画面・帳票の項目のうち、まだ「扱うデータ項目（SD）」に無いものの下書き */
  function draftDataItems(sheet) {
    var have = {};
    bySection(sheet, 'data').forEach(function (it) { have[str(it.title).trim()] = true; });
    var drafts = [];
    sheet.items.forEach(function (it) {
      if (it.section !== 'gamen' && it.section !== 'chohyo') return;
      splitItems(it.items).forEach(function (name) {
        if (have[name]) return;
        have[name] = true;
        drafts.push({ section: 'data', title: name, personal: guessPersonal(name), from: [it.id],
          note: '下書き（' + it.id + ' の項目から作成）。意味・例と、個人情報に当たるかを確かめてください。' });
      });
    });
    return drafts;
  }

  /* 一覧の形にする画面・帳票の目印 */
  var LIST_WORDS = ['一覧', '受付簿', '台帳', '名簿', '順位'];
  function isList(it) {
    var t = str(it.title) + ' ' + str(it.purpose);
    for (var i = 0; i < LIST_WORDS.length; i++) if (t.indexOf(LIST_WORDS[i]) >= 0) return true;
    return false;
  }

  /* 「この画面でできること」の言葉から、ボタンの下書きを選ぶ */
  var BUTTON_RULES = [
    ['申し込', '申し込む'], ['登録', '登録する'], ['保存', '保存する'], ['絞り込', '絞り込む'], ['検索', '検索する'],
    ['CSV', 'CSVで書き出す'], ['印刷', '印刷する'], ['計算', '計算する'], ['通知書', '通知書を作る'], ['直す', '戻って直す']
  ];
  function buttonsOf(it) {
    var p = str(it.purpose), out = [];
    BUTTON_RULES.forEach(function (r) { if (p.indexOf(r[0]) >= 0 && out.indexOf(r[1]) < 0) out.push(r[1]); });
    return out;
  }

  /** 項目の入力欄の種類。データ項目（SD）の「意味・例」に選択肢が書いてあれば、選ぶ欄にする */
  function fieldOf(name, dataByTitle) {
    var d = dataByTitle[name];
    var meaning = d ? str(d.meaning) : '';
    var personal = d ? str(d.personal) : '';
    var f = { label: name, type: 'text', options: [], personal: personal, known: !!d };
    if (/添付|ファイル|写真/.test(name) && !/有無|足りない|不足|一覧/.test(name)) { f.type = 'file'; return f; }
    if (/^はい・いいえ$/.test(meaning) || /か$/.test(name) && /はい|いいえ/.test(meaning)) { f.type = 'choice'; f.options = ['はい', 'いいえ']; return f; }
    if (!/^例[：:]/.test(meaning) && /[・、]/.test(meaning) && meaning.length <= 40 && !/[。（(]/.test(meaning)) {
      f.type = 'choice'; f.options = meaning.split(/[・、]/).map(function (s) { return s.trim(); }).filter(Boolean); return f;
    }
    if (/日$|年月日|期限/.test(name)) { f.type = 'date'; return f; }
    if (/時間|点数|件数|金額|人数|順位|順番/.test(name)) { f.type = 'number'; return f; }
    if (/理由と|内容|備考|メモ/.test(name)) { f.type = 'long'; return f; }
    return f;
  }

  /** 画面（SG）・帳票（SC）1件の「形」。kind は form（入力の形）・list（一覧の形）・sheet（1枚の書類の形） */
  function shapeOf(it, sheet) {
    var dataByTitle = {};
    bySection(sheet, 'data').forEach(function (d) { dataByTitle[str(d.title).trim()] = d; });
    var names = splitItems(it.items);
    var fields = names.map(function (n) { return fieldOf(n, dataByTitle); });
    var kind = isList(it) ? 'list' : (it.section === 'chohyo' ? 'sheet' : 'form');
    return { id: it.id, title: str(it.title), section: it.section, kind: kind, who: str(it.section === 'chohyo' ? it.to : it.user),
      purpose: str(it.purpose), fields: fields, buttons: it.section === 'gamen' ? buttonsOf(it) : [], from: it.from || [] };
  }

  /** 機能（R）ごとに、出てくる画面・帳票・外部とのやり取りを並べる */
  function coverageRows(yoken, sheet) {
    var where = {};
    sheet.items.forEach(function (it) {
      if (['gamen', 'chohyo', 'gaibu'].indexOf(it.section) < 0) return;
      (it.from || []).forEach(function (r) { (where[r] = where[r] || []).push(it); });
    });
    return yoken.items.filter(function (r) { return r.section === 'kino'; }).map(function (r) {
      var list = where[r.id] || [];
      var state = list.length ? '出てくる' : (r.priority === '必須' ? '要対応' : (r.priority === '今回は見送り' ? '見送り' : '未対応'));
      return { id: r.id, title: str(r.title), priority: str(r.priority), places: list, state: state };
    });
  }

  /** どの機能にもつながっていない画面・帳票・外部とのやり取り */
  function orphans(sheet) {
    return sheet.items.filter(function (it) {
      return ['gamen', 'chohyo', 'gaibu'].indexOf(it.section) >= 0 && !(it.from || []).some(function (r) { return /^R-\d+$/.test(r); });
    });
  }

  window.IttsukanKihon = { splitItems: splitItems, guessPersonal: guessPersonal, draftDataItems: draftDataItems,
    shapeOf: shapeOf, coverageRows: coverageRows, orphans: orphans };

  /* ---------- 形の下書きを描く（見た目は style 属性を使わず、要素の style に直接入れる） ---------- */

  function css(node, props) { Object.keys(props).forEach(function (k) { node.style[k] = props[k]; }); return node; }

  function mockInput(f) {
    var box;
    if (f.type === 'choice') {
      box = el('div', {}, f.options.map(function (o) {
        return css(el('span', { text: '○ ' + o }), { display: 'inline-block', marginRight: '14px' });
      }));
      return box;
    }
    var hint = { text: '', date: '年　　月　　日', number: '数', file: 'ファイルを選ぶ', long: '' }[f.type] || '';
    box = css(el('div', { text: hint, class: 'muted' }), {
      border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--surface)', padding: '4px 8px',
      minHeight: f.type === 'long' ? '64px' : '34px', maxWidth: f.type === 'number' || f.type === 'date' ? '220px' : 'none'
    });
    if (f.type === 'file') css(box, { borderStyle: 'dashed', maxWidth: '260px' });
    return box;
  }

  function personalMark(f) {
    if (f.personal === '当たる') return el('span', { class: 'refchip', text: '個人情報' });
    if (!f.known) return el('span', { class: 'refchip', text: 'データ項目に未登録' });
    return null;
  }

  function drawShape(sh) {
    var block = css(el('article', { class: 'wire-block', 'data-wire': sh.id, 'data-kind': sh.kind }), {
      border: '2px solid var(--line)', borderRadius: '10px', background: 'var(--surface-2)', margin: '0 0 16px', overflow: 'hidden'
    });
    var kindName = { form: '入力の形', list: '一覧の形', sheet: '1枚の書類の形' }[sh.kind];
    block.appendChild(css(el('div', {}, [
      el('span', { class: 'idchip', text: sh.id }),
      el('strong', { text: '　' + sh.title }),
      el('span', { class: 'muted small', text: '　' + (sh.section === 'chohyo' ? '渡す相手：' : '使う人：') + (sh.who || '（未記入）') + '　／　' + kindName })
    ]), { borderBottom: '2px solid var(--line)', padding: '8px 12px', background: 'var(--surface)' }));
    var body = css(el('div', {}), { padding: '12px' });
    if (sh.purpose) body.appendChild(el('p', { class: 'muted small', text: sh.purpose }));
    if (!sh.fields.length) {
      body.appendChild(el('p', { class: 'msg warn', text: '項目がまだ書かれていません。「表示・入力する項目」（帳票は「載せる項目」）に、読点で区切って書くと形が出ます。' }));
    } else if (sh.kind === 'list') {
      var head = el('tr', {}, sh.fields.map(function (f) { return el('th', { scope: 'col' }, [f.label, ' ', personalMark(f)]); }));
      var rows = [0, 1, 2].map(function () { return el('tr', {}, sh.fields.map(function () { return el('td', { text: '…' }); })); });
      body.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'tbl' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]));
    } else if (sh.kind === 'sheet') {
      var paper = css(el('div', {}), { background: 'var(--surface)', border: '1px solid var(--line)', padding: '16px', maxWidth: '520px' });
      paper.appendChild(css(el('p', { text: sh.title }), { textAlign: 'center', fontWeight: '700', fontSize: '1.1rem', margin: '0 0 10px' }));
      sh.fields.forEach(function (f) {
        paper.appendChild(css(el('p', {}, [f.label + '：', css(el('span', { text: '　' }), { display: 'inline-block', minWidth: '180px', borderBottom: '1px solid var(--line)' }), ' ', personalMark(f)]), { margin: '6px 0' }));
      });
      body.appendChild(paper);
    } else {
      sh.fields.forEach(function (f) {
        body.appendChild(css(el('div', {}, [
          css(el('div', {}, [el('strong', { text: f.label }), ' ', personalMark(f)]), { marginBottom: '2px' }),
          mockInput(f)
        ]), { margin: '0 0 10px' }));
      });
    }
    if (sh.buttons.length) {
      body.appendChild(css(el('div', {}, sh.buttons.map(function (b) {
        return css(el('span', { text: b }), { display: 'inline-block', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '8px', padding: '4px 14px', marginRight: '8px', fontWeight: '600' });
      })), { marginTop: '12px' }));
    }
    block.appendChild(body);
    return block;
  }

  function shapes() {
    var sheet = UI.getSheet();
    return sheet.items.filter(function (it) { return it.section === 'gamen' || it.section === 'chohyo'; })
      .map(function (it) { return shapeOf(it, sheet); });
  }

  /* ---------- 道具 ---------- */

  UI.addTool('必要な機能から、画面の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '要件定義の工程票の「必要な機能（R）」のうち、優先度が「必須」「できれば」で、まだどの画面・帳票・外部とのやり取りにも出てこない機能ごとに、画面（SG）の下書きを1件ずつ足します。使う人や項目は、下書きを直して埋めてください。' }));
    var out = status();
    box.appendChild(el('div', { class: 'button-row' }, [el('button', { type: 'button', class: 'secondary', id: 'tool-draft-screens', text: '画面の下書きを作る', onclick: function () {
      var yoken = UI.getRef('yoken');
      if (!yoken) { say(out, '先に「前の工程の工程票」で、要件定義の工程票を読み込んでください。', 'warn'); return; }
      var sheet = UI.getSheet();
      var used = {};
      sheet.items.forEach(function (it) { if (['gamen', 'chohyo', 'gaibu'].indexOf(it.section) >= 0) (it.from || []).forEach(function (r) { used[r] = true; }); });
      var drafts = yoken.items.filter(function (r) { return r.section === 'kino' && (r.priority === '必須' || r.priority === 'できれば') && !used[r.id]; })
        .map(function (r) { return { section: 'gamen', title: r.title + 'の画面', purpose: r.detail || r.title, from: [r.id], note: '下書き（' + r.id + ' から作成）。使う人と項目を埋めてください。' }; });
      if (!drafts.length) { say(out, '下書きを作る機能はありません（必須・できれば の機能は、すべてどこかに出てきます）。'); return; }
      var ids = UI.addItems(drafts);
      say(out, '画面の下書きを' + ids.length + '件足しました（' + ids.join('、') + '）。', 'ok');
    } })]));
    box.appendChild(out);
  });

  UI.addTool('画面・帳票の項目から、扱うデータ項目の下書きを作る', function (box) {
    box.appendChild(el('p', { text: '画面の「表示・入力する項目」と帳票の「載せる項目」に読点で区切って書いた項目のうち、まだ「扱うデータ項目（SD）」に無いものを、下書きとして足します。氏名・住所・電話番号などの語を含む項目は「個人情報に当たる」、それ以外は「分からない」で入れます。「当たらない」と決めるのは人です。' }));
    var out = status();
    box.appendChild(el('div', { class: 'button-row' }, [el('button', { type: 'button', class: 'secondary', id: 'tool-draft-data', text: 'データ項目の下書きを作る', onclick: function () {
      var drafts = draftDataItems(UI.getSheet());
      if (!drafts.length) { say(out, '足す項目はありません（画面・帳票の項目は、すべてデータ項目にあります）。'); return; }
      var ids = UI.addItems(drafts);
      var unsure = drafts.filter(function (d) { return d.personal === '分からない'; }).length;
      say(out, 'データ項目の下書きを' + ids.length + '件足しました（' + ids[0] + '〜' + ids[ids.length - 1] + '）。個人情報に当たるかが「分からない」のものが' + unsure + '件あります。', 'ok');
    } })]));
    box.appendChild(out);
  });

  UI.addTool('画面・帳票の形を、下書きで見る（A4で印刷できる）', function (box) {
    box.appendChild(el('p', { text: '画面（SG）と帳票（SC）に書いた項目から、形の下書きを描きます。名前に「一覧」「受付簿」などを含むものは一覧の形、帳票は1枚の書類の形、それ以外は入力の形にします。入力欄の種類は、データ項目（SD）の「意味・例」と項目名から決まりで選びます。打合せで見せて、足りない項目や並びを確かめるための下書きです。' }));
    var out = status();
    var area = el('div', { id: 'tool-wire-area' });
    box.appendChild(el('div', { class: 'button-row' }, [
      el('button', { type: 'button', class: 'secondary', id: 'tool-wire', text: '形の下書きを表示する', onclick: function () {
        var list = shapes();
        area.textContent = '';
        if (!list.length) { say(out, '画面（SG）も帳票（SC）もまだありません。', 'warn'); return; }
        list.forEach(function (sh) { area.appendChild(drawShape(sh)); });
        var empty = list.filter(function (sh) { return !sh.fields.length; }).length;
        say(out, '画面と帳票の形を' + list.length + '件描きました。' + (empty ? '項目がまだ無いものが' + empty + '件あります。' : ''), empty ? 'warn' : 'ok');
      } }),
      el('button', { type: 'button', class: 'secondary', id: 'tool-wire-print', text: '形の下書きを印刷する', onclick: function () {
        var list = shapes();
        if (!list.length) { say(out, '画面（SG）も帳票（SC）もまだありません。', 'warn'); return; }
        var sheet = UI.getSheet();
        var pa = el('section', { class: 'card print-target', id: 'print-area' });
        list.forEach(function (sh, i) {
          pa.appendChild(el('article', { class: i ? 'print-page page-break' : 'print-page' }, [
            el('p', { class: 'muted', text: sheet['case'].name + '　／　基本設計　形の下書き（' + (i + 1) + '／' + list.length + '）' }),
            drawShape(sh)
          ]));
        });
        document.getElementById('main').appendChild(pa);
        window.print();
        setTimeout(function () { pa.remove(); }, 500);
        say(out, '印刷の画面を開きました（' + list.length + '枚）。PDFにするときは、印刷の画面で「PDFに保存」を選びます。', 'ok');
      } })
    ]));
    box.appendChild(out);
    box.appendChild(area);
  });

  UI.addTool('機能と、画面・帳票・外部とのやり取りの対応表を見る', function (box) {
    box.appendChild(el('p', { text: '要件定義の「必要な機能（R）」ごとに、どの画面・帳票・外部とのやり取りに出てくるかを表にします。どこにも出てこない必須の機能と、どの機能にもつながっていない画面・帳票を知らせます。' }));
    var out = status();
    var area = el('div', { id: 'tool-matrix-area' });
    box.appendChild(el('div', { class: 'button-row' }, [el('button', { type: 'button', class: 'secondary', id: 'tool-matrix', text: '対応表を表示する', onclick: function () {
      var yoken = UI.getRef('yoken');
      area.textContent = '';
      if (!yoken) { say(out, '先に「前の工程の工程票」で、要件定義の工程票を読み込んでください。', 'warn'); return; }
      var sheet = UI.getSheet();
      var rows = coverageRows(yoken, sheet);
      var lost = orphans(sheet);
      var tbody = el('tbody', {}, rows.map(function (r) {
        var places = r.places.length
          ? el('td', {}, r.places.map(function (p) { return el('div', {}, [el('span', { class: 'refchip', text: p.id }), ' ' + str(p.title)]); }))
          : el('td', { text: r.state === '要対応' ? 'どこにも出てきません（要対応）' : (r.state === '見送り' ? '（今回は見送り）' : 'どこにも出てきません') });
        return el('tr', { 'data-state': r.state }, [
          el('th', { scope: 'row' }, [el('span', { class: 'idchip', text: r.id }), ' ' + r.title]),
          el('td', { text: r.priority }), places
        ]);
      }));
      area.appendChild(el('div', { class: 'table-wrap' }, [el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: '必要な機能' }), el('th', { scope: 'col', text: '優先度' }), el('th', { scope: 'col', text: '出てくる画面・帳票・外部とのやり取り' })])]),
        tbody
      ])]));
      if (lost.length) {
        area.appendChild(el('p', { class: 'msg warn', id: 'tool-matrix-orphans', text: 'どの機能にもつながっていないもの：' + lost.map(function (it) { return it.id + ' ' + str(it.title); }).join('、') + '。「もとになった項目」に機能（R）の番号を書くか、要らなければ消してください。' }));
      }
      var must = rows.filter(function (r) { return r.state === '要対応'; }).length;
      say(out, '機能' + rows.length + '件を表にしました。どこにも出てこない必須の機能は' + must + '件、機能につながっていない画面・帳票などは' + lost.length + '件です。', must || lost.length ? 'warn' : 'ok');
    } })]));
    box.appendChild(out);
    box.appendChild(area);
  });

  UI.start('kihon');
})();
