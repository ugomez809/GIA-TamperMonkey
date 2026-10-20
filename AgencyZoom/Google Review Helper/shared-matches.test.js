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

test('endpoint accepts keyless saves, validates batch before sheet access, and merges under one lock', () => {
  const b=backend(); const grid=[headers,[...row]]; const writes=[];
  let locks=0,opens=0,releases=0;
  b.PropertiesService={getScriptProperties:()=>({getProperty:()=> 'x'.repeat(32),setProperty(){}})};
  b.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})};
  b.LockService={getScriptLock:()=>({tryLock(){locks++;return true;},hasLock:()=>true,releaseLock(){releases++;}})};
  const sheet={getSheetId:()=>0,getLastRow:()=>grid.length,getRange:(r,c)=>({getDisplayValues:()=>grid,setNumberFormat(){return this;},setValue(value){writes.push({r,c,value});grid[r-1][c-1]=value;return this;}})};
  b.SpreadsheetApp={openById(){opens++;return {getSheets:()=>[sheet]};},flush(){}};
  const send=input=>JSON.parse(b.doPost({postData:{contents:JSON.stringify(input)}}).text);
  assert.equal(send({requests:[]}).ok,false);
  assert.equal(opens,0);
  const request={review,customerName:'Carlos Perez',action:'confirm'};
  const result=send({requests:[request,{...request,customerName:'Jane Perez'}]});
  assert.equal(result.results.every(r=>r.ok),true);
  assert.equal(grid[1][8],'Carlos Perez\nJane Perez');
  assert.equal(writes.every(w=>w.c===9),true);
  assert.equal(locks,1); assert.equal(releases,1);
  const count=writes.length;
  send({requests:[request]});
  assert.equal(writes.length,count);
});


test('No match table plans preserve review rows and Undo retains the audit record', () => {
  const b=backend();const data=[headers,[...row]];
  const request={review,customerName:'Carlos Perez',action:'reject'};
  const result=b.planNoMatchWrite(data,request,'2026-10-20T00:00:00Z');
  assert.equal(result.row,2);assert.equal(result.values[0],'Carlos Perez');
  assert.equal(result.values[8],'No match');
  const grid=[headers.concat(['','',...b.noMatchHeaders()]),[...row,'','',...result.values]];
  const undo=b.planNoMatchWrite(grid,{...request,action:'restore'},'later');
  assert.equal(undo.row,2);assert.equal(undo.values[7],result.values[7]);assert.equal(undo.values[8],'Undone');
  assert.throws(()=>b.planNoMatchWrite(grid,{...request,customerName:'Selina Perez'},'now'),/exact/i);
  assert.throws(()=>b.planNoMatchWrite([[...headers,'','','Other table'],row],request,'now'),/table/i);
  assert.throws(()=>b.planNoMatchWrite([headers,[...row.slice(0,8),'Carlos Perez']],request,'now'),/confirmed/i);
});


test('live handler writes only L:T for reject/restore and blocks stale confirmations', () => {
  const b=backend(); const grid=[headers.concat(Array(11).fill('')),[...row,...Array(11).fill('')]];
  const original=JSON.stringify(grid.map(r=>r.slice(0,11)));const writes=[];
  b.PropertiesService={getScriptProperties:()=>({getProperty:()=> '0',setProperty(){}})};
  b.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})};
  b.LockService={getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})};
  let maxRows=2, addedRows=0;
  const sheet={getMaxRows:()=>maxRows,insertRowsAfter:(after,count)=>{assert.equal(after,maxRows);maxRows+=count;addedRows+=count;},getSheetId:()=>0,getLastRow:()=>grid.length,getRange:(r,c,h=1,w=1)=>({
    getFormulas:()=>grid.map(()=>Array(9).fill('')),
    getDisplayValues:()=>grid,setNumberFormat(){return this;},setFontWeight(){return this;},setBackground(){return this;},
    setValues(values){values.forEach((rr,ii)=>rr.forEach((v,j)=>{if(!grid[r-1+ii])grid[r-1+ii]=[];grid[r-1+ii][c-1+j]=v;writes.push(c+j);}));return this;},
    setValue(){throw Error('Unexpected column I write');}
  })};
  b.SpreadsheetApp={openById:()=>({getSheets:()=>[sheet]}),flush(){}};
  const send=request=>JSON.parse(b.doPost({postData:{contents:JSON.stringify({requests:[request]})}}).text);
  const request={review,customerName:'Carlos Perez',action:'reject'};
  const saved=send(request);assert.equal(saved.results[0].ok,true);
  assert.deepEqual(saved.results[0].rejectedNames,['Carlos Perez']);
  const firstDate=grid[1][18];send(request);assert.equal(grid[1][18],firstDate);
  assert.equal(send({...request,action:'confirm'}).results[0].ok,false);
  assert.equal(send({...request,action:'restore'}).results[0].ok,true);
  assert.equal(grid[1][19],'Undone');
  assert.equal(JSON.stringify(grid.map(r=>r.slice(0,11))),original);
  assert.ok(writes.every(c=>c>=12 && c<=20));
  assert.equal(send({...request,customerName:'Juan Perez'}).results[0].ok,true);
  assert.equal(addedRows,1);assert.equal(grid[2][11],'Juan Perez');
});


test('setup refuses hidden formulas in the audit area',()=>{
  const b=backend();
  assert.throws(()=>b.assertNoMatchFormulaFree({getLastRow:()=>2,getRange:()=>({getFormulas:()=>[['=IF(TRUE,"","")']]})}),/formulas/i);
});
