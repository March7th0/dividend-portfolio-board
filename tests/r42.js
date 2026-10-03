/* ============================================================
   R42 弹层可见性专项
   ─────────────────────────────────────────────────────────────
   线上现象：
     「切换用户只能在『资金池』分栏操作，在别的分栏打开切换会不显示界面，
       必须点回『资金池』分栏才能继续操作」
   根因：
     三个弹层容器（#buySheet / #fundSheet / #confirmSheet）原来写在 #pane-pool 内部，
     而样式是 `.pane{display:none} .pane.on{display:block}` ——
     未激活分栏会隐藏【整个子树】，弹层即使 position:fixed 也一起被隐藏。
   ⚠️ 注意：jsdom 不做布局计算，所以「被父级 display:none 隐藏」在 jsdom 里
      无法通过 style/computedStyle 观察 —— 因此本套件用【结构断言】：
      弹层容器绝不允许出现在任何 .pane 之内。这才是能测的本质检查。
   覆盖：
     T1 三个弹层容器都不在任何 .pane 内（结构）
     T2 切到非资金池分栏后，点顶栏人形图标 → 弹层照样能打开
     T3 该状态下弹层内控件存在且可用（切换档案）
     T4 销毁类确认弹层在任何分栏下都能打开
   运行：
     export NODE_PATH="C:/Users/qq444/node_modules"
     node tests/r42.js
   ============================================================ */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'portfolio-workbench.html'), 'utf8');

let PASS = 0, FAIL = 0;
const fails = [];
function ok(name, cond, extra){ if (cond){ PASS++; } else { FAIL++; fails.push(name + (extra ? ' → ' + extra : '')); } }
function eq(name, got, want){ ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }

