/* ============================================================
   R40 档案管理专项套件：改名 / 删除 / 密码 / 切换认证 / 管理员
   覆盖：
     P1 老数据兼容：云端 PROFILE 无 meta → 首个档案自动成为管理员
     P2 改名：list / meta / current / 云端分组（pools·pv2·holdings）一起迁移
     P3 设置与关闭切换密码
     P4 切换认证：有密码的档案必须验证通过才切；错误密码不切
     P5 删除：密码确认 → 二次确认 → 数据与云端分组一并删除
     P6 不允许删到 0 个档案
     P7 管理员面板：管理员看得到全部档案状态；非管理员看不到
     P8 界面控件齐备（改名输入/密码输入/删除按钮）
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r40.js
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
const R_POOLS = 'mC4rTAw4nEVRvqcrpFnf4K';
const R_PV2   = 'xHo47TEYkdMoLZhuqDRYsj';
const R_HOLD  = 'uxwbZTqSxwzwY2Ju7rk3w3';
const R_PROF  = 'DdLu2A8Zsa09jZL4awFNKP';
const TODAY = new Date().toISOString().slice(0, 10);

const VAL_ROWS = [
  { record_id:'v_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'v_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
];

/* ★ P1 的核心：云端 PROFILE 有意【不带 meta】—— 复现老数据 */
const STATE_ROWS = [
  { record_id: R_POOLS, 键:'POOLS',    更新时间:'2026-09-26T13:30:00Z', 数据: JSON.stringify({
      blink: { v_cp: { amount: 12000, note:'', since:'2026-09-01' } },
      friend: { v_gd: { amount: 3000, note:'', since:'2026-09-10' } } }) },
  { record_id: R_PV2,   键:'PV2',      更新时间:'2026-09-26T13:30:00Z', 数据: JSON.stringify({
      blink: { capital: 100000, monthly:null, divPool:0, divSince:null, divMode:'single',
               pendingPool:0, capitalLeft:60000, startISO:null,
               logs:[{seq:1,ts:'2026-09-20T01:00:00.000Z',type:'capital',label:'x',amount:100000,detail:''}], phaseLock:null, __ts:'2026-09-26T13:30:00.000Z' },
      friend: { capital: 20000, monthly:null, divPool:0, divSince:null, divMode:'single',
               pendingPool:0, capitalLeft:17000, startISO:null, logs:[], phaseLock:null, __ts:'2026-09-26T13:30:00.000Z' } }) },
  { record_id: R_HOLD,  键:'HOLDINGS', 更新时间:'2026-09-26T13:30:00Z', 数据: JSON.stringify({
      blink: { v_cp: { qty: 800, cost: 28.36 } },
      friend: { v_gd: { qty: 1400, cost: 5.24 } } }) },
  { record_id: R_PROF,  键:'PROFILE',  更新时间:'2026-09-26T13:30:00Z', 数据: JSON.stringify({ current:'blink', list:['blink','friend'] }) },
];

const UPDATE_LOG = [];
/* ★ R43：状态表改成「每档案独立记录」后，程序会用 addRecord 动态建记录 ——
   mock 必须支持这件事（并返回 record_id，否则 REC_INDEX 建不起来、
   后续的 updateRecord 就找不到目标记录）。 */
