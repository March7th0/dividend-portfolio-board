/* ============================================================
   R54 组合方案表驱动专项（改表不改码）
   ─────────────────────────────────────────────────────────────
   背景：电力同因子集中修正后，方案从「核心 60 / 卫星 40」变为
   「核心 53 / 卫星 35 / 现金 12」。此前再平衡警戒线（55）、
   卫星上限（40.5）、总览卡文案（目标 60% / 40%）全是硬编码，
   改方案必须改代码 —— 本次改为 tierTargetSum 表驱动。
   覆盖：
     S1 tierTargetSum 分层合计正确（核心 53 / 卫星 35 → 现金 12）
     S2 备选 / 排除记录不计入（哪怕它填了目标仓位）
     S3 ★ 表驱动变异：改表里的目标仓位 → 警戒线与文案自动跟随
     S4 「卫星层超配」文案使用表驱动的动态上限
     S5 总览卡「目标 x% / y%」自动跟随
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r54.js
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

/* 与 R54 更新后的真实云端表同构（含备选/排除各 1 条，且故意填了目标仓位） */
const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:22, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:25, 正常定投上限:28, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:10, 当前价格:5.24, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5, 减仓起始价:5.8 },
  { record_id:'v_gh', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_nh', 标的名称:'农业银行', 代码:'601288.SH', 组合层级:'核心层', 目标仓位:6, 当前价格:6.87, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:6.3, 正常定投上限:7.4, 减仓起始价:8.8 },
  { record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:12, 当前价格:38.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:34, 正常定投上限:42, 减仓起始价:48 },
  { record_id:'v_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:10, 当前价格:30.01, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:24, 正常定投上限:28, 减仓起始价:35 },
  { record_id:'v_sm', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:7, 当前价格:25.83, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:22, 正常定投上限:26, 减仓起始价:30 },
  { record_id:'v_kg', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:6, 当前价格:48.03, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:35, 正常定投上限:42, 减仓起始价:48 },
  { record_id:'v_zg', 标的名称:'中国银行', 代码:'601988.SH', 组合层级:'卫星层备选', 目标仓位:20, 当前价格:6.62, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
  { record_id:'v_pa', 标的名称:'中国平安', 代码:'601318.SH', 组合层级:'排除', 目标仓位:30, 当前价格:53.25, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
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
        return { record_id: IDS[k], 键: k, 数据: JSON.stringify(SRV[k]), 更新时间: '2026-09-26T16:00:00Z' };
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
  ok('S0 估值表已加载', w.RECORDS && w.RECORDS.length === 10, 'n=' + (w.RECORDS || []).length);

  /* ══ S1 分层合计 ══ */
  console.log('\n【S1】tierTargetSum 分层合计（核心 53 / 卫星 35 / 现金 12）');
  ok('S1 ★ tierTargetSum 已抽出（可测）', typeof w.tierTargetSum === 'function');
  eq('S1 核心层合计 = 53', w.tierTargetSum(false), 53);
  eq('S1 卫星层合计 = 35', w.tierTargetSum(true), 35);
  eq('S1 现金 = 100 − 53 − 35 = 12', 100 - w.tierTargetSum(false) - w.tierTargetSum(true), 12);

  /* ══ S2 备选 / 排除不计入 ══ */
  console.log('\n【S2】备选/排除记录不计入（哪怕填了目标仓位）');
  eq('S2 中国银行(备选,填了20) 不计入卫星', w.tierTargetSum(true), 35);
  eq('S2 中国平安(排除,填了30) 不计入核心', w.tierTargetSum(false), 53);

  /* ══ S3 ★ 表驱动变异：改表不改码 ══ */
  console.log('\n【S3】变异：改表里的目标仓位 → 合计与阈值自动跟随');
  var cp = w.findByName('长江电力');
  cp['目标仓位'] = 30;                       /* 22 → 30（模拟下一次方案调整只改表） */
  eq('S3 核心合计自动变为 61', w.tierTargetSum(false), 61);
  cp['目标仓位'] = 0;                        /* 极端：核心清零 */
  eq('S3 核心合计可为 0', w.tierTargetSum(false), 31);
  cp['目标仓位'] = 22;                       /* 还原 */
  eq('S3 还原后回到 53', w.tierTargetSum(false), 53);

  /* ══ S4 卫星超配文案（动态上限） ══ */
  console.log('\n【S4】卫星层超配文案使用表驱动上限');
  w.applyHolding(w.findByName('格力电器'), 300, 38.36);   /* 仅持卫星 → sp = 100% */
  w.refreshAll();
  var items = w.focusItems();
  var over = null;
  for (var i = 0; i < items.length; i++) if (items[i].t === '卫星层超配') over = items[i];
  ok('S4 出现「卫星层超配」待办', !!over, JSON.stringify(items.map(function(x){ return x.t; })));
  if (over){
    ok('S4 ★ 文案含动态上限「超过 35% 上限」', over.d.indexOf('超过 35% 上限') >= 0, over.d);
    ok('S4 文案不再写死 40%', over.d.indexOf('40% 上限') < 0, over.d);
  }

  /* ══ S5 总览卡目标文案 ══ */
  console.log('\n【S5】总览卡「目标 x% / y%」自动跟随');
  w.goto('board');
  w.refreshAll();
  var html = w.document.body.innerHTML;
  ok('S5 ★ 总览卡显示「目标 53% / 35%」', html.indexOf('目标 53% / 35%') >= 0);
  ok('S5 不再显示旧方案 60% / 40%', html.indexOf('目标 60% / 40%') < 0);

  console.log('\n──── R54 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})().catch(function(e){ console.error('FATAL', e); process.exit(1); });
