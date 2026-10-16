const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function backend() {
  const context = {};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/shared-matches.gs`, 'utf8'), context);
  return context;
}
const headers = ['Timestamp','Name','Email','Comments','Rating 1-5','ChatGPT Response','GMB Page','Review ID','AgencyZoom Matches'];
const review = {original_review_date:'2026-10-16',reviewer_name:'Selina Perez',comment:'Great',rating:'5',page:'GIA',id:''};
const row = ['2026-10-16','Selina Perez','','Great','5','','GIA','',''];
test('manual confirmation targets a unique review, preserving earlier names and deduplicating', () => {
  const b=backend(); const data=[headers,[...row]];
  data[1][8]='Jane Perez';
  const result=b.planMatchWrite(data,{review,customerName:'Carlos Perez',action:'confirm'});
  assert.equal(result.row,2);
  assert.equal(result.value,'Jane Perez\nCarlos Perez');
  data[1][8]=result.value;
  assert.equal(b.planMatchWrite(data,{review,customerName:'CARLOS PEREZ',action:'confirm'}).value,result.value);
  assert.equal(b.planMatchWrite(data,{review,customerName:'Carlos Perez',action:'remove'}).value,'Jane Perez');
});
test('automatic writes cannot confirm partial matches or undo exact-name matches', () => {
  const b=backend();
  assert.throws(()=>b.planMatchWrite([headers,row],{review,customerName:'Carlos Perez',action:'auto'}),/exact/);
  assert.equal(b.planMatchWrite([headers,row],{review,customerName:'Selina Perez',action:'auto'}).value,'Selina Perez');
  assert.throws(()=>b.planMatchWrite([headers,row],{review,customerName:'Selina Perez',action:'remove'}),/exact/);
});
test('ambiguous, changed, unrelated column I and invalid names are rejected without choosing a row', () => {
  const b=backend(); const request={review,customerName:'Carlos Perez',action:'confirm'};
  assert.throws(()=>b.planMatchWrite([headers,row,row],request),/ambiguous/i);
  assert.throws(()=>b.planMatchWrite([headers,[...row.slice(0,3),'Changed',...row.slice(4)]],request),/changed|found/i);
  assert.throws(()=>b.planMatchWrite([[...headers.slice(0,8),'Other data'],row],request),/column I/i);
  assert.throws(()=>b.planMatchWrite([headers,row],{...request,customerName:'Unknown'}),/name/i);
  assert.throws(()=>b.planMatchWrite([headers,row],{...request,customerName:'=IMPORTXML("x")'}),/name/i);
});

test('endpoint authenticates before sheet access and merges a batch under one lock', () => {
  const b=backend(); const grid=[headers,[...row]]; const writes=[];
  let locks=0,opens=0,releases=0;
  b.PropertiesService={getScriptProperties:()=>({getProperty:()=> 'x'.repeat(32),setProperty(){}})};
  b.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})};
  b.LockService={getScriptLock:()=>({tryLock(){locks++;return true;},hasLock:()=>true,releaseLock(){releases++;}})};
  const sheet={getSheetId:()=>0,getLastRow:()=>grid.length,getRange:(r,c)=>({getDisplayValues:()=>grid,setNumberFormat(){return this;},setValue(value){writes.push({r,c,value});grid[r-1][c-1]=value;return this;}})};
  b.SpreadsheetApp={openById(){opens++;return {getSheets:()=>[sheet]};},flush(){}};
  const send=input=>JSON.parse(b.doPost({postData:{contents:JSON.stringify(input)}}).text);
  assert.equal(send({token:'bad',requests:[]}).ok,false);
  assert.equal(opens,0);
  const request={review,customerName:'Carlos Perez',action:'confirm'};
  const result=send({token:'x'.repeat(32),requests:[request,{...request,customerName:'Jane Perez'}]});
  assert.equal(result.results.every(r=>r.ok),true);
  assert.equal(grid[1][8],'Carlos Perez\nJane Perez');
  assert.equal(writes.every(w=>w.c===9),true);
  assert.equal(locks,1); assert.equal(releases,1);
  const count=writes.length;
  send({token:'x'.repeat(32),requests:[request]});
  assert.equal(writes.length,count);
});
