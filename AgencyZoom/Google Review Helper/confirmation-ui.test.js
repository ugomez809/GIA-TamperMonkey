const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.textContent='';}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,callback){this.listeners[name]=callback;}
  click(){return this.listeners.click({preventDefault(){},stopPropagation(){}});}
}
function harness(){
  const state={writes:[],mode:'success',names:[],refreshCalls:0,time:10000000,timers:[]};
  class TestDate extends Date { static now(){return state.time;} }
  const source=fs.readFileSync(`${__dirname}/ulises-google-review-helper.user.js`,'utf8')
    .replace(/  function updateConfirmedViews\(\) \{[\s\S]*?\n  \}/,'  function updateConfirmedViews() { globalThis.refreshCalls++; }')
    .replace(/  const observer = new MutationObserver[\s\S]*$/,'globalThis.api={createConfirmationControl,reviewStore,queueAutomaticMatches,flushAutomaticMatches};})();');
  const context={console,Date:TestDate,refreshCalls:0,document:{createElement:tag=>new Element(tag)},window:{setTimeout:(callback,delay)=>{state.timers.push({callback,delay});return state.timers.length;}},
    GM_getValue:()=>'',
    GM_setValue(){},GM_xmlhttpRequest(options){
      if(options.method==='GET')return options.onload({status:200,responseText:'Timestamp,Name,Email,Comments,Rating 1-5,ChatGPT Response,GMB Page,Review ID\n2026,Selina Perez,,Great,5,,GIA,\n'});
      const body=JSON.parse(options.data); state.writes.push(body.requests);
      if(state.mode==='network')return options.onerror();
      options.onload({status:200,responseText:JSON.stringify({ok:true,results:body.requests.map(r=>{
        if(state.mode==='reject')return {ok:false,error:'Review changed'};
        state.names=r.action==='remove'?[]:[r.customerName];return {ok:true,names:state.names};
      })})});
    }};
  vm.runInNewContext(source,context);
  return {state,context,...context.api};
}
test('checkmark saves the open name, updates only after success, and supports undo',async()=>{
  const h=harness();await h.reviewStore.ensure();
  const row=h.reviewStore.match('Selina Perez').rows[0];
  const control=h.createConfirmationControl(row,()=> 'Carlos Perez');const button=control.children[0];
  assert.equal(h.reviewStore.match('Carlos Perez').status,'partial');
  await button.click();
  assert.equal(h.state.writes[0][0].customerName,'Carlos Perez');
  assert.equal(h.reviewStore.match('Carlos Perez').status,'reviewed');
  assert.match(button.textContent,/Undo/);
  await button.click();
  assert.equal(h.state.writes[1][0].action,'remove');
  assert.equal(h.reviewStore.match('Carlos Perez').status,'partial');
});
test('failed save never turns a partial into a confirmed match',async()=>{
  const h=harness();await h.reviewStore.ensure();h.state.mode='reject';
  const row=h.reviewStore.match('Selina Perez').rows[0];
  const control=h.createConfirmationControl(row,()=> 'Carlos Perez');
  await control.children[0].click();
  assert.equal(h.reviewStore.match('Carlos Perez').status,'partial');
  assert.match(control.children[1].textContent,/Review changed/);
  assert.equal(control.children[0].disabled,false);
});
test('changing the open customer prevents saving a stale search result',async()=>{
  const h=harness();let name='Carlos Perez';
  const control=h.createConfirmationControl({reviewer_name:'Selina Perez'},()=>name);
  name='Jane Doe';await control.children[0].click();
  assert.equal(h.state.writes.length,0);
  assert.match(control.children[1].textContent,/Customer changed/);
  assert.equal(h.createConfirmationControl({reviewer_name:'Selina Perez'},()=> '').children[0].disabled,true);
});
test('repeated automatic full-name observations share a single write and partial names never auto-save',async()=>{
  const h=harness();await h.reviewStore.ensure();const rows=h.reviewStore.match('Selina Perez').rows;
  for(let i=0;i<30;i++)h.queueAutomaticMatches('Selina Perez',rows);
  h.queueAutomaticMatches('Carlos Perez',rows);
  await h.flushAutomaticMatches();
  assert.equal(h.state.writes.length,1);assert.equal(h.state.writes[0].length,1);
  assert.equal(h.state.writes[0][0].action,'auto');
  assert.equal(h.state.writes[0][0].customerName,'Selina Perez');
});

test('automatic network failures retry independently of UI scans and stop after three attempts',async()=>{
  const h=harness();await h.reviewStore.ensure();h.state.mode='network';
  const rows=h.reviewStore.match('Selina Perez').rows;
  h.queueAutomaticMatches('Selina Perez',rows);
  await h.state.timers.shift().callback();
  assert.equal(h.state.writes.length,1);
  assert.equal(h.state.timers[0].delay,300000);
  h.state.time+=300000;await h.state.timers.shift().callback();
  assert.equal(h.state.writes.length,2);
  h.state.time+=300000;await h.state.timers.shift().callback();
  assert.equal(h.state.writes.length,3);assert.equal(h.state.timers.length,0);
  h.state.time+=300000;h.queueAutomaticMatches('Selina Perez',rows);
  assert.equal(h.state.timers.length,0);
});
test('automatic retry recovery marks the row without a new page scan',async()=>{
  const h=harness();await h.reviewStore.ensure();h.state.mode='network';
  const rows=h.reviewStore.match('Selina Perez').rows;
  h.queueAutomaticMatches('Selina Perez',rows);await h.state.timers.shift().callback();
  h.state.time+=300000;h.state.mode='success';await h.state.timers.shift().callback();
  assert.equal(rows[0].confirmedNames[0],'Selina Perez');
  assert.equal(h.state.writes.length,2);assert.equal(h.state.timers.length,0);
});
