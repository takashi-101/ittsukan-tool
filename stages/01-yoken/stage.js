/* 要件定義の道具：業務棚卸し（gyomu-tanaoroshi）のJSONから、現状の業務を読み込む */
(function () {
  'use strict';
  var UI = window.IttsukanUI, A = window.IttsukanAdapters, el = UI.el;

  UI.addTool('業務棚卸し（gyomu-tanaoroshi）から現状の業務を読み込む', function (box) {
    box.appendChild(el('p', { text: '業務棚卸し・事務引継ぎ記録ツールで「JSONで書き出す」をしたファイルを選ぶと、業務ごとに「現状の業務（W）」に足します。月の作業時間は、業務棚卸しと同じ換算で計算します。すでに読み込んだ業務は重ねて足しません。' }));
    var input = el('input', { type: 'file', id: 'tool-gyomu-file', accept: '.json,application/json', class: 'visually-hidden' });
    var out = el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    box.appendChild(el('div', { class: 'button-row' }, [el('label', { class: 'button secondary', for: 'tool-gyomu-file', text: '業務棚卸しのJSONを選ぶ' }), input]));
    box.appendChild(out);
    input.addEventListener('change', function () {
      UI.readFile(input, function (text) {
        try {
          var r = A.fromGyomu(text, UI.getSheet());
          var ids = r.items.length ? UI.addItems(r.items) : [];
          out.className = 'msg ok';
          out.textContent = ids.length
            ? '現状の業務を' + ids.length + '件足しました（' + ids.join('、') + '）。' + (r.skipped.length ? 'すでにある' + r.skipped.length + '件は足しませんでした。' : '') + '困りごと（P）は、課題のメモを見ながら書いてください。'
            : '足す業務はありませんでした（すべて読み込み済みです）。';
        } catch (e) { out.className = 'msg bad'; out.textContent = e.message; }
      });
    });
  });

  UI.start('yoken');
})();
