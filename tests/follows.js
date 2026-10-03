/* ============================================================
   R62 关注层套件 —— 多人标的隔离（个人关注 + 公共池）
   ─────────────────────────────────────────────────────────────
   需求来源（2026-10-03 朋友反馈）：
     「好几个人一起用,关注标的要互相分开;可以有公共池,
       谁想关注就看自己关注的,但相互要能看到。」
   覆盖：
     F1 关注层装载与推导（含第二页数据 → 分页不截断）
     F2 存量迁移：从未被关注过的标的自动进公共池,幂等
     F3 看板范围：关注中（默认）/ 公共池 / 全部标的 + 「谁在关注」徽标
     F4 档案隔离：blink 与 alice 的个人关注互不可见（关注中口径）
     F5 关注/取关：软删语义（on 翻转）,REC_INDEX 命中走 update
     F6 公共池开关：一人加入 → 对方可见;移出 → 对方不可见
     F7 新增标的默认进「我的关注」（线上 addRecord 回传 id 路径）
     F8 状态表分页：第二页 startCursor 续拉
     F9 远程刷新：onUpdated(状态表) → 重拉关注层;自身回声被抑制
     F10 档案改名：FOLLOW::旧名::rid → FOLLOW::新名::rid 迁移 + 旧记录软删
     F11 删除档案：该档案个人关注全部软删,公共池不动
     F12 离线兼容：关注层未装载 → 全部可见（R61 前行为不变）
   运行：
     node tests/run_all.js follows
     （或单跑:$env:NODE_PATH="C:/Users/qq444/node_modules"; node tests/follows.js）
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

/* ---- 估值表 5 条：4 条有关注种子,1 条（中国平安）无任何关注 → 迁移目标 ---- */
const VAL_ROWS = [
  { record_id:'v_gs', 标的名称:'工商银行', 代码:'601398.SH', 组合层级:'核心层', 目标仓位:15, 当前价格:8.13, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:7, 正常定投上限:8.5, 减仓起始价:9.5 },
  { record_id:'v_gl', 标的名称:'格力电器', 代码:'000651.SZ', 组合层级:'卫星层', 目标仓位:10, 当前价格:38.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:32, 正常定投上限:42, 减仓起始价:50 },
  { record_id:'v_zj', 标的名称:'紫金矿业', 代码:'601899.SH', 组合层级:'卫星层', 目标仓位:10, 当前价格:30.01, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:25, 正常定投上限:33, 减仓起始价:40 },
  { record_id:'v_sm', 标的名称:'陕西煤业', 代码:'601225.SH', 组合层级:'卫星层', 目标仓位:8,  当前价格:25.83, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:21, 正常定投上限:28, 减仓起始价:34 },
  { record_id:'v_out', 标的名称:'中国平安', 代码:'601318.SH', 组合层级:'排除', 目标仓位:0, 当前价格:55.23, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY },
];

/* ---- 状态表：拆两页,验证 queryStateAll 续拉 ----
   第 1 页：档案/账目 4 条 + 关注 3 条;第 2 页：关注 3 条（含软关 on:false 两条） */
