/*
 * 一気通貫ツール — 工程の画面（どの工程も同じ部品で作る）
 * 画面の言葉は schema.json から作る。工程ごとの道具は stage.js が IttsukanUI.addTool で足す。
 * 入力した内容はこのブラウザの中（localStorage）にだけ置き、どこにも送らない。
 */
(function (global) {
  'use strict';
  var K = global.Ittsukan;
  var doc = global.document;

  var KEY_SHEET = 'ittsukan:sheet:';
  var KEY_REF = 'ittsukan:ref:';

  var S = { stage: null, sheet: null, refs: {}, refSource: {}, tools: [], editing: null };

  /* ---------- 小物 ---------- */

  function $(id) { return doc.getElementById(id); }
  function el(tag, attrs, children) {
    var n = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return n;
  }
  function str(v) { return v == null ? '' : String(v); }

  function store(key, value) {
    try {
      if (value == null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }
  function load(key) {
    try { var raw = global.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function msg(text, kind) {
    var m = $('it-msg');
    m.className = 'msg' + (kind ? ' ' + kind : '');
    m.textContent = text || '';
  }

  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { input.value = ''; cb(String(r.result), f.name); };
    r.readAsText(f, 'utf-8');
  }

  /* ---------- 保存 ---------- */

  function save() {
    S.sheet.updated = K.nowIso();
    if (!store(KEY_SHEET + S.stage.id, S.sheet)) msg('このブラウザに保存できませんでした。こまめにJSONで書き出してください。', 'warn');
  }

  function setSheet(sheet) {
    S.sheet = sheet;
    save();
    renderAll();
  }

  function upstreamSheets() {
    var o = {};
    S.stage.upstream.forEach(function (u) { if (S.refs[u]) o[u] = S.refs[u]; });
    return o;
  }

  function loadRefs() {
    S.stage.upstream.forEach(function (u) {
      var own = load(KEY_REF + S.stage.id + ':' + u);
      var r = own ? K.normalizeSheet(own, u) : null;
      if (r && r.sheet) { S.refs[u] = r.sheet; S.refSource[u] = 'file'; return; }
      // 7工程をまとめて使うとき：同じブラウザで作った前の工程の工程票を使う
      var shared = load(KEY_SHEET + u);
      var r2 = shared ? K.normalizeSheet(shared, u) : null;
      if (r2 && r2.sheet && r2.sheet.items.length) { S.refs[u] = r2.sheet; S.refSource[u] = 'browser'; }
    });
  }

  function syncUpstreamList() {
    S.sheet.upstream = S.stage.upstream.filter(function (u) { return S.refs[u]; }).map(function (u) {
      return { stage: u, file: K.fileBase(u) + '.json', updated: S.refs[u].updated };
    });
  }

  /* ---------- 描画 ---------- */

  function renderAll() {
    syncUpstreamList();
    $('it-case-name').value = S.sheet['case'].name;
    $('it-case-id').value = S.sheet['case'].id;
    renderUpstream();
    renderSections();
    renderQuestions();
    renderCheck();
    renderPreview();
  }

  function renderUpstream() {
    var box = $('it-upstream');
    box.textContent = '';
    if (!S.stage.upstream.length) {
      box.appendChild(el('p', { class: 'muted', text: 'この工程は最初の工程です。前の工程の工程票は要りません。' }));
      return;
    }
    S.stage.upstream.forEach(function (u) {
      var st = K.getStage(u);
      var sheet = S.refs[u];
      var row = el('div', { class: 'up-row' });
      var state = sheet
        ? '読み込み済み（' + sheet.items.length + '件、案件：' + sheet['case'].name + '）' + (S.refSource[u] === 'browser' ? '・このブラウザの「' + st.name + '」の画面で作ったもの' : '')
        : 'まだありません（無くても、この工程だけで使えます）';
      row.appendChild(el('div', { class: 'up-name' }, [el('strong', { text: st.name }), el('span', { class: 'muted', text: '　' + state })]));
      var input = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'it-up-file-' + u });
      input.addEventListener('change', function () {
        readFile(input, function (text, name) {
          var r = K.normalizeSheet(text, u);
          if (!r.sheet) { msg('読み込めませんでした：' + r.errors.join('／'), 'bad'); return; }
          S.refs[u] = r.sheet; S.refSource[u] = 'file';
          store(KEY_REF + S.stage.id + ':' + u, r.sheet);
          msg('「' + st.name + '」の工程票（' + name + '）を読み込みました。' + (r.errors.length ? '形の合わない項目を' + r.errors.length + '件除きました。' : ''), r.errors.length ? 'warn' : 'ok');
          save(); renderAll();
        });
      });
      var btns = el('div', { class: 'button-row' }, [
        el('label', { class: 'button secondary', for: 'it-up-file-' + u, text: '「' + st.name + '」の工程票（JSON）を読み込む' }),
        input
      ]);
      if (sheet) btns.appendChild(el('button', { type: 'button', class: 'link', text: '外す', onclick: function () {
        delete S.refs[u]; delete S.refSource[u];
        store(KEY_REF + S.stage.id + ':' + u, null);
        save(); renderAll();
      } }));
      row.appendChild(btns);
      box.appendChild(row);
    });
  }

  function isFictional(it) { return typeof it.basis_kind === 'string' && it.basis_kind.indexOf(K.FICTIONAL) >= 0; }

  function sourceOptions(sec) {
    // もとになった項目として選べるもの（この工程票と、前の工程の工程票）
    var out = [];
    (sec.from || []).forEach(function (spec) {
      var parts = spec.indexOf('.') >= 0 ? spec.split('.') : [S.stage.id, spec];
      var sheet = parts[0] === S.stage.id ? S.sheet : S.refs[parts[0]];
      if (!sheet) return;
      sheet.items.forEach(function (it) {
        if (it.section === parts[1]) out.push({ id: it.id, title: str(it.title).split('\n')[0] || str(it.reason) });
      });
    });
    return out;
  }

  function fieldInput(f, value, idBase) {
    var id = idBase + '-' + f.key;
    var input;
    if (f.type === 'textarea') input = el('textarea', { id: id, rows: 3 });
    else if (f.type === 'select') {
      input = el('select', { id: id });
      input.appendChild(el('option', { value: '', text: '（選んでください）' }));
      f.options.forEach(function (o) { input.appendChild(el('option', { value: o, text: o })); });
    } else input = el('input', { id: id, type: f.type === 'number' ? 'number' : 'text', inputmode: f.type === 'number' ? 'decimal' : null });
    input.value = value == null ? '' : String(value);
    input.dataset.key = f.key;
    return el('div', { class: 'field' }, [
      el('label', { for: id }, [f.label, f.required ? el('span', { class: 'req', text: '必須' }) : null]),
      input
    ]);
  }

  function openEditor(sec, item) {
    S.editing = { section: sec.id, id: item ? item.id : null };
    renderSections();
    var f = doc.querySelector('#it-editor input, #it-editor textarea, #it-editor select');
    if (f) f.focus();
  }

  function editorFor(sec) {
    var item = S.editing.id ? K.findItem(S.sheet, S.editing.id) : null;
    var idBase = 'ed-' + sec.id;
    var form = el('form', { class: 'editor', id: 'it-editor' });
    form.appendChild(el('h4', { text: item ? item.id + ' を直す' : '新しい項目（' + K.nextId(S.sheet, sec.id) + '）' }));
    sec.fields.forEach(function (f) { form.appendChild(fieldInput(f, item ? item[f.key] : '', idBase)); });
    if ((sec.from || []).length) {
      var opts = sourceOptions(sec);
      var chosen = item ? item.from : [];
      var fs = el('fieldset', { class: 'from-pick' }, [el('legend', { text: 'もとになった項目（どの項目から出てきたか）' })]);
      if (!opts.length) fs.appendChild(el('p', { class: 'muted', text: '選べる項目がまだありません。前の工程の工程票を読み込むか、下の欄に番号を書いてください。' }));
      opts.forEach(function (o) {
        fs.appendChild(el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', value: o.id, checked: chosen.indexOf(o.id) >= 0 }),
          el('span', { text: o.id + ' ' + o.title })
        ]));
      });
      var others = chosen.filter(function (c) { return !opts.some(function (o) { return o.id === c; }); });
      fs.appendChild(el('div', { class: 'field' }, [
        el('label', { for: idBase + '-from-extra', text: 'ほかの番号（読点で区切る。例：R-01、R-02）' }),
        el('input', { id: idBase + '-from-extra', type: 'text', value: others.join('、') })
      ]));
      form.appendChild(fs);
    }
    form.appendChild(el('div', { class: 'field' }, [
      el('label', { for: idBase + '-note', text: 'メモ（任意）' }),
      el('textarea', { id: idBase + '-note', rows: 2 }, [])
    ]));
    form.querySelector('#' + idBase + '-note').value = item && item.note ? item.note : '';
    var err = el('p', { class: 'msg bad', role: 'alert', hidden: true });
    form.appendChild(err);
    form.appendChild(el('div', { class: 'button-row' }, [
      el('button', { type: 'submit', class: 'primary', text: item ? 'この内容で直す' : '追加する' }),
      el('button', { type: 'button', class: 'link', text: 'やめる', onclick: function () { S.editing = null; renderSections(); } })
    ]));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var it = { id: item ? item.id : K.nextId(S.sheet, sec.id), section: sec.id };
      form.querySelectorAll('[data-key]').forEach(function (inp) {
        var f = sec.fields.filter(function (x) { return x.key === inp.dataset.key; })[0];
        var v = inp.value.trim ? inp.value.trim() : inp.value;
        if (v === '') return;
        it[f.key] = f.type === 'number' ? Number(v) : (f.type === 'textarea' ? inp.value.replace(/\s+$/, '') : v);
      });
      if ((sec.from || []).length) {
        var from = [];
        form.querySelectorAll('.from-pick input[type=checkbox]:checked').forEach(function (c) { from.push(c.value); });
        str($(idBase + '-from-extra').value).split(/[、,，\s]+/).forEach(function (x) { if (x && from.indexOf(x) < 0) from.push(x); });
        it.from = from;
      } else it.from = [];
      var note = $(idBase + '-note').value.trim();
      if (note) it.note = note;
      var errs = K.validateItem(S.stage.id, it);
      if (errs.length) { err.hidden = false; err.textContent = errs.join('／'); return; }
      upsertItem(it);
      S.editing = null;
      save(); renderAll();
      msg((item ? '直しました：' : '追加しました：') + it.id, 'ok');
    });
    return form;
  }

  function upsertItem(it) {
    var list = S.sheet.items;
    for (var i = 0; i < list.length; i++) if (list[i].id === it.id) { list[i] = it; return; }
    // 番号を使い直さないよう、次の番号を覚える
    var m = /^([A-Z]+)-(\d+)$/.exec(it.id);
    S.sheet.next_no = S.sheet.next_no || {};
    if (m) S.sheet.next_no[m[1]] = Math.max(S.sheet.next_no[m[1]] || 0, Number(m[2]) + 1);
    // 同じ欄の最後に入れる
    var last = -1;
    list.forEach(function (x, j) { if (x.section === it.section) last = j; });
    if (last < 0) list.push(it); else list.splice(last + 1, 0, it);
  }

  function itemCard(sec, it) {
    var card = el('article', { class: 'item' + (isFictional(it) ? ' fictional' : ''), id: 'item-' + it.id, tabindex: '-1' });
    var title = sec.id === 'shirushi' ? '【' + str(it.type) + '】' + str(it.reason) : str(it.title).split('\n')[0];
    var head = el('div', { class: 'item-head' }, [el('span', { class: 'idchip', text: it.id }), el('strong', { text: title || '（名前なし）' })]);
    if (isFictional(it)) head.appendChild(el('span', { class: 'badge-fictional', text: K.FICTIONAL }));
    card.appendChild(head);
    if (isFictional(it)) card.appendChild(el('p', { class: 'fictional-note', text: K.FICTIONAL_NOTE }));
    var dl = el('dl');
    sec.fields.forEach(function (f) {
      var v = it[f.key];
      // 名前（1行のもの）は見出しに出しているので、ここには出さない
      if (v == null || v === '' || (f.key === 'title' && f.type !== 'textarea')) return;
      dl.appendChild(el('dt', { text: f.label }));
      dl.appendChild(el('dd', { text: String(v) }));
    });
    if (it.from && it.from.length) {
      dl.appendChild(el('dt', { text: 'もとになった項目' }));
      dl.appendChild(el('dd', null, it.from.map(function (r) { return el('span', { class: 'refchip', text: r }); })));
    }
    if (it.note) { dl.appendChild(el('dt', { text: 'メモ' })); dl.appendChild(el('dd', { text: it.note })); }
    card.appendChild(dl);
    card.appendChild(el('div', { class: 'button-row' }, [
      el('button', { type: 'button', class: 'secondary small', text: '直す', onclick: function () { openEditor(sec, it); } }),
      el('button', { type: 'button', class: 'link small', text: '消す', onclick: function () {
        if (!global.confirm(it.id + ' を消しますか。')) return;
        S.sheet.items = S.sheet.items.filter(function (x) { return x.id !== it.id; });
        save(); renderAll(); msg('消しました：' + it.id);
      } })
    ]));
    return card;
  }

  function renderSections() {
    var box = $('it-sections');
    box.textContent = '';
    S.stage.sections.forEach(function (sec) {
      var items = S.sheet.items.filter(function (it) { return it.section === sec.id; });
      var card = el('section', { class: 'card', id: 'sec-' + sec.id, 'aria-labelledby': 'h-' + sec.id });
      card.appendChild(el('h3', { id: 'h-' + sec.id }, [sec.name + '（' + sec.prefix + '）', el('span', { class: 'count', text: items.length + '件' })]));
      card.appendChild(el('p', { class: 'muted', text: sec.help }));
      items.forEach(function (it) { card.appendChild(itemCard(sec, it)); });
      if (S.editing && S.editing.section === sec.id) card.appendChild(editorFor(sec));
      else card.appendChild(el('button', { type: 'button', class: 'secondary', 'data-add': sec.id, text: '＋ ' + sec.name + 'を追加', onclick: function () { openEditor(sec, null); } }));
      box.appendChild(card);
    });
  }

  function renderQuestions() {
    var box = $('it-questions');
    box.textContent = '';
    S.sheet.open_questions.forEach(function (q) {
      var row = el('div', { class: 'q-row' }, [
        el('span', { class: 'idchip', text: q.id }),
        el('span', { class: 'q-text', text: q.text }),
        el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: q.status === '決まった', onchange: function (e) {
          q.status = e.target.checked ? '決まった' : '未決'; save(); renderCheck(); renderPreview();
        } }), '決まった']),
        el('button', { type: 'button', class: 'link small', text: '消す', onclick: function () {
          S.sheet.open_questions = S.sheet.open_questions.filter(function (x) { return x.id !== q.id; }); save(); renderAll();
        } })
      ]);
      box.appendChild(row);
    });
  }

  function renderCheck() {
    var issues = K.checkSheet(S.sheet, upstreamSheets());
    var sum = K.summarize(issues);
    $('it-check-summary').textContent = issues.length ? '要対応 ' + sum.must + '件・参考 ' + sum.info + '件' : '気になる点は見つかりませんでした';
    $('it-check-summary').className = 'check-summary ' + (sum.must ? 'bad' : 'ok');
    var list = $('it-check-list');
    list.textContent = '';
    issues.forEach(function (x) {
      var li = el('li', { class: x.level === '要対応' ? 'must' : 'info' }, [el('span', { class: 'level', text: x.level })]);
      if (x.id) {
        var target = doc.getElementById('item-' + x.id);
        li.appendChild(target
          ? el('a', { href: '#item-' + x.id, class: 'idchip', text: x.id, onclick: function (e) { e.preventDefault(); target.scrollIntoView({ block: 'center' }); target.focus(); } })
          : el('span', { class: 'idchip', text: x.id }));
      }
      li.appendChild(doc.createTextNode(' ' + x.message));
      list.appendChild(li);
    });
    return issues;
  }

  function renderPreview() { $('it-preview').textContent = K.toMarkdown(S.sheet); }

  /* ---------- 画面の骨組み ---------- */

  function build(root) {
    var st = S.stage;
    root.textContent = '';
    root.appendChild(el('header', { class: 'site-header' }, [el('div', { class: 'wrap' }, [
      el('p', { class: 'crumb' }, [el('a', { href: '../../index.html', text: '一気通貫ツール' }), ' ／ 工程' + st.no + '（全7工程）']),
      el('h1', { text: st.name }),
      el('p', { class: 'lead', text: st.plain + '。' }),
      el('p', { class: 'stuck' }, [el('strong', { text: 'こんなときに：' }), st.stuck + '。この工程だけでも使えます。'])
    ])]));
    var main = el('main', { class: 'wrap', id: 'main' });
    root.appendChild(main);

    main.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: '案件' }),
      el('div', { class: 'two-col' }, [
        el('div', { class: 'field' }, [el('label', { for: 'it-case-name', text: '案件の名前' }), el('input', { id: 'it-case-name', type: 'text' })]),
        el('div', { class: 'field' }, [el('label', { for: 'it-case-id', text: '案件の記号（半角英数字。MCPのフォルダ名になります）' }), el('input', { id: 'it-case-id', type: 'text', pattern: '[A-Za-z0-9_-]+' })])
      ]),
      el('div', { class: 'button-row' }, [
        el('button', { type: 'button', class: 'secondary', id: 'it-sample', text: '見本案件（放課後児童クラブの利用申請）を読み込む' }),
        el('label', { class: 'button secondary', for: 'it-file', text: 'この工程の工程票（JSON）を読み込む' }),
        el('input', { type: 'file', id: 'it-file', accept: '.json,application/json', class: 'visually-hidden' }),
        el('button', { type: 'button', class: 'primary', id: 'it-export-json', text: 'JSONで書き出す' }),
        el('button', { type: 'button', class: 'secondary', id: 'it-export-md', text: 'Markdownで書き出す' }),
        el('button', { type: 'button', class: 'link', id: 'it-clear', text: 'この工程を空にする' })
      ]),
      el('p', { id: 'it-msg', class: 'msg', role: 'status', 'aria-live': 'polite' })
    ]));

    main.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: '前の工程の工程票' }),
      el('p', { class: 'muted', text: '前の工程の工程票（JSON）を読み込むと、「もとになった項目」を選べるようになり、抜けの点検もできます。' }),
      el('div', { id: 'it-upstream' })
    ]));

    var toolsCard = el('section', { class: 'card', id: 'it-tools-card', hidden: true }, [
      el('h2', { text: 'この工程の道具' }),
      el('div', { id: 'it-tools' })
    ]);
    main.appendChild(toolsCard);

    main.appendChild(el('div', { class: 'layout' }, [
      el('div', { class: 'layout-main' }, [
        el('h2', { class: 'section-title', text: '工程票の中身' }),
        el('div', { id: 'it-sections' }),
        el('section', { class: 'card', 'aria-labelledby': 'h-q' }, [
          el('h3', { id: 'h-q', text: '未決事項（Q）' }),
          el('p', { class: 'muted', text: 'まだ決まっていないこと。決まったら印を付けます。' }),
          el('div', { id: 'it-questions' }),
          el('form', { class: 'inline', id: 'it-q-form' }, [
            el('label', { for: 'it-q-text', class: 'visually-hidden', text: '未決事項' }),
            el('input', { id: 'it-q-text', type: 'text', placeholder: '例：受付の締切日をいつにするか' }),
            el('button', { type: 'submit', class: 'secondary', text: '追加' })
          ])
        ])
      ]),
      el('aside', { class: 'layout-side' }, [
        el('section', { class: 'card sticky', 'aria-labelledby': 'h-check' }, [
          el('h2', { id: 'h-check', text: '点検の結果' }),
          el('p', { class: 'muted small', text: 'AIを使わず、決まりで調べます（必須の欄の空き、つながらない番号、抜けなど）。入力のたびに更新します。' }),
          el('p', { id: 'it-check-summary', class: 'check-summary', role: 'status', 'aria-live': 'polite' }),
          el('ul', { id: 'it-check-list', class: 'check-list' })
        ])
      ])
    ]));

    main.appendChild(el('details', { class: 'card' }, [
      el('summary', { text: '工程票をMarkdown（人が読む用）で見る' }),
      el('pre', { id: 'it-preview', class: 'preview' })
    ]));

    root.appendChild(el('footer', { class: 'site-footer' }, [el('div', { class: 'wrap' }, [
      el('p', { text: '入力した内容は、このブラウザの中にだけ保存します。どこにも送信しません。' }),
      el('p', { text: '工程票の形：' + K.SCHEMA.sheet_kind + '（版 ' + K.SCHEMA.schema_version + '）' })
    ])]));
  }

  function wire() {
    $('it-case-name').addEventListener('input', function (e) { S.sheet['case'].name = e.target.value; save(); renderPreview(); });
    $('it-case-id').addEventListener('input', function (e) {
      var v = e.target.value.replace(/[^A-Za-z0-9_-]/g, '');
      S.sheet['case'].id = v || 'case-1'; save(); renderPreview();
    });
    $('it-file').addEventListener('change', function () {
      readFile($('it-file'), function (text, name) {
        var r = K.normalizeSheet(text, S.stage.id);
        if (!r.sheet) { msg('読み込めませんでした：' + r.errors.join('／'), 'bad'); return; }
        if (S.sheet.items.length && !global.confirm('今の工程票は、読み込んだファイルの内容で置き換わります。続けますか。')) return;
        setSheet(r.sheet);
        msg(name + ' を読み込みました（' + r.sheet.items.length + '件）。' + (r.errors.length ? '形の合わない項目を' + r.errors.length + '件除きました：' + r.errors.slice(0, 3).join('／') : ''), r.errors.length ? 'warn' : 'ok');
      });
    });
    $('it-export-json').addEventListener('click', function () {
      syncUpstreamList();
      UI.download(K.fileBase(S.stage.id) + '.json', JSON.stringify(S.sheet, null, 2) + '\n', 'application/json');
      msg('JSONで書き出しました（' + K.fileBase(S.stage.id) + '.json）。次の工程で読み込めます。', 'ok');
    });
    $('it-export-md').addEventListener('click', function () {
      UI.download(K.fileBase(S.stage.id) + '.md', K.toMarkdown(S.sheet), 'text/markdown;charset=utf-8');
      msg('Markdownで書き出しました（' + K.fileBase(S.stage.id) + '.md）。', 'ok');
    });
    $('it-clear').addEventListener('click', function () {
      if (!global.confirm('この工程の工程票を空にします。先にJSONで書き出しておくと元に戻せます。続けますか。')) return;
      setSheet(K.newSheet(S.stage.id, S.sheet['case']));
      msg('空にしました。');
    });
    $('it-sample').addEventListener('click', function () {
      var smp = global.ITTSUKAN_SAMPLES;
      if (!smp) { msg('見本のデータが見つかりません。', 'bad'); return; }
      if (S.sheet.items.length && !global.confirm('今の工程票は、見本案件で置き換わります。続けますか。')) return;
      S.stage.upstream.forEach(function (u) {
        var r = K.normalizeSheet(smp.sheets[u], u);
        if (r.sheet) { S.refs[u] = r.sheet; S.refSource[u] = 'file'; store(KEY_REF + S.stage.id + ':' + u, r.sheet); }
      });
      var r = K.normalizeSheet(smp.sheets[S.stage.id], S.stage.id);
      setSheet(r.sheet);
      msg('見本案件「' + r.sheet['case'].name + '」を読み込みました。前の工程の工程票も見本のものを読み込みました。', 'ok');
    });
    $('it-q-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('it-q-text').value.trim();
      if (!t) return;
      S.sheet.open_questions.push({ id: K.nextId(S.sheet, 'open_questions'), text: t, status: '未決' });
      $('it-q-text').value = '';
      save(); renderAll();
    });
  }

  /* ---------- 工程ごとの道具から使う口 ---------- */

  var UI = {
    state: S,
    el: el,
    download: download,
    msg: msg,
    readFile: readFile,
    getSheet: function () { return S.sheet; },
    getRef: function (stageId) { return S.refs[stageId] || null; },
    /** 項目を足す（番号は自動で振る）。戻り値は足した番号の一覧。 */
    addItems: function (items) {
      var ids = [];
      items.forEach(function (x) {
        var it = Object.assign({}, x);
        it.id = K.nextId(S.sheet, it.section);
        it.from = it.from || [];
        var errs = K.validateItem(S.stage.id, it);
        if (errs.length) throw new Error(errs.join('／'));
        upsertItem(it);
        ids.push(it.id);
      });
      save(); renderAll();
      return ids;
    },
    replaceSheet: setSheet,
    refresh: renderAll,
    /** 工程ごとの道具を足す。fn(container) で中身を作る。 */
    addTool: function (title, fn) { S.tools.push({ title: title, fn: fn }); },
    start: function (stageId) {
      S.stage = K.getStage(stageId);
      var root = $('app');
      build(root);
      var saved = load(KEY_SHEET + stageId);
      var r = saved ? K.normalizeSheet(saved, stageId) : null;
      S.sheet = r && r.sheet ? r.sheet : K.newSheet(stageId);
      loadRefs();
      wire();
      if (S.tools.length) {
        $('it-tools-card').hidden = false;
        S.tools.forEach(function (t) {
          var box = el('div', { class: 'tool' }, [el('h3', { text: t.title })]);
          $('it-tools').appendChild(box);
          t.fn(box);
        });
      }
      doc.title = S.stage.name + '｜一気通貫ツール';
      renderAll();
    }
  };
  global.IttsukanUI = UI;
})(window);
