const path=require('path'),fs=require('fs');
const {JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'portfolio-workbench.html'),'utf8');
const RECS=[
 {_id:'r1','标的名称':'长江电力','代码':'600900.SH','组合层级':'核心层','目标仓位':20,'当前价格':28.36,'一手股数':100,'持仓数量':0,'减仓起始价':35},
 {_id:'r2','标的名称':'国电电力','代码':'600795.SH','组合层级':'核心层','目标仓位':20,'当前价格':5.24,'一手股数':100,'持仓数量':1000,'持仓成本':5.5,'减仓起始价':7},
 {_id:'r3','标的名称':'工商银行','代码':'601398.SH','组合层级':'核心层','目标仓位':20,'当前价格':8.13,'一手股数':100,'持仓数量':0,'减仓起始价':10},
 {_id:'r4','标的名称':'中国神华','代码':'601088.SH','组合层级':'卫星层','目标仓位':10,'当前价格':48.03,'一手股数':100,'持仓数量':0,'减仓起始价':48},
 {_id:'r5','标的名称':'紫金矿业','代码':'601899.SH','组合层级':'卫星层','目标仓位':10,'当前价格':18.20,'一手股数':100,'持仓数量':0,'减仓起始价':25},
 {_id:'r6','标的名称':'兖矿能源','代码':'600188.SH','组合层级':'卫星层','目标仓位':10,'当前价格':19.76,'一手股数':100,'持仓数量':0,'减仓起始价':26},
 {_id:'r7','标的名称':'中国联通','代码':'600050.SH','组合层级':'卫星层','目标仓位':10,'当前价格':5.53,'一手股数':100,'持仓数量':0,'减仓起始价':8},
 {_id:'r8','标的名称':'卫星层备选甲','代码':'000002.SZ','组合层级':'卫星层备选','目标仓位':5,'当前价格':12,'一手股数':100,'持仓数量':0},
 {_id:'r9','标的名称':'排除乙','代码':'000003.SZ','组合层级':'排除','目标仓位':0,'当前价格':9,'一手股数':100,'持仓数量':0}
];
const errs=[]; let pass=0,fail=0; const F=[];
function ok(n,c,e){ if(c)pass++; else{fail++;F.push(n+(e?' → '+e:''));} }
const dom=new JSDOM(src,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://local.test/'});
const w=dom.window,d=w.document;
w.addEventListener('error',e=>errs.push('window.error: '+e.message));
w.localStorage.setItem('wb_portfolio_val_v1',JSON.stringify(RECS));
w.eval(d.querySelector('script').textContent);
w.RECORDS=RECS; w.poolLoad(); w.pv2Load(); w.pv2Migrate(); w.renderTabs(); w.bindEvents(); w.goOffline('t');

const TABS=['board','detail','decide','pool','route','watch','input','method'];
for(const tb of TABS){
  const b=d.querySelector('.tab[data-tab="'+tb+'"]');
  ok('Tab 存在: '+tb, !!b);
  if(b){ try{ b.click(); }catch(e){ ok('Tab 切换无异常: '+tb,false,e.message); } }
}
ok('Tab 按钮 8 个', d.querySelectorAll('.tab').length===8, 'n='+d.querySelectorAll('.tab').length);
ok('底部入口 8 个', d.querySelectorAll('.bt').length===8, 'n='+d.querySelectorAll('.bt').length);

// 所有 pane 渲染非空
for(const tb of TABS){
  const p=d.querySelector('#pane-'+tb);
  ok('pane 存在: '+tb, !!p);
}
ok('pool 屏 pane 有内容', d.querySelector('#pane-pool').textContent.length>200);

// 关键回归
const recs=w.sortedRecs();
ok('组合 7 只', recs.filter(r=>w.isInPortfolio(r)).length===7, 'n='+recs.filter(r=>w.isInPortfolio(r)).length);
ok('备选/排除不计入组合', !recs.filter(r=>w.isInPortfolio(r)).some(r=>/备选|排除/.test(r['标的名称'])));
const ti=w.statTier();
ok('核心 3 / 卫星 4', ti.core.n===3&&ti.sat.n===4, ti.core.n+'/'+ti.sat.n);
ok('联通 5.53', parseFloat(recs.find(r=>/联通/.test(r['标的名称']))['当前价格'])===5.53);
ok('兖矿 19.76', parseFloat(recs.find(r=>/兖矿/.test(r['标的名称']))['当前价格'])===19.76);
ok('市值计算正常(国电1000股)', Math.abs(w.totalMV()-5240)<1, 'mv='+w.totalMV());

// 可见区无脏字（排除 script 源码）
let vt=''; d.querySelectorAll('.pane').forEach(p=>vt+=p.textContent+'\n');
ok('可见区无 NaN', !/NaN/.test(vt), (vt.match(/.{0,30}NaN.{0,15}/)||[''])[0]);
ok('可见区无 undefined', !/undefined/.test(vt), (vt.match(/.{0,30}undefined.{0,15}/)||[''])[0]);
ok('可见区无 Infinity', !/Infinity/.test(vt));
ok('无运行时错误', errs.length===0, errs.join('; '));

console.log('\n===== 回归测试 =====');
console.log('PASS:'+pass+'  FAIL:'+fail);
if(fail){ F.forEach(x=>console.log('  x '+x)); process.exit(1); }
console.log('全部通过 ✓');
process.exit(0);