const STATE_P1 = [
  { record_id:'s_pools', 键:'POOLS::blink', 更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({}) },
  { record_id:'s_pv2',   键:'PV2::blink',   更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({
      capital:50000, monthly:3800, divPool:0, divSince:null, divMode:'single',
      pendingPool:0, capitalLeft:50000, startISO:'2026-09-26', logs:[], phaseLock:null, __ts:'2026-09-26T12:21:58.000Z' }) },
  { record_id:'s_hold',  键:'HOLDINGS::blink', 更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({}) },
  { record_id:'s_prof',  键:'PROFILE',   更新时间:'2026-09-26T12:21:58Z', 数据: JSON.stringify({ current:'blink', list:['blink','alice'], meta:{} }) },
  { record_id:'f1', 键:'FOLLOW::shared::v_gs', 更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_gs', on:true,  by:'blink', ts:'2026-09-26T12:00:00.000Z' }) },
  { record_id:'f2', 键:'FOLLOW::blink::v_gl',  更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_gl', on:true,  by:'blink', ts:'2026-09-26T12:00:00.000Z' }) },
  { record_id:'f3', 键:'FOLLOW::alice::v_zj',  更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_zj', on:true,  by:'alice', ts:'2026-09-26T12:00:00.000Z' }) },
];
const STATE_P2 = [
  { record_id:'f4', 键:'FOLLOW::shared::v_sm', 更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_sm', on:true,  by:'blink', ts:'2026-09-26T12:00:00.000Z' }) },
  { record_id:'f5', 键:'FOLLOW::blink::v_zj',  更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_zj', on:false, by:'blink', ts:'2026-09-26T12:00:00.000Z' }) },
  { record_id:'f6', 键:'FOLLOW::alice::v_gs',  更新时间:'2026-09-26T12:00:00Z', 数据: JSON.stringify({ rid:'v_gs', on:false, by:'alice', ts:'2026-09-26T12:00:00.000Z' }) },
];

/* ---- 假 SDK：状态表分页;写入留痕;addRecord 会把新记录推进估值表(模拟真云端) ---- */
const QUERY_LOG = [];      /* {db, cursor} */
const WRITE_LOG = [];      /* update/add 通用:{op, databaseId, properties, recordId} */
let addSeq = 0;
let UPD_CB = null;
function rowsForState(cursor){ return cursor === 'p2' ? STATE_P2 : STATE_P1; }
function flattenProps(props){
  var row = {};
  for (var k in props){
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    var v = props[k];
    row[k] = (v && typeof v === 'object' && ('text' in v)) ? v.text : v;
  }
  return row;
}
function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [] }); },
    query: function(opts){
      var id = opts && opts.databaseId;
      QUERY_LOG.push({ db: id, cursor: opts && opts.startCursor });
      if (id === VAL_DB) return Promise.resolve({ results: VAL_ROWS, hasMore: false });
      if (id === STATE_DB){
        var cur = opts && opts.startCursor;
        if (!cur) return Promise.resolve({ results: STATE_P1, hasMore: true, nextCursor: 'p2' });
        return Promise.resolve({ results: rowsForState(cur), hasMore: false });
      }
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(opts){ WRITE_LOG.push({ op:'update', o: opts }); return Promise.resolve({ ok: 1 }); },
    addRecord: function(opts){
      WRITE_LOG.push({ op:'add', o: opts });
      if (opts && opts.databaseId === VAL_DB){
        addSeq++;
        var ridN = 'n_' + addSeq;
        var row = flattenProps(opts.properties || {});
        row.record_id = ridN;
        VAL_ROWS.push(row);
        return Promise.resolve({ record_id: ridN });
      }
      return Promise.resolve({ record_id: 'st_' + WRITE_LOG.length });
    },
    onUpdated: function(cb){ UPD_CB = cb; }
  };
}

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.__SMART_PAGE__ = { database: makeDb() };
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }

const flush = function(ms){ return new Promise(function(r){ setTimeout(r, ms || 80); }); };
function Q(sel){ return w.document.querySelector(sel); }
function cardListHtml(){ var el = w.document.getElementById('cardList'); return el ? el.innerHTML : ''; }
function sbarHtml(){ var el = w.document.getElementById('sbar'); return el ? el.innerHTML : ''; }
function writeKeys(key){   /* 该键的写入条数 */
  var n = 0;
  for (var i = 0; i < WRITE_LOG.length; i++){
    var p = WRITE_LOG[i].o && WRITE_LOG[i].o.properties;
    if (p && p['键'] && p['键'].text === key) n++;
  }
  return n;
}
function lastWriteOf(key){
  for (var i = WRITE_LOG.length - 1; i >= 0; i--){
    var p = WRITE_LOG[i].o && WRITE_LOG[i].o.properties;
    if (p && p['键'] && p['键'].text === key) return JSON.parse(p['数据'].text);
  }
  return null;
}
function visibleNames(){
  return w.visibleRecords().map(function(r){ return r['标的名称']; });
}

