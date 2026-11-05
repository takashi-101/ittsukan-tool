/* 画面写真用：見本案件を読み込んだ状態で、指定の画面を指定の幅で開く（?w=375&page=stages/03-shosai-sekkei/index.html） */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var frame = document.getElementById('app');
  // 画面なしのブラウザは狭い窓を作れないことがあるため、幅は iframe で固定する
  if (params.get('w')) frame.style.width = params.get('w') + 'px';
  try {
    localStorage.clear();
    var smp = window.ITTSUKAN_SAMPLES;
    window.ITTSUKAN_SCHEMA.stages.forEach(function (st) { localStorage.setItem('ittsukan:sheet:' + st.id, JSON.stringify(smp.sheets[st.id])); });
  } catch (e) { /* 保存できなくても、画面は開く */ }
  frame.src = '../' + (params.get('page') || 'index.html');
})();
