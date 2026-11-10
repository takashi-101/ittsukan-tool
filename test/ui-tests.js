/* 画面のテスト。iframe に各工程の画面を開いて操作する。fetch は差し替え、呼ばれないことを確かめる。 */
(function () {
  'use strict';
  var K = window.Ittsukan, SMP = window.ITTSUKAN_SAMPLES;
  var test = T.test, ok = T.ok, eq = T.eq;
  var frame = document.getElementById('app');
  var w, d, fetchCalls, downloads;

  async function open(path, width) {
    frame.style.width = (width || 1280) + 'px';
    frame.removeAttribute('srcdoc');
    frame.src = '../' + path + '?t=' + Date.now();
    await new Promise(function (r) { frame.onload = r; });
    w = frame.contentWindow; d = frame.contentDocument;
    w.confirm = function () { return true; };
    w.print = function () { w.__printed = (w.__printed || 0) + 1; };
    fetchCalls = 0; w.fetch = function () { fetchCalls++; return Promise.reject(new Error('通信しないはず')); };
    downloads = [];
    if (w.IttsukanUI) w.IttsukanUI.download = function (name, text, mime) { downloads.push({ name: name, text: text, mime: mime }); };
    await T.sleep(30);
  }
  function $(id) { return d.getElementById(id); }
  function click(sel) { var e = d.querySelector(sel); if (!e) throw new Error('見つからない：' + sel); e.click(); }
  function clearStore() { try { localStorage.clear(); } catch (e) { /* 無視 */ } }
  function summary() { return $('it-check-summary').textContent; }

  K.STAGES.forEach(function (st) {
    test('画面：' + st.name + ' — 単体で開き、見本を読み込むと要対応なし', async function () {
      clearStore();
      await open('stages/' + st.folder + '/index.html');
      eq(d.querySelector('h1').textContent, st.name);
      ok(d.querySelector('.stuck').textContent.indexOf(st.stuck) >= 0, 'こんなときに');
      eq(d.querySelectorAll('#it-sections > section').length, st.sections.length, '欄の数');
      click('#it-sample');
      eq(d.querySelectorAll('.item').length, SMP.sheets[st.id].items.length, '項目の数');
      eq(summary().indexOf('要対応 0件') === 0 || summary() === '気になる点は見つかりませんでした', true, summary());
      ok(!/工程票が無いため/.test($('it-check-list').textContent), '前の工程も見本を読み込む');
      ok($('it-preview').textContent.indexOf('# ' + st.name + ' の工程票') === 0, 'Markdownの表示');
      eq(fetchCalls, 0, '通信しない');
    });
  });

  test('画面：項目を足す・直す・消す。消した番号は使い直さない', async function () {
    clearStore();
    await open('stages/01-yoken/index.html');
    click('[data-add="mokuteki"]');
    $('ed-mokuteki-title').value = '待ち時間を減らす';
    click('#it-editor button[type=submit]');
    eq(d.querySelectorAll('#sec-mokuteki .item').length, 1);
    ok(/要対応 2件/.test(summary()), '確かめ方が空・機能が無い：' + summary());
    click('#item-G-01 button.secondary');
    $('ed-mokuteki-measure').value = '窓口の待ち時間が10分以内';
    click('#it-editor button[type=submit]');
    ok(/要対応 1件/.test(summary()) && /機能が一つも無い目的/.test($('it-check-list').textContent), summary());
    click('#item-G-01 button.link');
    eq(d.querySelectorAll('#sec-mokuteki .item').length, 0);
    click('[data-add="mokuteki"]');
    ok(d.querySelector('#it-editor h4').textContent.indexOf('G-02') >= 0, '次は G-02');
  });

  test('画面：選べない値は追加しない（形の点検）', async function () {
    clearStore();
    await open('stages/01-yoken/index.html');
    click('[data-add="genjo"]');
    $('ed-genjo-title').value = 'テストの業務';
    $('ed-genjo-flow').value = '手順';
    $('ed-genjo-hours').value = 'abc';
    click('#it-editor button[type=submit]');
    // number の入力欄は数以外を受け付けないため空になる → 追加される。追加後に数として保存されていること
    var sheet = w.IttsukanUI.getSheet();
    ok(sheet.items.length === 1 && sheet.items[0].hours === undefined, '数でない値は入らない');
  });

  test('画面：前の工程の工程票は、同じブラウザで作ったものを自動で使い、ファイルからも読める', async function () {
    clearStore();
    localStorage.setItem('ittsukan:sheet:yoken', JSON.stringify(SMP.sheets.yoken));
    await open('stages/02-kihon-sekkei/index.html');
    ok($('it-upstream').textContent.indexOf('読み込み済み（19件') >= 0, $('it-upstream').textContent);
    click('#tool-draft-screens');
    var ids = w.IttsukanUI.getSheet().items.map(function (x) { return x.id; });
    eq(ids.join(','), 'SG-01,SG-02,SG-03,SG-04,SG-05', '必須・できれば の5機能の下書き（R-01〜R-05）');
    ok(/要対応/.test(summary()), '下書きは使う人が空なので要対応が出る');
  });

  test('画面：基本設計 — 形の下書き・対応表・データ項目の下書き', async function () {
    clearStore();
    await open('stages/02-kihon-sekkei/index.html');
    click('#it-sample');
    click('#tool-wire');
    var blocks = d.querySelectorAll('#tool-wire-area .wire-block');
    eq(blocks.length, 7, '画面4件と帳票3件');
    eq(d.querySelector('[data-wire="SG-01"]').getAttribute('data-kind'), 'form', '申込の画面は入力の形');
    eq(d.querySelector('[data-wire="SG-03"]').getAttribute('data-kind'), 'list', '受付簿は一覧の形');
    eq(d.querySelector('[data-wire="SC-01"]').getAttribute('data-kind'), 'sheet', '通知書は1枚の書類の形');
    ok(d.querySelector('[data-wire="SG-01"]').textContent.indexOf('個人情報') >= 0, '個人情報の印');
    ok(d.querySelector('[data-wire="SG-01"]').textContent.indexOf('○ 就労') >= 0, '選択肢はデータ項目の意味・例から');
    click('#tool-wire-print');
    eq(w.__printed, 1, '印刷');
    click('#tool-matrix');
    var rows = d.querySelectorAll('#tool-matrix-area tbody tr');
    eq(rows.length, 6, '機能6件');
    eq(d.querySelectorAll('#tool-matrix-area tr[data-state="要対応"]').length, 0, '必須の機能はすべて出てくる');
    eq(d.querySelectorAll('#tool-matrix-area tr[data-state="見送り"]').length, 1, 'R-06 は見送り');
    var KH = w.IttsukanKihon;
    var drafts = KH.draftDataItems(w.IttsukanUI.getSheet());
    ok(drafts.length > 0 && drafts.every(function (x) { return x.personal !== '当たらない'; }), '当たらないとは決めない');
    eq(drafts.filter(function (x) { return x.title === '宛名'; })[0].personal, '当たる', '宛名は個人情報の候補');
    var before = w.IttsukanUI.getSheet().items.length;
    click('#tool-draft-data');
    eq(w.IttsukanUI.getSheet().items.length, before + drafts.length, '下書きの件数');
    eq(KH.draftDataItems(w.IttsukanUI.getSheet()).length, 0, '二度は足さない');
    ok(!/要対応 [1-9]/.test(summary()), summary());
    eq(KH.splitItems('氏名、住所,電話番号\n氏名').join('|'), '氏名|住所|電話番号', '区切りと重なり');
    eq(fetchCalls, 0, '通信しない');
  });

  test('画面：要件定義 — 業務棚卸しのJSONを読み込める', async function () {
    clearStore();
    await open('stages/01-yoken/index.html');
    var file = new w.File([JSON.stringify(SMP.inputs.gyomu)], 'gyomu.json', { type: 'application/json' });
    var input = $('tool-gyomu-file');
    var dt = new w.DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new w.Event('change'));
    await T.waitFor(function () { return d.querySelectorAll('#sec-genjo .item').length === 3; }, 3000, '3件');
    ok(d.querySelector('#item-W-01').textContent.indexOf('60') >= 0, '月の作業時間');
  });

  test('画面：詳細設計 — 架空の基準を画面に明記し、shinsei-fubi-check の設定と仕様書を書き出す', async function () {
    clearStore();
    await open('stages/03-shosai-sekkei/index.html');
    click('#it-sample');
    var badges = d.querySelectorAll('.badge-fictional');
    eq(badges.length, 2);
    ok(d.querySelector('#item-DR-01 .fictional-note').textContent.indexOf('実在の自治体の基準ではありません') >= 0);
    ok(/DR-01 架空の基準です/.test($('it-check-list').textContent), '点検でも知らせる');
    click('#tool-shinsei');
    var s = JSON.parse(downloads[0].text);
    eq(s.types[0].fields.length, 9);
    click('#tool-spec');
    ok(downloads[1].text.indexOf('「架空の基準」と書いた決まりは') >= 0, '仕様書にもAIへの断り');
    ok(downloads[1].text.indexOf('# 基本設計（外部設計） の工程票') >= 0, '基本設計も付く');
  });

  test('画面：実装 — 依頼文の下書き・雛形・エラーの原因候補', async function () {
    clearStore();
    localStorage.setItem('ittsukan:sheet:shosai', JSON.stringify(SMP.sheets.shosai));
    await open('stages/04-jisso/index.html');
    click('#tool-draft-prompts');
    var sheet = w.IttsukanUI.getSheet();
    eq(sheet.items.filter(function (x) { return x.section === 'irai'; }).length, 4, 'DP-01〜DP-04');
    var p3 = sheet.items.filter(function (x) { return (x.from || []).indexOf('DP-03') >= 0; })[0];
    ok(p3.prompt.indexOf('架空の基準') >= 0 && p3.prompt.indexOf('1年〜3年：3点を加える') >= 0, '決まりを含む');
    ok(p3.from.indexOf('DR-01') >= 0 && p3.from.indexOf('DR-02') >= 0);
    click('#tool-scaffold');
    ok(downloads[0].name === 'hinagata-houkago-club.html');
    eq(sheet.items.filter(function (x) { return x.section === 'hinagata'; }).length, 1);
    $('tool-error-text').value = "Uncaught TypeError: Cannot read properties of null (reading 'value')";
    click('#tool-diagnose');
    var ie = w.IttsukanUI.getSheet().items.filter(function (x) { return x.section === 'error'; })[0];
    ok(ie && ie.causes.indexOf('id') >= 0 && ie.state === '調べ中');
    $('tool-error-text').value = 'なにかよく分からない';
    click('#tool-diagnose');
    eq(w.IttsukanUI.getSheet().items.filter(function (x) { return x.section === 'error'; }).length, 1, '当てはまらなければ足さない');
    eq(fetchCalls, 0);
  });

  test('試作の雛形：開くと入力チェックと条件付きの添付書類が動く', async function () {
    clearStore();
    await open('stages/04-jisso/index.html');
    var html = w.IttsukanJisso.buildScaffold(SMP.sheets.shosai);
    frame.style.width = '375px';
    frame.removeAttribute('src');
    frame.srcdoc = html;
    await new Promise(function (r) { frame.onload = r; });
    var dd = frame.contentDocument;
    eq(dd.querySelectorAll('form .field').length, 9, '欄の数');
    ok(dd.body.textContent.indexOf('架空の基準') >= 0, '架空の基準の断り');
    dd.querySelector('button[type=submit]').click();
    ok(dd.getElementById('errors').textContent.indexOf('保護者の氏名を入れてください') >= 0, '必須');
    var f = function (title, v) {
      var el = Array.prototype.filter.call(dd.querySelectorAll('input,select'), function (e) { return e.name === title; })[0];
      el.value = v;
    };
    f('保護者の氏名', '架空 花子'); f('住所', '架空市'); f('電話番号', '090-1234-56'); f('児童の氏名', '架空 太郎');
    f('学年', '2年'); f('利用したいクラブ', '架空第一小クラブ'); f('利用の理由', '就労'); f('ひとり親か', 'いいえ');
    dd.querySelector('button[type=submit]').click();
    var t = dd.getElementById('errors').textContent;
    ok(t.indexOf('電話番号の書式') >= 0, '電話番号：' + t);
    ok(t.indexOf('就労証明書が添付されていません（利用の理由が「就労」のため必要です）') >= 0, '条件付きの添付書類：' + t);
    ok(t.indexOf('診断書') < 0, '条件に当たらない書類は求めない');
    f('電話番号', '090-1234-5678');
    dd.getElementById('a1').checked = true;
    dd.querySelector('button[type=submit]').click();
    eq(dd.getElementById('errors').textContent, '');
    ok(dd.getElementById('done').textContent.indexOf('すべて通りました') >= 0);
    frame.removeAttribute('srcdoc');
  });

  test('画面：テスト — 確認項目の下書き、AIアプリの返答の読み込み、ai-decision-audit の形の書き出し', async function () {
    clearStore();
    localStorage.setItem('ittsukan:sheet:yoken', JSON.stringify(SMP.sheets.yoken));
    await open('stages/05-test/index.html');
    click('#tool-draft-cases');
    eq(w.IttsukanUI.getSheet().items.length, 5, 'R-01〜R-05');
    w.IttsukanUI.addItems([{ section: 'taisho', title: '試し', request: '案内文を書いて。手数料は300円。', output: '手数料は300円（現金のみ）です。' }]);
    $('tool-tr').refill(); $('tool-tr').value = 'TR-01';
    w.navigator.clipboard.writeText = function () { return Promise.resolve(); };
    click('#tool-audit-make');
    ok($('tool-audit-prompt').value.indexOf('手数料は300円（現金のみ）です。') >= 0);
    $('tool-audit-answer').value = '{"marks":[{"type":"足した","output_quote":"（現金のみ）","request_quote":"なし","reason":"支払い方法は依頼に無い"}]}';
    click('#tool-audit-load');
    var tm = w.IttsukanUI.getSheet().items.filter(function (x) { return x.section === 'shirushi'; });
    eq(tm.length, 1); eq(tm[0].id, 'TM-01'); eq(tm[0].decision, '未選択');
    ok(/TM-01 採る・採らないが未選択の印/.test($('it-check-list').textContent), '点検で知らせる');
    $('tool-tr-export').refill(); $('tool-tr-export').value = 'TR-01';
    click('#tool-audit-export');
    var rec = JSON.parse(downloads[0].text);
    eq(rec.tool, 'ai-decision-audit'); eq(rec.marks.length, 1);
    eq(fetchCalls, 0, '通信しない');
  });

  test('画面：導入 — 説明の印刷と madoguchi-kaito の台帳の書き出し', async function () {
    clearStore();
    await open('stages/06-donyu/index.html');
    click('#it-sample');
    click('#tool-print');
    eq(w.__printed, 1);
    click('#tool-madoguchi');
    var m = JSON.parse(downloads[0].text);
    eq(m.format, 'madoguchi-kaito'); eq(m.ledger.length, 3);
  });

  test('画面：定着 — 業務棚卸しの形の書き出し', async function () {
    clearStore();
    await open('stages/07-teichaku/index.html');
    click('#it-sample');
    click('#tool-gyomu-export');
    var g = JSON.parse(downloads[0].text);
    eq(g.app, 'gyomu-tanaoroshi'); eq(g.tasks.length, 3);
    ok(g.tasks[0].handover.decision.length > 0);
  });

  test('入口：見本案件を7工程に読み込むと、通しの点検が要対応なしでつながる', async function () {
    clearStore();
    await open('index.html');
    eq(d.querySelectorAll('.stage-card').length, 7);
    ok($('through-summary').textContent.indexOf('まだ工程票がありません') >= 0);
    click('#btn-sample');
    eq($('through-summary').textContent, '要件定義から定着まで、7工程すべてが要対応なしでつながっています。');
    // 1つの工程を壊すと、通しの点検で分かる
    var y = JSON.parse(localStorage.getItem('ittsukan:sheet:yoken'));
    y.items = y.items.filter(function (x) { return x.id !== 'R-02'; });
    localStorage.setItem('ittsukan:sheet:yoken', JSON.stringify(y));
    w.IttsukanHome.render();
    ok($('through-summary').textContent.indexOf('要対応のある工程') >= 0);
    ok($('through-body').textContent.indexOf('R-02') >= 0, 'つながらない番号を示す');
    eq(fetchCalls, 0);
  });

  test('入口：まとめて書き出したファイルを読み込める', async function () {
    clearStore();
    await open('index.html');
    var bundle = { kind: 'ittsukan-case', schema_version: '1', sheets: K.STAGES.map(function (st) { return SMP.sheets[st.id]; }) };
    w.IttsukanHome.importBundle(JSON.stringify(bundle));
    ok($('home-msg').textContent.indexOf('7枚の工程票を読み込みました') === 0, $('home-msg').textContent);
    eq($('through-summary').textContent, '要件定義から定着まで、7工程すべてが要対応なしでつながっています。');
  });

  [375, 1280].forEach(function (width) {
    test('スマートフォン・PCの幅（' + width + 'px）で、横にはみ出さない', async function () {
      clearStore();
      localStorage.setItem('ittsukan:sheet:yoken', JSON.stringify(SMP.sheets.yoken));
      var pages = ['index.html'].concat(K.STAGES.map(function (st) { return 'stages/' + st.folder + '/index.html'; }));
      for (var i = 0; i < pages.length; i++) {
        await open(pages[i], width);
        if (w.IttsukanUI) click('#it-sample');
        await T.sleep(30);
        var sw = d.documentElement.scrollWidth;
        ok(sw <= width + 1, pages[i] + '：横幅 ' + sw + 'px');
      }
    });
  });

  test('公開ファイル：どの画面も通信しない設定で、外部から読み込まない', async function () {
    var pages = ['index.html'].concat(K.STAGES.map(function (st) { return 'stages/' + st.folder + '/index.html'; }));
    for (var i = 0; i < pages.length; i++) {
      var html = await (await fetch('../' + pages[i], { cache: 'no-store' })).text();
      ok(html.indexOf("connect-src 'none'") > 0, pages[i] + '：connect-src');
      ok(!/(src|href)="https?:/.test(html), pages[i] + '：外部の読み込み');
    }
  });
})();
