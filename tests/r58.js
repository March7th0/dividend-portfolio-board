/* ============================================================
   R60 窄屏顶栏修复专项（iPhone 14 ≈393px 挤爆/重叠）
   ─────────────────────────────────────────────────────────────
   线上反馈：版本号把「档案切换 / 同步 / 夜间模式」挤到两边，
   档案与同步按钮和「长期组合作战台」标题重叠。
   根因：brand-sub(~90px) + verTag(~110px nowrap 内联样式) + sync(~120px)
        在 56px 单行里放不下 393px，flex 溢出互相压盖。
   修复：① verTag 内联样式移入 CSS（否则媒体查询盖不过）；
        ② 窄屏：副标题隐藏 / 同步文案截断 / verTag 换行到第二行右对齐；
        ③ brand-sub 顺手表驱动化（原写死 60/40，R54 改 53/35 后过时）。
   jsdom 不做布局 → 用 CSS 规则断言锁死（与 r42 同法）。
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r58.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const VAL_DB = 'RZJijiIkrKlwRQExwHjH0y';
const STATE_DB = 'gkfII6uQEsbgZHkbLCmAdl';
const TODAY = new Date().toISOString().slice(0, 10);

const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:22, 当前价格:28.36, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
  { record_id:'v_gh', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
  { record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:12, 当前价格:38.36, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
];
let SRV = {
  'POOLS::blink': {},
  'PV2::blink':   { capital: 50000, capitalLeft: 50000, pendingPool: 0, divPool: 0, logs: [], __ts: 't' },
  'HOLDINGS::blink': {},
  'PROFILE': { current:'blink', list:['blink'], meta:{ blink:{admin:true,pass:''} } }
};
let IDS = {}; let NEXT = 1;
Object.keys(SRV).forEach(function(k){ IDS[k] = 'r' + (NEXT++); });

function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [] }); },
    query: function(o){
      var id = o && o.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB) return Promise.resolve({ results: Object.keys(SRV).map(function(k){
        return { record_id: IDS[k], 键: k, 数据: JSON.stringify(SRV[k]), 更新时间: TODAY + 'T16:00:00Z' };
      }), hasMore: false });
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(){ return Promise.resolve({ ok: 1 }); },
    addRecord: function(){ return Promise.resolve({ record_id: 'r' + (NEXT++) }); },
    onUpdated: function(){}
  };
}

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.__SMART_PAGE__ = { database: makeDb() };
w.localStorage.clear();
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }
try { w.bindGlobalDelegates(); } catch(e){}
try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){}
try { w.bootstrap(); } catch(e){ bootErr.push('bs: ' + e.message); }

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 150); }); };

(async function main(){
  await flush(400);
  ok('S0 页面启动无异常', bootErr.length === 0, bootErr.join(' | '));

  /* ══ C1 CSS 规则断言（jsdom 不做布局，锁规则文本）══ */
  console.log('\n【C1】窄屏媒体查询规则存在');
  ok('C1 ★ verTag 样式已从内联移入 CSS（#verTag{）', /#verTag\{[^}]*font-size:10px/.test(HTML));
  ok('C1 ★ verTag 不再有内联 style（媒体查询可覆盖）',
     !/id="verTag"[^>]*style=/.test(HTML));
  ok('C1 ★ 媒体查询存在（max-width:640px 顶栏块）',
     /@media\(max-width:640px\)\{\s*\.topbar-in\{flex-wrap:wrap/.test(HTML));
  ok('C1 ★ 窄屏隐藏 brand-sub', (function(){
    var i = HTML.indexOf('@media(max-width:640px)');
    if (i < 0) return false;
    var seg = HTML.slice(i, i + 800);           /* 只看该媒体查询块内部 */
    return seg.indexOf('.brand-sub{display:none}') >= 0;
  })());
  ok('C1 ★ 窄屏 verTag 换行右对齐（flex:1 1 100%）',
     HTML.indexOf('#verTag{flex:1 1 100%;text-align:right') >= 0);
  ok('C1 ★ 窄屏同步文案截断（#syncTxt max-width）',
     HTML.indexOf('#syncTxt{display:inline-block;max-width:60px') >= 0);
  /* ══ R66：建仓顺序行窄屏两段式换行（容器必须允许 wrap）══ */
  ok('C1-R66 ★ .op-row 容器允许换行（flex-wrap:wrap）',
     HTML.indexOf('.op-row{display:flex;flex-wrap:wrap;') >= 0);
  ok('C1-R66 ★ 窄屏 .op-g 独占第二行（flex:1 1 100% + 缩进 32px）',
     HTML.indexOf('.op-g{flex:1 1 100%;text-align:left;flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:2px 14px;margin-left:32px}') >= 0);
  ok('C1-R66 ★ 旧的半截规则已移除（不再有无 wrap 容器下的 basis:100%）',
     HTML.indexOf('.op-g{flex-basis:100%') < 0);
  ok('C1 ★ 顶栏允许换行且不再定死 56px 高',
     HTML.indexOf('.topbar-in{flex-wrap:wrap;height:auto;min-height:52px') >= 0);

  /* ══ C2 brand-sub 表驱动 ══ */
  console.log('\n【C2】顶栏副标题跟随表驱动目标仓位');
  w.refreshAll();
  var bs = w.document.getElementById('brandSub');
  ok('C2 ★ brandSub 元素存在', !!bs);
  ok('C2 ★ 显示 核心 37% + 卫星 12%（fixture: 22+15 / 12）',
     bs && bs.textContent.indexOf('核心 37% + 卫星 12%') >= 0, bs && bs.textContent);
  ok('C2 ★ brand-sub 静态标记已更新为 53/35（不再写死 60/40）',
     (function(){
       var m = HTML.match(/<div[^>]*id="brandSub"[^>]*>([\s\S]*?)<\/div>/);
       return !!m && m[1].indexOf('核心 53% + 卫星 35%') >= 0 && m[1].indexOf('60%') < 0;
     })());

  /* ══ C3 变异：改表 → 副标题跟随 ══ */
  console.log('\n【C3】变异：改表里的目标仓位 → 副标题自动跟随');
  w.findByName('长江电力')['目标仓位'] = 30;
  w.refreshAll();
  ok('C3 ★ 变为核心 45% + 卫星 12%', bs.textContent.indexOf('核心 45% + 卫星 12%') >= 0, bs.textContent);
  w.findByName('长江电力')['目标仓位'] = 22;

  /* ══ C4 版本标签仍在（可见性不回退）══ */
  console.log('\n【C4】版本标签保持可见');
  var vt = w.document.getElementById('verTag');
  ok('C4 ★ verTag 已填充版本号（与 APP_VER 自洽，不写死轮次字面量 —— R62 起版本升级不再撞测试）',
     !!vt && vt.textContent === w.APP_VER, vt && vt.textContent);
  ok('C4 ★ verTag title 保留强刷提示', !!vt && vt.title.indexOf('强刷') >= 0);

  console.log('\n──── R60 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})().catch(function(e){ console.error('FATAL', e); process.exit(1); });