(async function main(){
  console.log('\n【F0】启动');
  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(200);
  eq('F0 启动无异常', bootErr.length, 0);
  eq('F0 估值表 5 条载入', w.RECORDS.length, 5);

  /* ═══ F1 装载与推导 ═══ */
  console.log('\n【F1】关注层装载与推导');
  eq('F1 FOLLOW_READY=true', w.FOLLOW_READY, true);
  eq('F1 公共池含 工商银行', w.FOLLOW_SHARED['v_gs'], true);
  ok('F1 ★ 公共池含 陕西煤业（第 2 页数据 → 分页未截断）', w.FOLLOW_SHARED['v_sm'] === true);
  eq('F1 blink 个人关注 格力', w.FOLLOW_MINE['v_gl'], true);
  ok('F1 blink 对 紫金 是软关(on:false) → 不在关注集', w.FOLLOW_MINE['v_zj'] === undefined);
  eq('F1 关注中 = 4（gs/gl/sm + 迁移的 out）', visibleNames().length, 4);
  ok('F1 紫金矿业不在关注中', visibleNames().indexOf('紫金矿业') < 0);

  /* ═══ F2 存量迁移 ═══ */
  console.log('\n【F2】存量迁移（从未被关注的 → 公共池）');
  var migPay = lastWriteOf('FOLLOW::shared::v_out');
  ok('F2 中国平安被迁移进公共池（on:true）', !!migPay && migPay.on === true);
  eq('F2 迁移后 v_out 可见', w.FOLLOW_SHARED['v_out'], true);
  await flush(60);
  try { await w.cloudLoadState(); } catch(e){ bootErr.push('reload: ' + e.message); }
  await flush(120);
  eq('F2 ★ 幂等：再次装载不再重复迁移', writeKeys('FOLLOW::shared::v_out'), 1);

  /* ═══ F3 看板范围 ═══ */
  console.log('\n【F3】看板范围与徽标');
  eq('F3 默认 scope=follow', w.VIEW.scope, 'follow');
  var html = cardListHtml();
  ok('F3 关注中显示 工商银行', html.indexOf('工商银行') >= 0);
  ok('F3 关注中显示 格力电器', html.indexOf('格力电器') >= 0);
  ok('F3 关注中不显示 紫金矿业', html.indexOf('紫金矿业') < 0);
  ok('F3 范围条已渲染（关注中/公共池/全部标的）', sbarHtml().indexOf('关注中') >= 0 && sbarHtml().indexOf('公共池') >= 0 && sbarHtml().indexOf('全部标的') >= 0);
  w.VIEW.scope = 'all'; w.renderBoard(); html = cardListHtml();
  ok('F3 全部标的显示 紫金矿业', html.indexOf('紫金矿业') >= 0);
  ok('F3 ★ 紫金卡片带「alice 关注」徽标', html.indexOf('alice 关注') >= 0);
  ok('F3 未关注标的带「＋关注」开关', /data-act="f-mine"[^>]*>＋关注/.test(html) || html.indexOf('＋关注') >= 0);
  w.VIEW.scope = 'shared'; w.renderBoard(); html = cardListHtml();
  ok('F3 公共池视图：含 工商银行/陕西煤业,不含 格力（个人关注）',
     html.indexOf('工商银行') >= 0 && html.indexOf('陕西煤业') >= 0 && html.indexOf('格力电器') < 0);
  w.VIEW.scope = 'follow'; w.renderBoard();

  /* ═══ F4 档案隔离 ═══ */
  console.log('\n【F4】档案隔离');
  w.switchProfile('alice');
  await flush(200);
  eq('F4 alice 个人关注 紫金', w.FOLLOW_MINE['v_zj'], true);
  ok('F4 ★ alice 看不到 blink 的私关注格力（关注中口径）', w.FOLLOW_MINE['v_gl'] === undefined);
  eq('F4 alice 关注中 = 4（zj + 公共池3）', visibleNames().length, 4);
  w.switchProfile('blink');
  await flush(200);
  eq('F4 切回 blink → 格力回到关注集', w.FOLLOW_MINE['v_gl'], true);

  /* ═══ F5 关注/取关（软删） ═══ */
  console.log('\n【F5】关注/取关开关');
  w.toggleFollowMine('v_zj');
  await flush(120);
  var pay5 = lastWriteOf('FOLLOW::blink::v_zj');
  ok('F5 关注紫金 → on:true 落库', !!pay5 && pay5.on === true);
  eq('F5 内存立即生效', w.FOLLOW_MINE['v_zj'], true);
  ok('F5 关注中现在含 紫金矿业', visibleNames().indexOf('紫金矿业') >= 0);
  w.toggleFollowMine('v_zj');
  await flush(120);
  pay5 = lastWriteOf('FOLLOW::blink::v_zj');
  ok('F5 取关 → on:false（软删,不删记录）', !!pay5 && pay5.on === false);
  ok('F5 取关后紫金退出关注中', visibleNames().indexOf('紫金矿业') < 0);

  /* ═══ F6 公共池开关 ═══ */
  console.log('\n【F6】公共池开关');
  w.toggleFollowShared('v_gl');
  await flush(120);
  eq('F6 格力进公共池', w.FOLLOW_SHARED['v_gl'], true);
  w.switchProfile('alice');
  await flush(200);
  ok('F6 ★ alice 的关注中能看到 blink 转公用的格力', visibleNames().indexOf('格力电器') >= 0);
  w.switchProfile('blink');
  await flush(200);
  w.toggleFollowShared('v_gl');
  await flush(120);
  ok('F6 移出公共池恢复', w.FOLLOW_SHARED['v_gl'] === undefined);

  /* ═══ F7 新增自动关注 ═══ */
  console.log('\n【F7】新增标的默认进「我的关注」');
  var nameIn = w.document.getElementById('f-name');
  nameIn.value = '招商银行';
  w.EDIT_ID = null;
  try { w.doSave(); } catch(e){ bootErr.push('doSave: ' + e.message); }
  await flush(250);
  var cmb = w.findByName('招商银行');
  ok('F7 新标已入估值表镜像', !!cmb);
  var fNewKey = cmb ? ('FOLLOW::blink::' + cmb._id) : '';
  var pay7 = fNewKey ? lastWriteOf(fNewKey) : null;
  ok('F7 ★ 新标的自动 FOLLOW::blink::<id> on:true', !!pay7 && pay7.on === true, fNewKey);
  ok('F7 新标的立即可见（关注中）', visibleNames().indexOf('招商银行') >= 0);

  /* ═══ F8 分页断言 ═══ */
  console.log('\n【F8】状态表分页');
  var stQueries = QUERY_LOG.filter(function(q){ return q.db === STATE_DB; });
  /* ★ jsdom 里 DOMContentLoaded 会在 eval 后补发一次 → bootstrap 跑两遍,查询日志交错;
     因此不断言「第几条」,只断言「p2 续拉确实发生过」+ 每次装载至少两页。 */
  ok('F8 ★ 状态表分页续拉（存在 startCursor=p2 的查询）',
     stQueries.length >= 2 && stQueries.some(function(q){ return q.cursor === 'p2'; }),
     JSON.stringify(stQueries.slice(0, 4)));

  /* ═══ F9 远程刷新与回声抑制 ═══ */
  console.log('\n【F9】远程同步');
  ok('F9 onUpdated 回调已注册', typeof UPD_CB === 'function');
  /* 先清掉此前 setFollow/doSave 留下的回声静默窗 —— 现在模拟的是【别人】的改动 */
  w.SELF_WRITE_UNTIL = 0;
  STATE_P2.push({ record_id:'f7', 键:'FOLLOW::alice::v_gl', 更新时间:TODAY, 数据: JSON.stringify({ rid:'v_gl', on:true, by:'alice', ts:TODAY }) });
  UPD_CB({ databaseIds: [STATE_DB] });
  await flush(200);
  ok('F9 ★ 对方的关注近实时进入徽标数据', w.followOthersOf('v_gl').indexOf('alice') >= 0,
     JSON.stringify(w.followOthersOf('v_gl')));
  var keysBefore = Object.keys(w.FOLLOWS_RAW).length;
  w.markSelfWrite(9000);   /* 自身写入 → 静默窗 */
  STATE_P2.push({ record_id:'f8', 键:'FOLLOW::alice::v_sm', 更新时间:TODAY, 数据: JSON.stringify({ rid:'v_sm', on:false, by:'alice', ts:TODAY }) });
  UPD_CB({ databaseIds: [STATE_DB] });
  await flush(200);
  eq('F9 ★ 回声窗口内的外部通知被忽略（关注集不变）', Object.keys(w.FOLLOWS_RAW).length, keysBefore);

  /* ═══ F10 档案改名迁移关注键 ═══ */
  console.log('\n【F10】档案改名');
  w.renameProfile('blink', 'boss');
  await flush(200);
  ok('F10 ★ FOLLOW::boss::v_gl 存在', !!w.FOLLOWS_RAW['FOLLOW::boss::v_gl']);
  ok('F10 旧键 FOLLOW::blink::v_gl 已从内存移除', w.FOLLOWS_RAW['FOLLOW::blink::v_gl'] === undefined);
  eq('F10 改名后个人关注不丢', w.FOLLOW_MINE['v_gl'], true);
  var oldPay = null;
  for (var i = WRITE_LOG.length - 1; i >= 0; i--){
    var o10 = WRITE_LOG[i].o;
    if (o10 && o10.recordId === 'f2'){ oldPay = JSON.parse(o10.properties['数据'].text); break; }
  }
  ok('F10 ★ 旧记录软删留痕（on:false,by=旧名）', !!oldPay && oldPay.on === false && oldPay.by === 'blink');

  /* ═══ F11 删除档案 ═══ */
  console.log('\n【F11】删除档案');
  w.doDeleteProfile('alice');
  await flush(200);
  var aliceLeft = Object.keys(w.FOLLOWS_RAW).filter(function(k){ return k.indexOf('FOLLOW::alice::') === 0; });
  eq('F11 ★ alice 的个人关注全部软删', aliceLeft.length, 0);
  ok('F11 公共池不受影响', w.FOLLOW_SHARED['v_gs'] === true && w.FOLLOW_SHARED['v_sm'] === true);
  ok('F11 档案列表只剩 boss', w.PROFILE.list.length === 1 && w.PROFILE.list[0] === 'boss');

  /* ═══ F12 离线兼容（独立 JSDOM,无 SDK） ═══ */
  console.log('\n【F12】离线兼容');
  const dom2 = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
  const w2 = dom2.window;
  w2.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify([
    { record_id:'o_a', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:25, 当前价格:28.36, 一手股数:100, 最近更新:TODAY },
    { record_id:'o_b', 标的名称:'中国神华', 代码:'601088.SH', 组合层级:'卫星层', 目标仓位:7,  当前价格:48.03, 一手股数:100, 最近更新:TODAY }
  ]));
  const script2 = script;
  try { w2.eval(script2); } catch(e){ bootErr.push('eval2: ' + e.message); }
  try { w2.bootstrap(); } catch(e){ bootErr.push('bootstrap2: ' + e.message); }
  await flush(200);
  ok('F12 ★ 离线（未装载关注层）→ 全部可见（R61 前行为）',
     w2.FOLLOW_READY === false && w2.visibleRecords().length === 2);
  ok('F12 离线看板正常渲染两只标的', w2.document.getElementById('cardList').innerHTML.indexOf('长江电力') >= 0);

  /* ═══ F13 资金池/路线/决策全量口径（R63 审查修复） ═══
     取关一只不能让它带着真金白银从资金池/建仓路线/决策清单里"消失"。 */
  console.log('\n【F13】R63 资金池等页面全量口径');
  {
    /* 前置自备：给紫金塞池内资金与持仓（follows.js 的 fixture 池子为空） */
    w.POOLS['v_zj'] = { amount: 5000, note: '', since: TODAY, lastBuy: TODAY };
    const zj = w.findById('v_zj');
    zj['持仓数量'] = 100; zj['持仓成本'] = 30.01;
    w.refreshAll();
    ok('F13 前置：紫金有池内资金 5,000 元 + 持仓 100 股',
       (w.POOLS['v_zj'] || {}).amount === 5000 && w.heldQtyOf(zj) === 100);
    /* blink 取关紫金（个人关注软关,公共池也没有 → 不在关注范围） */
    w.setFollow(w.PROFILE.current, 'v_zj', false, { silent: true });
    ok('F13 前置：紫金已不在关注范围', w.visibleRecords().every(function(r){ return r._id !== 'v_zj'; }));
    w.goto('pool'); w.renderPool();
    const pwHtml = w.document.getElementById('poolWrap').innerHTML;
    ok('F13 ★ 取关后资金池仍显示紫金（钱不消失）', pwHtml.indexOf('紫金矿业') >= 0);
    const heroHtml = w.document.getElementById('poolHero').innerHTML;
    ok('F13 ★ 池内合计仍含 5,000（总账不缩水）', heroHtml.replace(/,/g, '').indexOf('5000') >= 0, heroHtml.slice(0, 200));
    w.goto('route'); w.renderRoute();
    ok('F13 ★ 建仓路线仍含紫金（计划不漏算）',
       w.document.getElementById('routeWrap').innerHTML.indexOf('紫金矿业') >= 0);
    /* 观察清单允许跟随关注范围（语义一致）——只验证不崩 */
    w.goto('watch'); w.renderWatch();
    ok('F13 观察清单渲染不抛错（跟随关注范围）', true);
  }

  /* ═══ F14 备份必须覆盖关注层（R63 审查修复,R62 遗漏） ═══ */
  console.log('\n【F14】备份/恢复覆盖关注层');
  {
    const pack = w.buildBackupPack();
    ok('F14 ★ 备份包含 follows 区块（state.follows，随导入链路走）',
       !!(pack.state.follows && Object.keys(pack.state.follows).length > 0),
       pack.state.follows ? Object.keys(pack.state.follows).length + ' 条' : 'missing');
    ok('F14 ★ follows 键格式合法（FOLLOW:: 前缀）',
       Object.keys(pack.state.follows).every(function(k){ return k.indexOf('FOLLOW::') === 0; }));
    /* 模拟「换机恢复」：清空内存关注层 → 从备份包还原 */
    w.FOLLOWS_RAW = {};
    w.FOLLOW_SEEN = {};
    w.followRebuild();
    ok('F14 前置：内存关注层已清空', Object.keys(w.FOLLOWS_RAW).length === 0);
    w.applyStateImport(pack.state);
    ok('F14 ★ 还原后关注关系回到内存', Object.keys(w.FOLLOWS_RAW).length === Object.keys(pack.state.follows).length);
    ok('F14 ★ 公共池可见集重建成功', w.FOLLOW_READY && w.followSharedCount() > 0);
  }

  /* ═══ F15 分配引擎/明细表全量口径（R64 复核补漏） ═══
     poolListOf 是 allocPlan/分配台的数据源：取关一只 = 月度定投永远分不到它的池子,
     属资金路由问题。R63 修了显示层,漏了这处真正碰钱的；明细表同理不许丢行。 */
  console.log('\n【F15】R64 分配引擎与明细台账全量口径');
  {
    /* 复用 F13 的前置：紫金有池有钱,且已被 blink(现 boss)取关 → 不在关注范围 */
    w.setFollow(w.PROFILE.current, 'v_zj', false, { silent: true });
    ok('F15 前置：紫金不在关注范围', w.visibleRecords().every(function(r){ return r._id !== 'v_zj'; }));
    ok('F15 ★ 取关后 poolListOf 仍含紫金（分配引擎不跳过它）',
       w.poolListOf('sat').some(function(r){ return r._id === 'v_zj'; }));
    /* 资金分配 smoke：把紫金池清零 → 月度资金必须能分到它（缺口 = 一手 3003）。
       金额取 30000 保证确定性：核心阶段卫星侧 = 7.5% = 2250,紫金按缺口加权必分到 >100 元,
       避免小额取整到百元后恰好为 0 的假失败。 */
    w.POOLS['v_zj'] = { amount: 0, note: '', since: TODAY, lastBuy: '' };
    var plan = w.allocPlan(30000, 0, false);
    var zjRow = null;
    for (var i = 0; i < plan.rows.length; i++) if (plan.rows[i].r._id === 'v_zj') zjRow = plan.rows[i];
    ok('F15 ★ allocPlan 给取关标的分到钱（amt > 0）', !!zjRow && zjRow.amt > 0,
       zjRow ? 'amt=' + zjRow.amt : '紫金不在 plan.rows: ' + JSON.stringify(plan.rows.map(function(x){ return x.r['标的名称']; })));
    /* 明细台账不丢行 */
    w.goto('detail'); w.renderDetail();
    ok('F15 ★ 明细表仍显示取关标的（台账不消失）',
       w.document.getElementById('detailWrap').innerHTML.indexOf('紫金矿业') >= 0);
    /* 还原现场：紫金池恢复 5,000（F13 的前置口径） */
    w.POOLS['v_zj'] = { amount: 5000, note: '', since: TODAY, lastBuy: TODAY };
    w.refreshAll();
  }

  console.log('\n──── R62 结果 ────');
  console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
  fails.forEach(function(f){ console.log('  ✗ ' + f); });
  if (bootErr.length){ console.log('  boot errors:'); bootErr.forEach(function(e){ console.log('  · ' + e); }); }
  process.exit(FAIL ? 1 : 0);
})();