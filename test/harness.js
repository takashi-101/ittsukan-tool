/* 小さなテストの仕組み */
(function (global) {
  'use strict';
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function AssertionError(msg) { this.message = msg; this.name = 'AssertionError'; }
  AssertionError.prototype = Object.create(Error.prototype);
  function ok(cond, msg) { if (!cond) throw new AssertionError(msg || '条件が成り立ちません'); }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new AssertionError((msg ? msg + '：' : '') + '期待 ' + JSON.stringify(expected) + ' ／ 実際 ' + JSON.stringify(actual));
  }
  function deepEq(actual, expected, msg) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) {
      // 最初に違う位置を示す
      var i = 0; while (i < a.length && a[i] === b[i]) i++;
      throw new AssertionError((msg ? msg + '：' : '') + '違う位置 ' + i + '\n期待 …' + b.slice(Math.max(0, i - 80), i + 120) + '\n実際 …' + a.slice(Math.max(0, i - 80), i + 120));
    }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(cond, ms, msg) {
    var end = Date.now() + (ms || 4000);
    while (Date.now() < end) { if (cond()) return; await sleep(20); }
    throw new AssertionError('待ちきれませんでした：' + (msg || ''));
  }
  async function run() {
    var list = document.getElementById('results');
    var passed = 0, failed = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      var li = document.createElement('li');
      try { await t.fn(); passed++; li.className = 'pass'; li.textContent = '成功：' + t.name; }
      catch (e) {
        failed++; li.className = 'fail'; li.textContent = '失敗：' + t.name;
        var pre = document.createElement('pre'); pre.textContent = (e && (e.message || e.stack)) || String(e); li.appendChild(pre);
      }
      list.appendChild(li);
    }
    var summary = (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + tests.length;
    document.getElementById('summary').textContent = summary + (failed ? '（失敗 ' + failed + '件）' : '（すべて成功）');
    document.title = summary;
    global.__testResult = { passed: passed, failed: failed, total: tests.length };
  }
  global.T = { test: test, ok: ok, eq: eq, deepEq: deepEq, sleep: sleep, waitFor: waitFor, run: run };
})(window);
