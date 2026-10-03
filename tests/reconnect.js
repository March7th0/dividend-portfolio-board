/* SDK 重连逻辑测试：验证「迟到也能自动接上」与「不再彻底放弃」 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'portfolio-workbench.html'), 'utf8');

let pass = 0, fail = 0; const F = [];
function ok(n, c, e) { if (c) pass++; else { fail++; F.push(n + (e ? ' → ' + e : '')); } }

const RECS = [
  { _id:'r1', '标的名称':'长江电力', '代码':'600900.SH', '组合层级':'核心层', '目标仓位':20, '当前价格':28.36, '一手股数':100, '持仓数量':0 }
];

const dom = new JSDOM(src, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window, d = w.document;
w.confirm = () => true;
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
w.eval(d.querySelector('script').textContent);

// ---------- 1. 起手无 SDK：应进入离线并启动后台重试 ----------
ok('初始 db 为 null', w.db === null, 'db=' + w.db);
ok('detectDb 无宿主时返回 null', w.detectDb() === null);
ok('initSdk 无宿主时返回 false', w.initSdk() === false);

w.RECORDS = RECS;
w.goOffline();   /* 不传参 → 用默认文案 */
ok('离线提示文案正确', /离线模式/.test(d.querySelector('#syncTxt').textContent),
   d.querySelector('#syncTxt').textContent);
ok('同步徽标为 off 态', d.querySelector('#syncBox').classList.contains('off'));

// ---------- 2. 启动 watchSdk：应建立探测定时器 ----------
w.watchSdk();
ok('watchSdk 建立了前台定时器', w.sdkTimer !== null);
ok('未重复起定时器（幂等）', (() => { const t = w.sdkTimer; w.watchSdk(); return w.sdkTimer === t; })());

// ---------- 3. 模拟 SDK 迟到注入 ----------
let connected = false;
const origBootstrap = w.bootstrap;
w.bootstrap = function(){ connected = true; };

// 注入假 SDK 宿主
w.__SMART_PAGE__ = {
  database: {
    query: () => Promise.resolve({ results: RECS, hasMore: false }),
    onUpdated: null
  }
};
ok('注入宿主后 detectDb 能探到', w.detectDb() !== null);
ok('注入宿主后 initSdk 返回 true', w.initSdk() === true);
ok('连接成功后所有探测定时器被清空', w.sdkTimer === null && w.sdkSlowTimer === null,
   'sdkTimer=' + w.sdkTimer + ' slow=' + w.sdkSlowTimer);
w.bootstrap = origBootstrap;

// ---------- 4. 验证「不再彻底放弃」：慢速阶段仍保留定时器 ----------
// 重置状态，模拟前台窗口耗尽进入慢速阶段
w.db = null;
w.sdkStopAll();
ok('sdkStopAll 清空两个定时器', w.sdkTimer === null && w.sdkSlowTimer === null);

// 手动触发前台窗口耗尽的情形
w.SDK_MAX_TRIES = 2;          // 缩短窗口便于测试
w.SDK_RETRY_MS = 20;
w.SDK_SLOW_MS = 30;
w.watchSdk();
ok('前台定时器已建立', w.sdkTimer !== null);

// ---------- 5. 检查关键代码结构 ----------
const code = src;
ok('watchSdk 内存在慢速定时器 sdkSlowTimer', code.includes('sdkSlowTimer = setInterval'));
ok('慢速阶段不再 goOffline 判死（用 else setSync 保留缓存提示）',
   code.includes("else setSync('off', '离线模式（已用本地缓存，重试中…）')"));
ok('sdkStopAll 函数存在且清理两个定时器',
   /function sdkStopAll\(\)\{[\s\S]*?clearInterval\(sdkTimer\)[\s\S]*?clearInterval\(sdkSlowTimer\)[\s\S]*?\}/.test(code));
ok('sdkConnected 统一收尾函数存在',
   /function sdkConnected\(\)\{[\s\S]*?sdkStopAll\(\)[\s\S]*?bootstrap\(\)/.test(code));
ok('retrySync 也走持续重试（调 watchSdk）',
   /function retrySync\(\)\{[\s\S]*?watchSdk\(\)/.test(code));
ok('保存失败提示说明数据已存本地', code.includes("离线模式（数据已存本地）"));
ok('保存失败后会重新 watchSdk', /离线模式（数据已存本地）'\);\s*\n\s*watchSdk\(\)/.test(code) ||
   (code.match(/离线模式（数据已存本地）'; watchSdk\(\)/g) || []).length >= 3);
ok('离线重连提示不再断言"未在沙箱打开"为唯一原因',
   !code.includes('本页可能未在资料库沙箱中打开'));

// ---------- 6. 旧的「彻底放弃」逻辑已消失 ----------
ok('不再存在"清掉定时器即结束"的旧写法',
   !/if \(SDK_TRIES >= SDK_MAX_TRIES\)\{\s*\n\s*clearInterval\(sdkTimer\); sdkTimer = null;\s*\n\s*if \(!RECORDS\.length\) goOffline/.test(code));

console.log('\n========== SDK 重连逻辑测试 ==========');
console.log('PASS:' + pass + '  FAIL:' + fail);
if (fail) { F.forEach(x => console.log('  x ' + x)); process.exit(1); }
console.log('全部通过 ✓');
process.exit(0);
