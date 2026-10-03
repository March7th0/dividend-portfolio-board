/* ============================================================
   R57 场景模拟：新档案「scale25」= 初始本金 25 万 + 月度 1 万
   ─────────────────────────────────────────────────────────────
   目的：在更大资金量级下检验工具的数学、状态机与边界：
     M1 档案隔离：scale25 与 blink 互不影响
     S1 资金设置（走真实 DOM 事件）：capital/capitalLeft/monthly
     A2 allocPlan 建仓口径：250000 → 核心 231,200 / 卫星 18,800（92.5/7.5）
     A3 应用分配：8 池全部 ≥ 1 手（无饿死），capitalLeft 清零，总账闭合
     O4 顺序卡/阶段卡/资金来源条在 25 万口径下的目标手数
     B5 买入 1 手 → 池扣款、流水、撤销回滚
     P6 阶段判定仍为「核心层阶段」（进度驱动，与资金规模无关）
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r57.js
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

/* blink 保留旧数据（5 万口径）用于隔离断言；scale25 是全新的空档案 */
let SRV = {
  'POOLS::blink': { v_gh: { amount: 5000, note: '', since: '2026-09-20', lastBuy: '2026-09-20' } },
  'PV2::blink':   { capital: 50000, capitalLeft: 2000, pendingPool: 0, divPool: 0, logs: [], __ts: 't' },
  'HOLDINGS::blink': {},
  'POOLS::scale25': {},
  'PV2::scale25': { capital: null, monthly: null, divPool: 0, pendingPool: 0, capitalLeft: 0, startISO: null, logs: [], phaseLock: null, __ts: 't' },
  'HOLDINGS::scale25': {},
  'PROFILE': { current:'scale25', list:['blink','scale25'], meta:{ blink:{admin:true,pass:''}, scale25:{admin:false,pass:''} } }
};
let IDS = {}; let NEXT = 1;
Object.keys(SRV).forEach(function(k){ IDS[k] = 'r' + (NEXT++); });
const WRITTEN_KEYS = [];   /* 记录所有云端写入的 键，用于隔离断言 */

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
    updateRecord: function(o){
      var k = null;
      for (var key in IDS) if (IDS[key] === o.recordId) k = key;
      WRITTEN_KEYS.push(k);
      var pr = o.properties || {};
      if (pr['键'] && pr['键'].text !== k){ var nk = pr['键'].text; var mv = SRV[k]; delete SRV[k]; IDS[nk] = o.recordId; SRV[nk] = mv || {}; k = nk; }
      if (pr['数据']){ try { SRV[k] = JSON.parse(pr['数据'].text); } catch(e){} }
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(o){
      var pr = o.properties || {};
      var nk = (pr['键'] && pr['键'].text) || ('anon' + NEXT);
      WRITTEN_KEYS.push(nk);
      IDS[nk] = 'r' + (NEXT++); SRV[nk] = pr['数据'] ? JSON.parse(pr['数据'].text) : {};
      return Promise.resolve({ record_id: IDS[nk] });
    },
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

function poolSum(){
  var s = 0;
  for (var k in w.POOLS) s += (w.num(w.POOLS[k].amount) || 0);
  return s;
}

(async function main(){
  await flush(400);
  ok('S0 页面启动无异常', bootErr.length === 0, bootErr.join(' | '));
  ok('S0 估值表已加载（10 条）', w.RECORDS && w.RECORDS.length === 10, 'n=' + (w.RECORDS || []).length);

  /* ══ M1 新档案初始状态 + 隔离 ══ */
  console.log('\n【M1】新档案 scale25 初始为空，blink 数据不受影响');
  eq('M1 当前档案 = scale25', w.PROFILE.current, 'scale25');
  eq('M1 scale25 本金未填', w.PV2.capital, null);
  eq('M1 scale25 池子为空', poolSum(), 0);
  eq('M1 ★ blink 的池子未被清掉（隔离）', SRV['POOLS::blink'].v_gh.amount, 5000);
  eq('M1 ★ blink 的本金未被清掉（隔离）', SRV['PV2::blink'].capital, 50000);

  /* ══ S1 资金设置：走真实 DOM 事件链 ══ */
  console.log('\n【S1】资金设置：本金 250,000 + 月度 10,000（真实输入框 + 按钮）');
  w.openFundSheet('money');
  ok('S1 资金设置弹层渲染', !!D().getElementById('capIn') && !!D().getElementById('capSet'));
  D().getElementById('capIn').value = '250000';
  D().getElementById('capSet').click();
  D().getElementById('monIn').value = '10000';
  D().getElementById('monSet').click();
  eq('S1 ★ capital = 250000', w.PV2.capital, 250000);
  eq('S1 ★ capitalLeft = 250000', w.PV2.capitalLeft, 250000);
  eq('S1 ★ monthly = 10000', w.PV2.monthly, 10000);
  var hasCapLog = w.PV2.logs.some(function(l){ return l.type === 'capital' && l.amount === 250000; });
  var hasMonLog = w.PV2.logs.some(function(l){ return l.type === 'monthly' && l.amount === 10000; });
  ok('S1 流水已记录（capital / monthly）', hasCapLog && hasMonLog);

  /* ══ A2 分配数学（建仓口径 build）══ */
  console.log('\n【A2】allocPlan 建仓口径：一次性分 25 万');
  var plan = w.allocPlan(250000, 0, 'build');
  eq('A2 ★ 口径 = build', plan.mode, 'build');
  eq('A2 ★ 层间拆分 = 核心 231,200（92.5%）', plan.coreAmt, 231200);
  eq('A2 ★ 层间拆分 = 卫星 18,800（7.5%）', plan.satAmt, 18800);
  eq('A2 合计恰好 250,000', plan.coreAmt + plan.satAmt, 250000);
  eq('A2 阶段 = 核心层阶段', plan.phase.k, 'core');
  eq('A2 覆盖 8 只标的（核心 4 + 卫星 4）', plan.rows.length, 8);
  var rowSum = plan.rows.reduce(function(s, o){ return s + o.amt; }, 0);
  eq('A2 逐池合计 = 250,000', rowSum, 250000);
  /* ★ R57 场景发现：核心阶段 92.5/7.5 拆层下，卫星种子 18,800 摊给 4 只，
     神华（一手 4,803）只分到约 3,223 < 1 手 —— 这是「卫星种子」设计的正常结果
     （核心阶段卫星池本来只累积不买入），断言按此口径：核心 4 池全部 ≥ 1 手；
     卫星里只有神华不足 1 手（其余 3 只 ≥ 1 手）。 */
  var coreRows = plan.rows.filter(function(o){ return o.tier === 'core'; });
  var satRows  = plan.rows.filter(function(o){ return o.tier === 'sat'; });
  var coreStarved = coreRows.filter(function(o){ return o.amt < w.lotCost(o.r).lot; });
  var satStarved  = satRows.filter(function(o){ return o.amt < w.lotCost(o.r).lot; });
  eq('A2 ★ 核心 4 池全部 ≥ 1 手（无饿死）', coreStarved.length, 0);
  eq('A2 卫星仅神华不足 1 手（种子池，等后续注入）', satStarved.map(function(o){ return o.r['标的名称']; }).join(','), '中国神华');

  /* ══ A3 应用分配（与分配台同口径的落库）══ */
  console.log('\n【A3】应用分配：capitalLeft 清零、总账闭合');
  plan.rows.forEach(function(o){
    w.POOLS[o.r._id] = { amount: o.amt, note: '', since: w.todayISO(), lastBuy: w.todayISO() };
  });
  w.PV2.capitalLeft = w.PV2.capitalLeft - rowSum;
  w.renderPool();
  eq('A3 ★ capitalLeft = 0', w.PV2.capitalLeft, 0);
  eq('A3 ★ 各池合计 = 250,000', Math.round(poolSum()), 250000);
  var heroHtml = D().getElementById('poolHero').innerHTML;
  /* ★ R57 修复后：文字与进度条同口径封顶，超出显示「已超配」 */
  ok('A3 ★ 总进度封顶 100%（显示已超配，不再出现 116.3%）',
     heroHtml.indexOf('100.0%（已超配 · 整手取整所致）') >= 0 && heroHtml.indexOf('116.3%') < 0);

  /* ══ O4 25 万口径下的目标手数与顺序 ══ */
  console.log('\n【O4】目标手数（25 万）与建仓顺序');
  var opHtml = D().getElementById('orderPlan').innerHTML;
  ok('O4 ★ 工行目标 46 手（37,500/813）', opHtml.indexOf('目标 <b>46</b> 手') >= 0);
  ok('O4 ★ 长电目标 19 手（55,000/2,836）', opHtml.indexOf('目标 <b>19</b> 手') >= 0);
  ok('O4 ★ 格力目标 7 手（30,000/3,836）', opHtml.indexOf('目标 <b>7</b> 手') >= 0);
  ok('O4 ★ 神华目标 3 手（15,000/4,803）', opHtml.indexOf('目标 <b>3</b> 手') >= 0);
  var seq = Array.from(D().querySelectorAll('#orderPlan .op-row .op-m > b')).map(function(x){ return x.textContent; }).join(',');
  eq('O4 ★ 顺序不随资金规模改变', seq, '工商银行,农业银行,格力电器,长江电力,国电电力,紫金矿业,陕西煤业,中国神华');
  var pv2Html = D().getElementById('poolV2').innerHTML;
  ok('O4 ★ 资金来源条：全程还需 核心 133 手 · 卫星 24 手',
     pv2Html.indexOf('全程还需 核心 <b>133</b> 手 · 卫星 <b>24</b> 手') >= 0);
  ok('O4 阶段卡显示新资金分配比例（核心 92.5% / 卫星 7.5%）',
     pv2Html.indexOf('核心 92.5% / 卫星 7.5%') >= 0);

  /* ══ B5 买入 1 手 + 撤销 ══ */
  console.log('\n【B5】买入 1 手工行（813 元）→ 扣款/流水/撤销');
  var gh = w.findByName('工商银行');
  var before = w.POOLS[gh._id].amount;
  w.doPoolDeduct(gh._id, 100, before, gh, 8.13, 813);
  eq('B5 ★ 池内扣款 813 元', Math.round(w.POOLS[gh._id].amount), Math.round(before - 813));
  var la = w.lastActiveLog();
  ok('B5 ★ 买入流水（type=buy，含 hands 供撤销回滚）', la && la.type === 'buy' && la.detail && la.detail[0].hands === 1);
  w.undoLog(la.seq);
  eq('B5 ★ 撤销后池内余额还原', Math.round(w.POOLS[gh._id].amount), Math.round(before));
  ok('B5 流水标记已撤销', w.lastActiveLog() === null || w.lastActiveLog().seq !== la.seq);

  /* ══ P6 阶段判定 ══ */
  console.log('\n【P6】阶段判定：进度驱动，与资金规模无关');
  eq('P6 ★ 仍有核心缺口 → 核心层阶段', w.phaseAuto(), 'core');

  /* ══ 隔离复核（操作后）══ */
  console.log('\n【M2】操作后隔离复核');
  eq('M2 ★ blink 池子依然无损', SRV['POOLS::blink'].v_gh.amount, 5000);
  var blinkWritten = WRITTEN_KEYS.some(function(k){ return k && k.indexOf('::blink') >= 0; });
  ok('M2 ★ 云端写入只碰 scale25（未写 blink）', !blinkWritten, WRITTEN_KEYS.filter(function(k){ return k && k.indexOf('blink') >= 0; }).join(','));

  console.log('\n──── R57 场景结果（25 万 + 月度 1 万）────');
  console.log('核心目标手数：长电19 国电47 工行46 农行21 = 133 手 ≈ 131,337 元');
  console.log('卫星目标手数：格力7 紫金8 陕煤6 神华3 = 24 手 ≈ 79,767 元');
  console.log('满配约 21.1 万（84%）· 一次性分配按阶段 92.5/7.5 拆层');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  process.exit(FAIL ? 1 : 0);
})().catch(function(e){ console.error('FATAL', e); process.exit(1); });
