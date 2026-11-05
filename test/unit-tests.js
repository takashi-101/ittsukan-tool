/* 工程票の中核（common/core.js）と、既存のツールとのつなぎ口（common/adapters.js）のテスト */
(function () {
  'use strict';
  var K = window.Ittsukan, A = window.IttsukanAdapters, E = window.ITTSUKAN_EXPECTED, SMP = window.ITTSUKAN_SAMPLES;
  var test = T.test, ok = T.ok, eq = T.eq, deepEq = T.deepEq;

  function norm(sh, st) { var r = K.normalizeSheet(sh, st); return r.sheet; }

  /* ---------- Python版（MCPサーバー）との突き合わせ ---------- */

  E.cases.forEach(function (c) {
    test('Python版と同じ点検の結果：' + c.name, function () {
      var sh = norm(c.sheet, c.sheet.stage);
      var others = {};
      Object.keys(c.others).forEach(function (k) { others[k] = norm(c.others[k], k); });
      deepEq(K.checkSheet(sh, others), c.issues);
    });
    if (c.markdown != null) test('Python版と同じMarkdown：' + c.name, function () {
      eq(K.toMarkdown(norm(c.sheet, c.sheet.stage)), c.markdown);
    });
  });

  test('Python版と同じ形の点検（読み込みで除く項目と理由）', function () {
    var r = K.normalizeSheet(E.normalize.input, 'yoken');
    deepEq(r.errors, E.normalize.errors);
    eq(r.sheet.items.map(function (x) { return x.id; }).join(','), 'R-2,P-01,X-01', '残るのは形の正しい項目だけ');
  });

  test('決まりを破った工程票では、空き・つながらない番号・抜け・印・未決をすべて知らせる', function () {
    var c = E.cases.filter(function (x) { return x.name.indexOf('決まりを破った') >= 0; })[0];
    var text = c.issues.map(function (x) { return x.level + ' ' + x.id + ' ' + x.message; }).join('\n');
    ok(/要対応 TC-01 「確かめ方（操作）」が空です/.test(text), '空き');
    ok(/要対応 TC-02 もとになった項目「R-99」が「要件定義」の工程票に見つかりません/.test(text), 'つながらない番号');
    ok(/要対応 R-03 確認項目（テスト）の無い必須の機能/.test(text), '抜け');
    ok(/要対応 TC-02 不合格の確認項目/.test(text), '不合格');
    ok(/要対応 TM-02 採る・採らないが未選択の印/.test(text), '未選択');
    ok(/参考  未決事項が1件あります（Q-01）/.test(text), '未決');
  });

  /* ---------- 工程票の基本 ---------- */

  test('7工程があり、工程ごとの頭文字が重ならない', function () {
    eq(K.STAGES.length, 7);
    eq(K.STAGES.map(function (s) { return s.name.split('（')[0]; }).join('・'), '要件定義・基本設計・詳細設計・実装・テスト・導入・定着');
    var seen = {};
    K.STAGES.forEach(function (st) { st.sections.forEach(function (s) { ok(!seen[s.prefix], '重なり：' + s.prefix); seen[s.prefix] = true; }); });
  });

  test('番号は欄ごとに振り、消した番号は使い直さない', function () {
    var sh = K.newSheet('yoken', { id: 't', name: 't' });
    eq(K.nextId(sh, 'kino'), 'R-01');
    sh.items.push({ id: 'R-01', section: 'kino', from: [] }, { id: 'R-02', section: 'kino', from: [] });
    eq(K.nextId(sh, 'kino'), 'R-03');
    sh.next_no = { R: 3 };
    sh.items.pop();
    eq(K.nextId(sh, 'kino'), 'R-03', '消した R-02 は使わない（次は R-03）');
    eq(K.nextId(sh, 'mokuteki'), 'G-01');
    eq(K.nextId(sh, 'open_questions'), 'Q-01');
  });

  test('前の工程の工程票が無くても点検でき、確かめていないことを知らせる', function () {
    var issues = K.checkSheet(norm(SMP.sheets.kihon, 'kihon'), {});
    eq(issues.filter(function (x) { return x.level === '要対応'; }).length, 0);
    ok(issues.some(function (x) { return x.message.indexOf('「要件定義」の工程票が無いため') >= 0; }));
  });

  test('ほかの工程の工程票を、その工程の画面では読み込まない', function () {
    var r = K.normalizeSheet(SMP.sheets.kihon, 'yoken');
    eq(r.sheet, null);
    ok(r.errors[0].indexOf('「基本設計（外部設計）」の工程票') >= 0, r.errors[0]);
    eq(K.normalizeSheet('{', 'yoken').errors[0], 'JSONとして読めません');
    eq(K.normalizeSheet({ kind: 'other' }).sheet, null);
  });

  /* ---------- 見本案件 ---------- */

  test('見本案件：7工程すべてが、前の工程とつながり要対応なし', function () {
    K.STAGES.forEach(function (st) {
      var others = {};
      st.upstream.forEach(function (u) { others[u] = norm(SMP.sheets[u], u); });
      var issues = K.checkSheet(norm(SMP.sheets[st.id], st.id), others);
      var must = issues.filter(function (x) { return x.level === '要対応'; });
      eq(must.length, 0, st.name + '：' + JSON.stringify(must));
      ok(!issues.some(function (x) { return x.message.indexOf('工程票が無いため') >= 0; }), st.name + '：前の工程がそろっている');
    });
  });

  test('見本案件：選考の決まりは「架空の基準」と明記し、Markdownにも出る', function () {
    var sh = norm(SMP.sheets.shosai, 'shosai');
    var rules = sh.items.filter(function (it) { return it.section === 'kimari'; });
    eq(rules.length, 2);
    rules.forEach(function (r) {
      eq(r.basis_kind, '架空の基準');
      ok(r.title.indexOf('架空の基準') >= 0, r.id + ' の名前');
    });
    var md = K.toMarkdown(sh);
    ok(md.indexOf('### DR-01 選考の点数（架空の基準） 【架空の基準】') >= 0, '見出し');
    ok(md.indexOf('> ' + K.FICTIONAL_NOTE) >= 0, '断り書き');
    ok(SMP.sheets.yoken.items.filter(function (it) { return it.id === 'R-04'; })[0].detail.indexOf('架空の基準') >= 0, '要件定義にも明記');
  });

  test('見本案件：食い違いの印の引用は、依頼文と出力の中にそのまま見つかる（ai-decision-audit と同じ決まり）', function () {
    var sh = norm(SMP.sheets.test, 'test');
    var tr = K.findItem(sh, 'TR-01');
    var marks = sh.items.filter(function (it) { return it.section === 'shirushi'; });
    eq(marks.length, 5);
    var types = {};
    marks.forEach(function (m) {
      types[m.type] = true;
      if (m.output_quote !== 'なし') ok(tr.output.indexOf(m.output_quote) >= 0, m.id + '：出力に無い引用');
      if (m.request_quote !== 'なし') ok(tr.request.indexOf(m.request_quote) >= 0, m.id + '：依頼文に無い引用');
    });
    eq(Object.keys(types).length, 4, '4種類の印をすべて含む');
  });

  /* ---------- つなぎ口 ---------- */

  test('gyomu-tanaoroshi から：月の作業時間を同じ換算で計算し、重ねて読み込まない', function () {
    var r = A.fromGyomu(JSON.stringify(SMP.inputs.gyomu), K.newSheet('yoken'));
    eq(r.items.length, 3);
    deepEq(r.items.map(function (x) { return x.hours; }), [60, 40, 30], '見本の要件定義（W-01〜W-03）と同じ');
    eq(r.items[0].who, 'こども家庭課 放課後児童係（受付担当）');
    var again = A.fromGyomu(SMP.inputs.gyomu, norm(SMP.sheets.yoken, 'yoken'));
    eq(again.items.length, 0, '読み込み済み');
    eq(again.skipped.length, 3);
    var bad = false; try { A.fromGyomu('{"app":"other"}'); } catch (e) { bad = /gyomu-tanaoroshi/.test(e.message); }
    ok(bad, 'ほかのファイルは断る');
    eq(A.gyomuMonthlyHours({ calcMode: 'cases', casesPerMonth: 120, minutesPerCase: 10 }), 20);
    eq(A.gyomuMonthlyHours({ calcMode: 'freq', freqUnit: 'week', freqCount: 2, minutes: 30 }, { weeksPerMonth: 4.33 }), 4.3);
  });

  test('gyomu-tanaoroshi へ：手順書は業務に、判断の分かれ目は事務引継ぎ記録になる', function () {
    var g = A.toGyomu(norm(SMP.sheets.teichaku, 'teichaku'));
    eq(g.app, 'gyomu-tanaoroshi');
    eq(g.version, 1);
    eq(g.tasks.length, 3);
    var t1 = g.tasks[0], t2 = g.tasks[1], t3 = g.tasks[2];
    eq(t1.division, 'こども家庭課'); eq(t1.section, '放課後児童係'); eq(t1.freqUnit, 'day');
    eq(t2.freqUnit, 'year');
    eq(t1.kind, 'expert'); ok(t1.handover && t1.handover.decision.indexOf('就労証明書') >= 0, 'MH-02 が MP-01 の記録に');
    eq(t2.kind, 'expert'); ok(t2.handover.nonTransferable.length > 0, '渡せない部分');
    eq(t3.kind, 'routine'); eq(t3.handover, undefined);
    ok(/^it-houkago-club-MP-0\d$/.test(t1.id), t1.id);
    // 読み込み直すと、要件定義の現状の業務になる（行き来できる）
    var back = A.fromGyomu(g, K.newSheet('yoken'));
    eq(back.items.length, 3);
  });

  test('shinsei-fubi-check へ：入力チェックは欄に、添付書類は条件付きの添付書類になる', function () {
    var r = A.toShinsei(norm(SMP.sheets.shosai, 'shosai'));
    eq(r.warnings.length, 0, r.warnings.join('／'));
    var s = r.settings;
    eq(s.format, 'shinsei-fubi-check/settings');
    eq(s.version, 1);
    var t = s.types[0];
    eq(t.fields.length, 9);
    eq(t.attachments.length, 4);
    var phone = t.fields.filter(function (f) { return f.name === '電話番号'; })[0];
    eq(phone.format, 'phone'); eq(phone.required, true);
    var reason = t.fields.filter(function (f) { return f.name === '利用の理由'; })[0];
    eq(reason.format, 'choice'); deepEq(reason.options, ['就労', '疾病', '介護', 'その他']);
    eq(t.fields.filter(function (f) { return f.name === '保護者の氏名'; })[0].format, 'presence');
    var work = t.attachments.filter(function (a) { return a.name === '就労証明書'; })[0];
    eq(work.need, 'conditional'); eq(work.cond.fieldId, reason.id); deepEq(work.cond.values, ['就労']);
    var single = t.attachments.filter(function (a) { return a.name === '児童扶養手当証書の写し'; })[0];
    deepEq(single.cond.values, ['はい']);
  });

  test('shinsei-fubi-check へ：条件の欄が無いときは知らせる', function () {
    var sh = K.newSheet('shosai');
    sh.items.push({ id: 'DA-01', section: 'tenpu', title: '書類', need: '条件付き', cond_field: '無い欄', cond_values: 'x', from: [] });
    var r = A.toShinsei(sh);
    eq(r.settings.types[0].attachments[0].need, 'required');
    ok(r.warnings.some(function (w) { return w.indexOf('無い欄') >= 0; }));
  });

  test('ai-decision-audit：判定の依頼文は同じ指示で、返答を印にでき、記録の形で書き出せる', function () {
    var sh = norm(SMP.sheets.test, 'test');
    var tr = K.findItem(sh, 'TR-01');
    var p = A.auditPrompt(tr.request, tr.output);
    ok(p.indexOf('JSONだけ') >= 0 && p.indexOf('<依頼文>\n' + tr.request + '\n</依頼文>') >= 0 && p.indexOf('<出力>\n' + tr.output) >= 0);
    var ans = A.fromAuditAnswer('判定です。\n```json\n{"marks":[{"type":"足した","output_quote":"障害のある児童は5点を加えます。","request_quote":"なし","reason":"依頼に無い"},{"type":"変えた","output_quote":"x","request_quote":"なし","reason":"r"}]}\n```', 'TR-01');
    eq(ans.items.length, 1); eq(ans.errors.length, 1);
    eq(ans.items[0].decision, '未選択'); deepEq(ans.items[0].from, ['TR-01']);
    eq(A.fromAuditAnswer('なし', 'TR-01').items.length, 0);
    var rec = A.toAudit(sh, 'TR-01');
    eq(rec.tool, 'ai-decision-audit');
    eq(rec.request, tr.request); eq(rec.output, tr.output);
    eq(rec.marks.length, 5);
    eq(rec.marks[0].decision, '採らない');
    // 書き出した記録は、ai-decision-audit の「AIアプリの返答」の欄でそのまま読める形（type・output_quote・request_quote・reason がある）
    var back = A.fromAuditAnswer(JSON.stringify(rec), 'TR-01');
    eq(back.items.length, 5);
    eq(back.items[0].decision, '採らない', '採る・採らないも引き継ぐ');
  });

  test('madoguchi-kaito へ：よくある問い合わせが標準回答台帳の形になる', function () {
    var m = A.toMadoguchi(norm(SMP.sheets.donyu, 'donyu'));
    eq(m.format, 'madoguchi-kaito'); eq(m.version, 1);
    eq(m.ledger.length, 3);
    var e = m.ledger[0];
    deepEq(Object.keys(e), ['id', 'major', 'minor', 'question', 'answer', 'basisDoc', 'basisSection', 'basisPage', 'basisQuote', 'kakari', 'updated']);
    eq(e.major, '放課後児童クラブ'); eq(e.kakari, '放課後児童係');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(e.updated));
    ok(m.ledger[1].answer.indexOf('架空の基準') >= 0, '選考の回答にも架空の基準と書く');
  });
})();