const DYN = {};                       /* 键 → { record_id, 键, 数据 } */
let NEXT_DYN = 900;
function makeDb(){
  return {
    getSchema: function(){ return Promise.resolve({ properties: [
      { name:'组合层级', type:'select', config:{ options:[{text:'核心层'},{text:'卫星层'},{text:'卫星层备选'},{text:'排除'}] } },
      { name:'跟踪状态', type:'select', config:{ options:[{text:'持有'},{text:'等待'}] } }
    ] }); },
    query: function(o){
      var id = o && o.databaseId;
      if (id === VAL_DB)  return Promise.resolve({ results: VAL_ROWS.map(function(r){ return Object.assign({}, r); }), hasMore: false });
      if (id === STATE_DB){
        var base = STATE_ROWS.map(function(r){ return Object.assign({}, r); });
        Object.keys(DYN).forEach(function(k){
          base.push({ record_id: DYN[k].record_id, 键: k, 数据: DYN[k].数据, 更新时间: '2026-09-26T15:00:00Z' });
        });
        return Promise.resolve({ results: base, hasMore: false });
      }
      return Promise.resolve({ results: [], hasMore: false });
    },
    updateRecord: function(o){
      UPDATE_LOG.push(o);
      var pr = o.properties || {};
      Object.keys(DYN).forEach(function(k){
        if (DYN[k].record_id !== o.recordId) return;
        if (pr['键'] && pr['键'].text !== k){ var mv = DYN[k]; delete DYN[k]; mv.键 = pr['键'].text; DYN[mv.键] = mv; k = mv.键; }
        if (pr['数据']){ var kk = pr['键'] ? pr['键'].text : k; DYN[kk].数据 = pr['数据'].text; }
      });
      return Promise.resolve({ ok: 1 });
    },
    addRecord: function(o){
      UPDATE_LOG.push(o);
      var pr = o.properties || {};
      var key = (pr['键'] && pr['键'].text) || ('anon_' + NEXT_DYN);
      var rid = 'dyn_' + (NEXT_DYN++);
      DYN[key] = { record_id: rid, 键: key, 数据: (pr['数据'] && pr['数据'].text) || '{}' };
      return Promise.resolve({ record_id: rid });
    },
    onUpdated: function(){}
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
function D(id){ return w.document.getElementById(id); }
function click(el){ if (el) el.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
/* 页面内弹层操作 */
function cfOk(){ click(D('cfOk')); return !!D('cfOk'); }
function cfCancel(){ click(D('cfCancel')); }
function ciOpen(){ return !!D('ciVal'); }
function ciType(v){ var i = D('ciVal'); if (i) i.value = v; }
function ciOk(){ click(D('ciOk')); }
function lastProfWrite(){
  for (var i = UPDATE_LOG.length - 1; i >= 0; i--){
    if (UPDATE_LOG[i].recordId === R_PROF) return UPDATE_LOG[i];
  }
  return null;
}

(async function main(){

  try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
  try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){ bootErr.push('boot: ' + e.message); }
  try { w.bootstrap(); } catch(e){ bootErr.push('bootstrap: ' + e.message); }
  await flush(180);

  /* ════════════════════════════════════════════════════════════
     P1 老数据兼容 + 管理员自动产生
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P1】老数据（无 meta）→ 首个档案自动成为管理员');
  eq('P1 档案列表来自云端', w.PROFILE.list.length, 2);
  ok('P1 PROFILE.meta 已建立', !!w.PROFILE.meta);
  ok('P1 ★ blink 自动成为管理员', w.isAdminProfile('blink') === true);
  ok('P1 friend 不是管理员', w.isAdminProfile('friend') === false);
  eq('P1 老档案默认无密码', w.profMeta('friend').pass, '');

  /* ════════════════════════════════════════════════════════════
     P8 界面控件齐备（管理员视角）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P8】档案弹层控件齐备');
  w.openFundSheet('profile');
  await flush(60);
  ok('P8 改名输入框存在', !!D('profRenameIn'));
  ok('P8 密码输入框存在（type=password）', !!D('profPassIn') && D('profPassIn').getAttribute('type') === 'password');
  ok('P8 切换按钮存在', !!D('profSwitch'));
  ok('P8 新建按钮存在', !!D('profCreate'));
  var delBtns = w.document.querySelectorAll('[data-act="prof-del"]');
  ok('P8 ★ 管理员看到删除按钮（' + delBtns.length + ' 个）', delBtns.length === 2, 'n=' + delBtns.length);
  ok('P8 面板内含「管理员面板」字样', (D('fundSheet').textContent || '').indexOf('管理员面板') >= 0);
  ok('P8 声明了「不是加密」（诚实告知）', (D('fundSheet').textContent || '').indexOf('不是加密') >= 0);

  /* ════════════════════════════════════════════════════════════
     P2 改名（含云端分组迁移）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P2】改名：数据必须一起迁移');
  UPDATE_LOG.length = 0;
  var renameIn = D('profRenameIn');
  if (renameIn) renameIn.value = 'blink新名';
  w.renameProfile('blink', 'blink新名');
  await flush(80);
  ok('P2 list 已改名', w.PROFILE.list.indexOf('blink新名') >= 0);
  ok('P2 旧名已从 list 移除', w.PROFILE.list.indexOf('blink') < 0);
  eq('P2 current 跟随改名', w.PROFILE.current, 'blink新名');
  ok('P2 ★ meta 跟随改名（仍是管理员）', w.isAdminProfile('blink新名') === true);
  /* 云端分组必须迁移：pools/pv2/holdings 里新键有数据 */
  var pw = lastProfWrite();
  ok('P2 PROFILE 记录已写入云端', !!pw);
  /* ★ R43 存储格式变更：不再是「记录内 {档案名:数据} 分组」，
     而是「每个档案 3 条独立记录」，键形如 POOLS::档案名。
     断言改为按记录的「键」字段查找写入。 */
  function lastWriteByKey(key){
    for (var i = UPDATE_LOG.length - 1; i >= 0; i--){
      var pr = UPDATE_LOG[i].properties || {};
      if (pr['键'] && pr['键'].text === key) return UPDATE_LOG[i];
    }
    return null;
  }
  var wNew = lastWriteByKey('POOLS::blink新名');
  var hNew = lastWriteByKey('HOLDINGS::blink新名');
  ok('P2 ★★ 池已写到新键记录 POOLS::blink新名', !!wNew);
  ok('P2 ★★ 持仓已写到新键记录 HOLDINGS::blink新名', !!hNew);
  var wNewData = null;
  try { wNewData = JSON.parse(wNew.properties['数据'].text); } catch(e){}
  ok('P2 ★ 新键记录里就是该档案的池数据（v_cp）', !!(wNewData && wNewData.v_cp), JSON.stringify(wNewData));
  ok('P2 ★★ 旧键记录 POOLS::blink 不再被写（已整体改名）', !lastWriteByKey('POOLS::blink'));
  ok('P2 friend 的记录未被波及', !lastWriteByKey('POOLS::friend'));

  /* ════════════════════════════════════════════════════════════
     P3 设置 / 关闭切换密码
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P3】设置与关闭切换密码');
  w.setProfilePass('friend', '1234');
  await flush(40);
  eq('P3 friend 已设密码', w.profMeta('friend').pass, '1234');
  var pw2 = lastProfWrite();
  var profObj = null;
  try { profObj = JSON.parse(pw2.properties['数据'].text); } catch(e){}
  ok('P3 ★ 密码已落到云端 PROFILE 记录', !!(profObj && profObj.meta && profObj.meta.friend && profObj.meta.friend.pass === '1234'),
     JSON.stringify(profObj && profObj.meta));

  /* ════════════════════════════════════════════════════════════
     P4 切换认证
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P4】切换到有密码的档案必须验证');
  w.openFundSheet('profile');
  await flush(40);
  var sel = D('profSel');
  if (sel) sel.value = 'friend';
  click(D('profSwitch'));
  ok('P4 ★ 弹出密码输入层', ciOpen());
  ok('P4 未验证前仍停留在原档案', w.PROFILE.current === 'blink新名', 'cur=' + w.PROFILE.current);
  /* 错误密码 */
  ciType('9999'); ciOk();
  ok('P4 ★ 错误密码不切换', w.PROFILE.current === 'blink新名', 'cur=' + w.PROFILE.current);
  /* 正确密码 */
  w.openFundSheet('profile'); await flush(30);
  var sel2 = D('profSel'); if (sel2) sel2.value = 'friend';
  click(D('profSwitch'));
  ok('P4 再次弹出密码层', ciOpen());
  ciType('1234'); ciOk();
  await flush(80);
  eq('P4 ★ 正确密码切换成功', w.PROFILE.current, 'friend');

  /* ════════════════════════════════════════════════════════════
     P6 不允许删到 0 个
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P6】保护：不能删到只剩 0 个档案');
  var savedList = w.PROFILE.list.slice();
  w.PROFILE.list = ['onlyOne'];
  w.PROFILE.current = 'onlyOne';
  w.askDeleteProfile('onlyOne');
  ok('P6 ★ 拒绝删除最后一个档案', w.PROFILE.list.length === 1);
  ok('P6 未弹出密码层', !ciOpen());
  w.PROFILE.list = savedList;
  w.PROFILE.current = 'blink新名';

  /* ════════════════════════════════════════════════════════════
     P5 删除（密码确认 + 二次确认）
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P5】删除档案需要密码 + 二次确认');
  UPDATE_LOG.length = 0;
  w.askDeleteProfile('friend');
  ok('P5 ★ 弹出密码输入层（friend 有密码）', ciOpen());
  ciType('0000'); ciOk();
  ok('P5 ★ 密码错误 → 不删除', w.PROFILE.list.indexOf('friend') >= 0);
  /* 正确密码 */
  w.askDeleteProfile('friend');
  ciType('1234'); ciOk();
  await flush(30);
  ok('P5 密码通过后进入二次确认', !!D('cfOk'));
  cfCancel();
  ok('P5 取消二次确认 → 仍未删除', w.PROFILE.list.indexOf('friend') >= 0);
  /* 走完整流程 */
  w.askDeleteProfile('friend');
  ciType('1234'); ciOk();
  await flush(30);
  cfOk(); cfOk();
  await flush(80);
  ok('P5 ★ 档案已从列表删除', w.PROFILE.list.indexOf('friend') < 0, JSON.stringify(w.PROFILE.list));
  ok('P5 ★ meta 同步清除', !w.PROFILE.meta.friend);
  /* ★ R43：删除档案 = 把它的独立记录改写成 TRASH:: 前缀并清空数据 */
  function trashWrites(){
    return UPDATE_LOG.filter(function(o){
      var pr = o.properties || {};
      return pr['键'] && String(pr['键'].text).indexOf('TRASH::') === 0 &&
             String(pr['键'].text).indexOf('friend') >= 0;
    });
  }
  var tw = trashWrites();
  ok('P5 ★★ 该档案的独立记录被改写为 TRASH::（数据不再被装载）', tw.length >= 1, 'n=' + tw.length);
  var allEmpty = tw.length > 0;
  for (var q = 0; q < tw.length; q++){
    try { if (Object.keys(JSON.parse(tw[q].properties['数据'].text)).length !== 0) allEmpty = false; } catch(e){ allEmpty = false; }
  }
  ok('P5 ★ 这些记录的数据已清空', allEmpty);

  /* ════════════════════════════════════════════════════════════
     P7 非管理员看不到管理面板
     ════════════════════════════════════════════════════════════ */
  console.log('\n【P7】非管理员看不到管理面板');
  w.createProfile('普通用户X');
  await flush(60);
  w.openFundSheet('profile');
  await flush(40);
  var txt = D('fundSheet').textContent || '';
  ok('P7 ★ 非管理员看不到删除按钮', w.document.querySelectorAll('[data-act="prof-del"]').length === 0);
  ok('P7 ★ 非管理员看不到管理员面板', txt.indexOf('管理员面板') < 0);
  ok('P7 但仍能看到改名/密码控件', !!D('profRenameIn') && !!D('profPassIn'));

  console.log('\n【运行时】');
  ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

  console.log('\n========================================');
  console.log('PASS: %d   FAIL: %d', PASS, FAIL);
  if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
  else console.log('全部通过 ✓');
  process.exit(FAIL ? 1 : 0);
})();
