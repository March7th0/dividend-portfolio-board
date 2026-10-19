/* ============================================================
   PWA 安装化专项（R75 Phase 1：把 GitHub Pages 版变成可安装 APP 壳）
   ─────────────────────────────────────────────────────────────
   覆盖：
     W1 head 声明（manifest / apple-touch-icon / theme-color / apple meta）
     W2 manifest 内容字段完整（name/start_url/display/icons ≥3）
     W3 sw.js 策略正确（外壳缓存 / 跨域不缓存 / 导航 network-first）
     W4 图标文件存在且为合法 PNG（4 枚）
     W5 sync_public.ps1 白名单已含 PWA 文件（公开仓才会带上壳）
     W6 pwaInit 门控（内嵌跳过）+ 安装条渲染/关闭不抛异常
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/pwa.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');
const ROOT = path.resolve(__dirname, '..');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

/* ══ W1 head 声明 ══ */
console.log('\n【W1】head PWA 声明');
ok('W1 ★ manifest 链接', HTML.indexOf('<link rel="manifest" href="manifest.webmanifest">') >= 0);
ok('W1 ★ apple-touch-icon', HTML.indexOf('<link rel="apple-touch-icon" href="tools/icons/apple-touch-icon.png">') >= 0);
ok('W1 ★ theme-color', HTML.indexOf('<meta name="theme-color" content="#2f6bd8">') >= 0);
ok('W1 ★ apple-mobile-web-app-capable', HTML.indexOf('<meta name="apple-mobile-web-app-capable" content="yes">') >= 0);
ok('W1 ★ apple-mobile-web-app-title', HTML.indexOf('name="apple-mobile-web-app-title" content="作战台"') >= 0);

/* ══ W2 manifest 内容 ══ */
console.log('\n【W2】manifest 内容');
var mf = null;
try { mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); } catch (e) {}
ok('W2 ★ manifest 可解析', !!mf);
if (mf){
  ok('W2 name = 长期组合作战台', mf.name === '长期组合作战台');
  ok('W2 short_name = 作战台', mf.short_name === '作战台');
  eq('W2 start_url 指向主文件', mf.start_url, './portfolio-workbench.html');
  eq('W2 display = standalone（全屏 APP 体验）', mf.display, 'standalone');
  ok('W2 icons ≥ 3（192/512/maskable）', (mf.icons || []).length >= 3);
  ok('W2 含 maskable 图标', (mf.icons || []).some(function(i){ return i.purpose === 'maskable'; }));
}

/* ══ W3 sw.js 策略 ══ */
console.log('\n【W3】Service Worker 策略');
var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
ok('W3 ★ 外壳预缓存清单含主文件', sw.indexOf("'./portfolio-workbench.html'") >= 0);
ok('W3 ★ 跨域请求直连不缓存（GitHub API 保持新鲜）', sw.indexOf('if (u.origin !== self.location.origin) return;') >= 0);
ok('W3 ★ 导航请求 network-first（离线回落外壳）', sw.indexOf("req.mode === 'navigate'") >= 0 && sw.indexOf("caches.match('./portfolio-workbench.html')") >= 0);
ok('W3 ★ GET 才处理（写操作不进 SW）', sw.indexOf("req.method !== 'GET'") >= 0);
ok('W3 ★ 旧缓存清理（activate）', sw.indexOf('caches.delete(k)') >= 0);

/* ══ W4 图标 PNG ══ */
console.log('\n【W4】图标文件');
['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png'].forEach(function(f){
  var p2 = path.join(ROOT, 'tools', 'icons', f);
  var head = fs.existsSync(p2) ? fs.readFileSync(p2).slice(0, 8) : null;
  ok('W4 ★ ' + f + ' 是合法 PNG', !!head && head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
});

/* ══ W5 白名单（仅私有仓语境有效；公开仓白名单外无 tools/，预期跳过） ══ */
console.log('\n【W5】sync_public 白名单');
var ps1Path = path.join(ROOT, 'tools', 'sync_public.ps1');
if (fs.existsSync(ps1Path)){
  var ps1 = fs.readFileSync(ps1Path, 'utf8');
  ok('W5 ★ 白名单含 manifest.webmanifest', ps1.indexOf("'manifest.webmanifest'") >= 0);
  ok('W5 ★ 白名单含 sw.js', ps1.indexOf("'sw.js'") >= 0);
  ok('W5 ★ 白名单含 tools\\icons', ps1.indexOf('tools\\icons') >= 0);
  ok('W5 ★ ps1 仍是 UTF-8 BOM（硬约定⑤）',
     fs.readFileSync(ps1Path).slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
} else {
  /* ★ R77：公开仓没有 tools/（白名单不含）——CI 上此断言无意义，跳过而非崩溃。
     R75/R76 两次公开仓 CI 红就是因为这里 readFileSync 直接抛 ENOENT。 */
  ok('W5 公开仓环境（无 tools/，白名单断言按预期跳过）', true);
}

/* ══ W6 运行时行为 ══ */
console.log('\n【W6】安装引导运行时');
const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
try { w.eval(script); } catch(e){ ok('W6 eval 无异常', false, e.message); }
ok('W6 ★ pwaInit 已定义', typeof w.pwaInit === 'function');
var threw = null;
try { w.pwaInit(); } catch(e){ threw = e.message; }
ok('W6 pwaInit 调用不抛异常（jsdom 无 SW → 内部跳过）', threw === null, threw);
var threw2 = null;
try {
  w.pwaShowInstall(false);
  var bar = w.document.getElementById('pwaBar');
  ok('W6 ★ 安装条渲染（含安装/稍后按钮）', !!bar && !!w.document.getElementById('pwaGo') && !!w.document.getElementById('pwaX'));
  ok('W6 ★ 安装条无 emoji（铁律3）', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bar.innerHTML));
  w.document.getElementById('pwaX').click();
  ok('W6 ★ 「稍后」关闭后安装条移除', !w.document.getElementById('pwaBar'));
} catch(e){ threw2 = e.message; }
ok('W6 安装条交互无异常', threw2 === null, threw2);

console.log('\n──── R75 PWA 结果 ────');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
fails.forEach(function(f){ console.log('  ✗ ' + f); });
process.exit(FAIL ? 1 : 0);
