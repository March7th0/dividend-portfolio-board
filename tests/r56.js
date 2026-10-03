/* ============================================================
   R56 资金池专项：层级分组醒目化 + 建仓顺序条
   ─────────────────────────────────────────────────────────────
   用户需求：① 核心层/卫星层在资金池里分得醒目；② 买入顺序建议进工具。
   实现：分组头 + 行色条（CSS）；「建仓顺序 · 现在该买谁」三桶卡
   （现在可买 → 等回落 → 不建仓；核心先行、边际排序、表驱动）。
   覆盖：
     G1 分组头出现且核心在前；行带 core/sat 类
     O1 顺序条序列 = 工行 农行 格力 | 长电 国电 紫金 陕煤 | 神华
     O2 三桶标题按序出现
     O3 目标手数（本金 5 万口径）自动计算
     O4 ★ 变异：改表（格力判定→高估）→ 格力跌出「现在可买」桶
     O5 备选/排除不入池、不进顺序条
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r56.js
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

/* 与 R54 后的真实云端表同构（含判定与档位；外加备选/排除各 1 条） */
const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:22, 当前价格:28.36, 内在价值:42, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:25, 正常定投上限:28, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:10, 当前价格:5.24, 内在价值:4.6, 估值判定:'合理', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5, 减仓起始价:5.8 },
  { record_id:'v_gh', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 内在价值:9.9, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_nh', 标的名称:'农业银行', 代码:'601288.SH', 组合层级:'核心层', 目标仓位:6, 当前价格:6.87, 内在价值:8.3, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:6.3, 正常定投上限:7.4, 减仓起始价:8.8 },
  { record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:12, 当前价格:38.36, 内在价值:56.77, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:34, 正常定投上限:42, 减仓起始价:48 },
  { record_id:'v_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:10, 当前价格:30.01, 内在价值:24, 估值判定:'高估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:24, 正常定投上限:28, 减仓起始价:35 },
  { record_id:'v_sm', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:7, 当前价格:25.83, 内在价值:20, 估值判定:'高估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:22, 正常定投上限:26, 减仓起始价:30 },
  { record_id:'v_kg', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:6, 当前价格:48.03, 内在价值:42.5, 估值判定:'高估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:35, 正常定投上限:42, 减仓起始价:48 },
  { record_id:'v_zg', 标的名称:'中国银行', 代码:'601988.SH', 组合层级:'卫星层备选', 目标仓位:20, 当前价格:6.62, 内在价值:7.2, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
  { record_id:'v_pa', 标的名称:'中国平安', 代码:'601318.SH', 组合层级:'排除', 目标仓位:30, 当前价格:53.25, 内在价值:82.45, 估值判定:'低估', 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
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
        return { record_id: IDS[k], 键: k, 数据: JSON.stringify(SRV[k]), 更新时间: '2026-09-27T16:00:00Z' };
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
const D = () => w.document;

function orderNames(){
  return Array.from(D().querySelectorAll('#orderPlan .op-row .op-m > b')).map(function(x){ return x.textContent; });
}
function orderSeq(){ return orderNames().join(','); }

(async function main(){
  await flush(400);
  ok('S0 页面启动无异常', bootErr.length === 0, bootErr.join(' | '));
  ok('S0 估值表已加载', w.RECORDS && w.RECORDS.length === 10, 'n=' + (w.RECORDS || []).length);
  ok('S0 ★ orderPlanRows 已抽出（可测）', typeof w.orderPlanRows === 'function');
  ok('S0 ★ renderOrderPlan 已抽出（可测）', typeof w.renderOrderPlan === 'function');

  /* ══ G1 分组头 + 行色条 ══ */
  console.log('\n【G1】核心/卫星 分组头与行色条');
  w.goto('pool');
  w.refreshAll();
  var wrapHtml = D().getElementById('poolWrap').innerHTML;
  var iCore = wrapHtml.indexOf('核心层 · 压舱石');
  var iSat  = wrapHtml.indexOf('卫星层 · 弹性进攻');
  ok('G1 ★ 分组头「核心层 · 压舱石」出现', iCore >= 0);
  ok('G1 ★ 分组头「卫星层 · 弹性进攻」出现', iSat >= 0);
  ok('G1 ★ 核心分组头在卫星之前', iCore >= 0 && iSat > iCore);
  ok('G1 分组头带池数与池内金额（4 池）', wrapHtml.indexOf('4 池') >= 0, '见分组头文本');
  var firstRow = D().querySelector('#poolWrap .fp-row');
  ok('G1 ★ 首行是核心层行（fp-row core）', !!firstRow && firstRow.className.indexOf('core') >= 0, firstRow && firstRow.className);
  var satRow = D().querySelector('#poolWrap .fp-row.sat');
  ok('G1 ★ 卫星行带 sat 类', !!satRow);
  ok('G1 ★ 卫星标签用新色 tag sat', !!satRow && satRow.innerHTML.indexOf('tag sat') >= 0);
  ok('G1 ★ CSS 规则存在（fp-row.core inset 色条）', HTML.indexOf('.fp-row.core{box-shadow:inset 3px 0 0 var(--ac)}') >= 0);
  ok('G1 ★ CSS 规则存在（fp-gp 分组头）', HTML.indexOf('.fp-gp.core{background:var(--acbg)') >= 0);

  /* ══ O1/O2 顺序条 ══ */
  console.log('\n【O1】建仓顺序条：三桶 + 序列');
  var opHtml = D().getElementById('orderPlan').innerHTML;
  ok('O1 ★ 顺序条卡出现', opHtml.indexOf('建仓顺序 · 现在该买谁') >= 0);
  var want = ['工商银行','农业银行','格力电器','长江电力','国电电力','紫金矿业','陕西煤业','中国神华'];
  eq('O1 ★ 序列 = 工行 农行 格力 | 长电 国电 紫金 陕煤 | 神华', orderSeq(), want.join(','));
  ok('O2 ★ 三桶标题按序出现（可买→等回落→不建仓）',
     opHtml.indexOf('现在可买') < opHtml.indexOf('等回落 · 减半档或估值偏高') &&
     opHtml.indexOf('等回落 · 减半档或估值偏高') < opHtml.indexOf('不建仓'));
  eq('O2 备选/排除不进顺序条（8 只）', orderNames().length, 8);
  var allRows = D().querySelectorAll('#orderPlan .op-row');
  var lastRow = allRows[allRows.length - 1];
  eq('O2 ★ 神华在「不建仓」桶（data-b=3）', lastRow && lastRow.getAttribute('data-b'), '3');

  /* ══ O3 目标手数 ══ */
  console.log('\n【O3】目标手数自动计算（本金 5 万）');
  var goalHtml = Array.from(D().querySelectorAll('#orderPlan .op-g')).map(function(x){ return x.innerHTML; }).join('|');
  ok('O3 ★ 工行目标 9 手（7500/813）', goalHtml.indexOf('目标 <b>9</b> 手') >= 0, goalHtml.slice(0, 200));
  ok('O3 ★ 格力目标 1 手（6000/3836）', goalHtml.indexOf('目标 <b>1</b> 手') >= 0);
  ok('O3 行内含一手金额', goalHtml.indexOf('一手 813 元') >= 0);

  /* ══ O4 ★ 变异：改表不改码 ══ */
  console.log('\n【O4】变异：格力判定改「高估」→ 跌出「现在可买」桶');
  var gl = w.findByName('格力电器');
  gl['估值判定'] = '高估';
  w.renderPool();
  var seq2 = orderNames();
  eq('O4 ★ 格力移到「等回落」桶（第 5 位）', seq2.indexOf('格力电器'), 4);
  ok('O4 前三变为 工行/农行/长电', seq2.slice(0, 3).join(',') === '工商银行,农业银行,长江电力', seq2);
  gl['估值判定'] = '低估';
  w.renderPool();
  eq('O4 还原后回到第 3 位', orderNames().indexOf('格力电器'), 2);

  console.log('\n──── R56 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})().catch(function(e){ console.error('FATAL', e); process.exit(1); });