const TODAY = new Date().toISOString().slice(0, 10);
const RECS = [
  { record_id:'u_cp', 标的名称:'长江电力', 代码:'600900.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:28.36, 一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:26, 正常定投上限:30, 减仓起始价:45 },
  { record_id:'u_gd', 标的名称:'国电电力', 代码:'600795.SH', 组合层级:'核心层', 目标仓位:50, 当前价格:5.24,  一手股数:100, 持仓数量:0, 持仓成本:0, 最近更新:TODAY, 加倍买入价:4.5, 正常定投上限:5.5, 减仓起始价:5.8 },
];

const dom = new JSDOM(HTML, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://local.test/' });
const w = dom.window;
w.localStorage.setItem('wb_portfolio_val_v1', JSON.stringify(RECS));
w.localStorage.setItem('wb_portfolio_pools_v1', JSON.stringify({}));
w.localStorage.setItem('wb_portfolio_pool_v2', JSON.stringify({ capital: 50000, monthly:null, divPool:0, pendingPool:0, capitalLeft:50000, logs:[], phaseLock:null }));
const script = (function(h){var tags=[],re=/<script[^>]*>([\s\S]*?)<\/script>/g,m;while((m=re.exec(h))!==null)tags.push(m[1]);return tags.sort(function(a,b){return b.length-a.length;})[0];})(HTML);
const bootErr = [];
w.addEventListener('error', function(e){ bootErr.push(String(e.message || e)); });
try { w.eval(script); } catch(e){ bootErr.push('eval: ' + e.message); }
w.goOffline && w.goOffline();
try { w.poolLoad(); w.pv2Load(); w.pv2Migrate(); } catch(e){ bootErr.push('boot: ' + e.message); }
try { w.bindGlobalDelegates(); } catch(e){ bootErr.push('delegates: ' + e.message); }
try { w.renderTabs(); w.bindEvents(); w.renderPool(); } catch(e){ bootErr.push('render: ' + e.message); }

function D(id){ return w.document.getElementById(id); }
function click(el){ if (el) el.dispatchEvent(new w.Event('click', { bubbles:true, cancelable:true })); }
/* ★ jsdom 里 DOMContentLoaded 不会触发，顶栏人形图标（profBtn）的绑定要手动补上
   —— 否则点击无效，会误判成「弹层打不开」。这与产品代码无关。 */
(function bindTopBar(){
  var pb = D('profBtn');
  if (pb && !pb.__tb){ pb.__tb = 1; pb.addEventListener('click', function(){ w.openFundSheet('profile'); }); }
})();

/* ════════════════════════════════════════════════════════════
   T1 结构断言：弹层容器绝不在任何 .pane 之内
   ════════════════════════════════════════════════════════════ */
console.log('\n【T1】弹层容器必须挂在分栏体系之外');
['buySheet', 'fundSheet', 'confirmSheet'].forEach(function(id){
  var el = D(id);
  ok('T1 ' + id + ' 存在', !!el);
  /* ★ 本质检查：一旦它落在 .pane 内，未激活分栏就会让弹层消失 */
  ok('T1 ★ ' + id + ' 不在任何分栏(.pane)内', !!(el && !el.closest('.pane')),
     el && el.closest('.pane') ? '落在了 #' + el.closest('.pane').id + ' 内' : '');
});
ok('T1 页面里确实存在多个分栏（前置）', w.document.querySelectorAll('.pane').length >= 3,
   'pane 数=' + w.document.querySelectorAll('.pane').length);

/* ════════════════════════════════════════════════════════════
   T2 切到非资金池分栏后，弹层照样能打开
   ════════════════════════════════════════════════════════════ */
console.log('\n【T2】在别的分栏打开档案弹层');
var tabs = w.document.querySelectorAll('.tab[data-tab]');
ok('T2 存在分栏按钮', tabs.length >= 3, 'n=' + tabs.length);
var otherTab = null;
for (var i = 0; i < tabs.length; i++){
  if (tabs[i].getAttribute('data-tab') !== 'pool'){ otherTab = tabs[i]; break; }
}
ok('T2 找到非资金池分栏', !!otherTab, otherTab ? otherTab.getAttribute('data-tab') : '');
click(otherTab);
ok('T2 资金池分栏已隐藏',
   (D('pane-pool').className || '').indexOf('on') < 0, 'cls=' + D('pane-pool').className);
ok('T2 切到了别的分栏（该分栏已激活）',
   w.document.querySelectorAll('.pane.on').length >= 1);

/* 关键：此时点顶栏人形图标（档案入口） */
click(D('profBtn'));
ok('T2 ★ 档案弹层已打开', D('fundSheet') && D('fundSheet').style.display === 'block',
   'display=' + (D('fundSheet') ? D('fundSheet').style.display : 'n/a'));
ok('T2 ★ 弹层不在被隐藏的分栏内（所以不会跟着消失）', !D('fundSheet').closest('.pane'));

/* ════════════════════════════════════════════════════════════
   T3 该状态下弹层里的控件可用
   ════════════════════════════════════════════════════════════ */
console.log('\n【T3】非资金池分栏下，档案弹层里的控件可用');
ok('T3 切换按钮存在', !!D('profSwitch'));
ok('T3 新建按钮存在', !!D('profCreate'));
ok('T3 改名输入框存在（R40 新增）', !!D('profRenameIn'));
ok('T3 面板已渲染内容', (D('fundSheet').textContent || '').length > 40);

/* 真正点一下「新建空档案」，验证功能可用（不只是渲染出来） */
var before = w.PROFILE.list.length;
var newIn = D('profNew');
if (newIn) newIn.value = '分栏测试用户';
click(D('profCreate'));
ok('T3 ★ 在非资金池分栏下新建档案生效', w.PROFILE.list.length === before + 1,
   'before=' + before + ' after=' + w.PROFILE.list.length);

/* ════════════════════════════════════════════════════════════
   T4 销毁类确认弹层在任何分栏下都能打开
   ════════════════════════════════════════════════════════════ */
console.log('\n【T4】确认弹层（初始化重置）在非资金池分栏下也能打开');
w.PV2.capital = 12345;
w.renderPool();
click(D('fullResetBtn'));
ok('T4 ★ 确认弹层已打开', D('confirmSheet') && D('confirmSheet').style.display === 'block',
   'display=' + (D('confirmSheet') ? D('confirmSheet').style.display : 'n/a'));
ok('T4 弹层不在被隐藏的分栏内', !D('confirmSheet').closest('.pane'));
ok('T4 有确定/取消按钮', !!D('cfOk') && !!D('cfCancel'));
click(D('cfCancel'));

/* ════════════════════════════════════════════════════════════
   T5 更新日志：固定高度 + 内部滚动（不许把手册屏拉长）
   jsdom 不做布局计算，因此用「样式表规则断言」——检查 CSS 里确实写了限高与滚动。
   ════════════════════════════════════════════════════════════ */
console.log('\n【T5】更新日志限高滚动（界面变长类问题）');
var cssText = (function(){
  var st = w.document.querySelectorAll('style'), t = '';
  for (var i = 0; i < st.length; i++) t += st[i].textContent || '';
  return t;
})();
ok('T5 更新日志容器存在', !!w.document.getElementById('changelog'));
ok('T5 ★ CSS 给更新日志设了最大高度', /#changelog \.tbwrap\{[^}]*max-height/.test(cssText));
ok('T5 ★ CSS 给了纵向滚动', /#changelog \.tbwrap\{[^}]*overflow-y:auto/.test(cssText));
ok('T5 ★ 表头吸顶（滚动时仍看得见列名）', /#changelog thead th\{[^}]*position:sticky/.test(cssText));
ok('T5 ★ 表格改为定宽以便第三列换行（避免横向拖动）', /#changelog table\{[^}]*table-layout:fixed/.test(cssText));
ok('T5 移动端有更矮的限高', /@media \(max-width:768px\)\{ #changelog \.tbwrap\{max-height/.test(cssText));
ok('T5 提示了「可上下滚动」', (w.document.getElementById('changelog').textContent || '').indexOf('可上下滚动') >= 0);
ok('T5 ★ 管理员面板的档案表同样限高（档案变多不拉长弹层）',
   /#profAdminTable\{[^}]*max-height/.test(cssText) && /#profAdminTable\{[^}]*overflow-y:auto/.test(cssText));

console.log('\n【运行时】');
ok('★ 全程无运行时错误', bootErr.length === 0, bootErr.join(' | '));

console.log('\n========================================');
console.log('PASS: %d   FAIL: %d', PASS, FAIL);
if (fails.length){ console.log('\n失败项：'); fails.forEach(function(f){ console.log('  ✗ ' + f); }); }
else console.log('全部通过 ✓');
process.exit(FAIL ? 1 : 0);
