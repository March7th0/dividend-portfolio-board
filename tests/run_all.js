#!/usr/bin/env node
/* ============================================================
   统一测试 runner —— 进程内串行执行 tests/ 下全部套件
   ============================================================
   用法:
     node tests/run_all.js            # 跑全部套件
     node tests/run_all.js poolv2     # 只跑文件名含 poolv2 的套件(子串匹配)
   退出码:任一套件 FAIL>0 或运行出错 → 1;全部通过 → 0。

   ★ R63:为什么是【进程内执行】而不是 spawn 子进程?
     本机环境下 node 进程内 spawn 任何子进程(连 cmd.exe / execSync)都被
     安全软件实时拦截(EBUSY, errno -4082),子进程空输出 ——
     最初 spawn 版 runner 因此把全部套件误判为 PARSE_ERROR。
     进程内方案:
     · 读套件源码 → new Function 包装,注入 require/module/__dirname;
     · 源码里的 `process.exit(` 文本替换为 `__suiteExit(` → throw 带套件标记,
       同步套件由 try/catch 捕获,异步套件(async IIFE)由 unhandledRejection 兜住;
     · console 输出临时重定向到套件私有缓冲,结束后回放(顺序不穿插,便于解析);
     · 每套件 60s 保险丝:超时未退出按 NO_EXIT 记失败,绝不挂死 runner。

   说明:
   · 套件自取 html:各套件内部用 path.resolve(__dirname, '..', 'portfolio-workbench.html')
     定位主文件,因此本目录必须保持在项目根下一层。
   · jsdom 依赖全局 node_modules(C:/Users/qq444/node_modules)。
   · 新增套件直接放进本目录即可被 runner 自动发现(文件名 .js、排除 run_all.js)。
   · 命名约定:此后新套件按【功能域】命名(如 alloc、profile),
     不要再按轮次命名(rN.js)——轮次回归请往既有套件里加断言。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');

const HERE = __dirname;

/* jsdom 依赖探测:历史约定装在 ~/node_modules(通过 NODE_PATH 提供) */
function nodePathFor() {
  if (process.env.NODE_PATH) return process.env.NODE_PATH;
  const guess = path.join(os.homedir(), 'node_modules');
  try {
    if (fs.existsSync(path.join(guess, 'jsdom'))) return guess;
  } catch (e) {}
  return '';
}

const suites = fs.readdirSync(HERE)
  .filter(function (f) { return f.endsWith('.js') && f !== 'run_all.js'; })
  .sort();

const filter = process.argv[2] || '';
const picked = suites.filter(function (f) { return f.indexOf(filter) >= 0; });
if (!picked.length) {
  console.error('没有匹配的套件:' + filter + '\n可用:' + suites.join(' '));
  process.exit(2);
}

function lastMatch(text, re) {
  let m, last = null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) last = m;
  return last;
}

/* 进程内串行执行一个套件;resolve {pass,fail,status,tail,out} */
function runSuiteInProcess(file) {
  return new Promise(function (resolve) {
    let settled = false;
    let buffer = [];
    const origLog = console.log, origErr = console.error, origWarn = console.warn;
    function captureOn() {
      console.log = function () { buffer.push(['log', Array.prototype.slice.call(arguments)]); };
      console.error = function () { buffer.push(['err', Array.prototype.slice.call(arguments)]); };
      console.warn = console.error;
    }
    function captureOff() { console.log = origLog; console.error = origErr; console.warn = origWarn; }
    function collect(exitCode) {
      captureOff();
      const out = buffer.map(function (a) { return util.format.apply(util, a[1]); }).join('\n');
      const pm = lastMatch(out, /PASS\s*[:：]?\s*(\d+)/g);
      const fm = lastMatch(out, /FAIL\s*[:：]?\s*(\d+)/g);
      const pass = pm ? parseInt(pm[1], 10) : null;
      const fail = fm ? parseInt(fm[1], 10) : null;
      /* ★ 退出码不可靠:异步套件自己的 .catch 会把退出标记再抛一次(exit(1))。
         判定以【套件自己打印的汇总】为准:有 PASS/FAIL 汇总且 FAIL=0 → ok。 */
      const status = (pass === null || fail === null) ? 'PARSE_ERROR'
        : (exitCode === null ? 'NO_EXIT' : (fail > 0 ? 'FAIL' : 'ok'));
      const tail = out.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      return { pass: pass, fail: fail, status: status, tail: tail, out: out };
    }
    function finish(res) {
      if (settled) return;
      settled = true;
      process.removeListener('unhandledRejection', onRej);
      captureOff();
      resolve(res);
    }
    function onRej(e) {
      if (e && e.__suiteExit && e.suite === file) {
        finish(collect(e.code));
        return;
      }
      buffer.push(['err', ['FATAL(unhandledRejection): ' + (e && (e.stack || e.message) || String(e))]]);
      finish(collect(1));
    }
    process.on('unhandledRejection', onRej);
    captureOn();
    const code0 = fs.readFileSync(path.join(HERE, file), 'utf8');
    try {
      const factory = new Function('return ' + '(function(require,module,exports,__dirname,__filename,__suiteExit){\n' +
        code0.replace(/process\.exit\s*\(/g, '__suiteExit(') + '\n})');
      const wfn = factory();
      wfn(require, { exports: {} }, {}, HERE, path.join(HERE, file),
        function (code) { throw { __suiteExit: true, code: (typeof code === 'number' ? code : 0), suite: file }; });
      /* 同步套件若不调用 exit(写漏了)——保险丝 60s,绝不挂死 runner */
      setTimeout(function () {
        finish({ pass: null, fail: null, status: 'NO_EXIT', tail: '60s 未退出(套件没调 exit?)', out: buffer.map(function (a) {
          return a[1].join(' '); }).join('\n') });
      }, 60000);
    } catch (e) {
      if (e && e.__suiteExit && e.suite === file) { finish(collect(e.code)); return; }
      buffer.push(['err', ['FATAL: ' + (e && (e.stack || e.message) || String(e))]]);
      finish(collect(1));
    }
  });
}

let totalPass = 0, totalFail = 0, badSuites = 0;
const rows = [];

(async function main() {
  for (const s of picked) {
    const r = await runSuiteInProcess(s);
    /* 回放该套件的输出(保持屏幕可见,串行执行顺序不穿插) */
    const outLines = (r.out || '').split('\n').filter(Boolean);
    for (const ln of outLines) console.log(ln);
    const status = r.status;
    if (r.status === 'ok') { totalPass += r.pass; totalFail += r.fail; }
    else badSuites++;
    rows.push({ suite: s, pass: r.pass, fail: r.fail, status: status, tail: r.tail });
  }

  /* 输出汇总表 */
  const w = Math.max.apply(null, rows.map(function (r) { return r.suite.length; }).concat([6]));
  console.log('');
  for (const r of rows) {
    const line = (r.status === 'ok')
      ? r.suite.padEnd(w) + '  PASS ' + String(r.pass).padStart(4) + '   FAIL ' + String(r.fail).padStart(3) + (r.fail === 0 ? '  ✓' : '  ✗✗✗')
      : r.suite.padEnd(w) + '  ' + r.status;
    console.log(line);
    if (r.status !== 'ok' || r.fail > 0) console.log('    └─ ' + r.tail);
  }
  console.log('');
  console.log('套件:' + rows.length + '  断言合计:PASS ' + totalPass + ' / FAIL ' + totalFail +
    (badSuites ? '  异常套件:' + badSuites : ''));
  process.exit((totalFail > 0 || badSuites > 0) ? 1 : 0);
})();
