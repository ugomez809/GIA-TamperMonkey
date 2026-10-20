const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/ulises-google-review-helper.user.js`, 'utf8');
function api(extra = {}) {
  const context = { Map, Date, URLSearchParams, console, ...extra };
  vm.runInNewContext(source.replace(/  const observer = new MutationObserver[\s\S]*$/, '  globalThis.api = { createReviewStore, parseReviewCsv, findActiveFullName, extractSmsRowName };\n})();'), context);
  return context.api;
}
const csv = 'Timestamp,Name,Email,Comments,Rating 1-5,ChatGPT Response,GMB Page,Review ID\r\n2026-10-16,"José, Gomez",private@example.com,"Great, thanks\n""team""",5,,GIA,123\r\n2026-10-15,Jane Doe,,,4,,Farmers,456\r\n';
function setup() {
  let time = 10000000, requests = 0, response = csv, fail = false;
  const disk = new Map();
  const options = { readConfirmation: row => disk.get('match:'+row.reviewer_name), writeConfirmation: (row,value) => disk.set('match:'+row.reviewer_name,value), now: () => time, read: () => disk.get('data'), write: v => disk.set('data', v), fetchCsv: async () => { requests++; if (fail) throw Error('offline'); return response; } };
  const store = api().createReviewStore(options);
  return {store, options, disk, count: () => requests, advance: ms => time += ms, fail: () => fail = true, respond: text => response = text};
}
test('CSV handles embedded newlines/quotes and stores only needed fields', () => {
  const rows = api().parseReviewCsv('\uFEFF' + csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].reviewer_name, 'José, Gomez');
  assert.equal(rows[0].rating, '5');
  assert.ok(!JSON.stringify(rows).includes('private@example.com'));
  assert.throws(() => api().parseReviewCsv('<html>Sign in</html>'));
  assert.throws(() => api().parseReviewCsv('Name,Timestamp\n'));
  assert.throws(() => api().parseReviewCsv('Name,Timestamp\n"broken,2026'));
});
test('parallel lookups share one download and use normalized exact matches', async () => {
  const s = setup();
  await Promise.all(Array.from({length:100}, () => s.store.ensure()));
  assert.equal(s.count(), 1);
  assert.equal(s.store.exact('JOSE GOMEZ').length, 1);
  assert.equal(s.store.exact('Jane').length, 0);
  assert.equal(s.store.search('jane').length, 1);
});
test('persistent cache survives reload; expired data refreshes', async () => {
  const s = setup(); await s.store.ensure();
  const second = api().createReviewStore(s.options);
  await second.ensure(); assert.equal(s.count(), 1);
  s.advance(59 * 60 * 1000);
  await second.ensure(); assert.equal(s.count(), 1);
  s.advance(60 * 1000 + 1);
  s.respond(csv.replace('Jane Doe', 'Janet Doe'));
  await second.ensure();
  assert.equal(s.count(), 2);
  assert.equal(second.exact('Jane Doe').length, 0);
  assert.equal(second.exact('Janet Doe').length, 1);
});
test('failed refresh retains last good data and backs off', async () => {
  const s = setup(); await s.store.ensure(); s.advance(3600001); s.fail();
  await s.store.ensure(); await s.store.ensure();
  assert.equal(s.count(), 2);
  assert.equal(s.store.exact('Jane Doe').length, 1);
  assert.equal(s.store.status().stale, true);
  assert.match(s.store.status().error, /offline/);
});
test('invalid CSV cannot replace good cache; cold failures reject', async () => {
  const s = setup(); await s.store.ensure();
  const before = s.disk.get('data'); s.respond('<html>login</html>');
  await s.store.ensure(true);
  assert.equal(s.disk.get('data'), before);
  const cold = setup(); cold.fail();
  await assert.rejects(cold.store.ensure(), /offline/);
  await assert.rejects(cold.store.ensure(), /offline/);
  assert.equal(cold.count(), 1);
});
test('manual refresh bypasses the one-hour cache', async () => {
  const s = setup(); await s.store.ensure();
  s.respond(csv.replace('Jane Doe', 'Janet Doe'));
  await s.store.ensure(true);
  assert.equal(s.count(), 2);
  assert.equal(s.store.exact('Janet Doe').length, 1);
});
test('missing or corrupt storage does not stop live lookups', async () => {
  const store = api().createReviewStore({fetchCsv: async () => csv, read: () => '{bad', write: () => { throw Error('quota'); }});
  await store.ensure();
  assert.equal(store.exact('Jane Doe').length, 1);
});
test('partial search is capped at 50 while exact lookup finds later rows', async () => {
  const text = 'Timestamp,Name,Rating 1-5\n' + Array.from({length:100}, (_,i) => `2026-10-16,Jane Doe ${i},5`).join('\n');
  const store = api().createReviewStore({fetchCsv: async () => text, read: () => '', write: () => {}});
  await store.ensure();
  assert.equal(store.search('jane').length, 50);
  assert.equal(store.exact('Jane Doe 99').length, 1);
});
test('any whole name word matches, with exact names taking priority', async () => {
  const s = setup(); await s.store.ensure();
  assert.equal(s.store.match('Juan Carlos Gomez Ruiz').status, 'partial');
  assert.equal(s.store.match('JOSE GOMEZ').status, 'reviewed');
  assert.equal(s.store.match('Janet Smith').status, 'missing');
  assert.equal(s.store.match('Jane Jones').rows[0].reviewer_name, 'Jane Doe');
  assert.equal(s.store.match('J Smith').status, 'missing');
});
test('all candidate reviews are returned without duplicates or the manual-search cap', async () => {
  const text = 'Timestamp,Name,Rating 1-5\n' + Array.from({length:75}, (_,i) => `2026-10-16,Jane Doe ${i},5`).join('\n');
  const store = api().createReviewStore({fetchCsv: async () => text, read: () => '', write: () => {}});
  await store.ensure();
  const result = store.match('Jane Doe 74');
  assert.equal(result.status, 'reviewed');
  assert.equal(result.rows.length, 75);
  assert.equal(result.rows[0].reviewer_name, 'Jane Doe 74');
});
test('cache includes review comments and page; old schema is refreshed', async () => {
  const s = setup(); await s.store.ensure();
  assert.equal(s.store.match('Jose Gomez').rows[0].comment, 'Great, thanks\n"team"');
  assert.equal(s.store.match('Jose Gomez').rows[0].page, 'GIA');
  const saved = JSON.parse(s.disk.get('data')); saved.version = 1;
  s.disk.set('data', JSON.stringify(saved));
  await api().createReviewStore(s.options).ensure();
  assert.equal(s.count(), 2);
});
test('authoritative unknown SMS name never falls back to page labels', () => {
  const a = api({document: { querySelector: selector => selector === '.tm-header-title .contact-name' ? {textContent:'Unknown'} : null, querySelectorAll: selector => selector === '.tm-info-boxes' ? [] : [{textContent:'Visit History'}] }});
  assert.equal(a.findActiveFullName(), '');
});

test('SMS row matching uses only the contact heading, never message text or phone numbers', () => {
  const { extractSmsRowName } = api();
  const row = text => ({ querySelector: selector => selector === 'h6.thread-name' ? { textContent: text } : null, textContent: 'Hi George Underwood' });
  assert.equal(extractSmsRowName(row('(831) 594-7182')), '');
  assert.equal(extractSmsRowName(row('65821')), '');
  assert.equal(extractSmsRowName(row('Unknown')), '');
  assert.equal(extractSmsRowName(row('George Underwood')), 'George Underwood');
});

test('column I confirmation makes a different customer an exact match on next pull', async () => {
  const s = setup();
  s.respond('Timestamp,Name,Email,Comments,Rating 1-5,ChatGPT Response,GMB Page,Review ID,AgencyZoom Matches\n2026-10-16,Selina Perez,,Great,5,,GIA,,Carlos Perez\n');
  await s.store.ensure();
  assert.equal(s.store.match('Carlos Perez').status, 'reviewed');
  assert.equal(s.store.match('Carlos Perez').exactRows[0].reviewer_name, 'Selina Perez');
  assert.equal(s.store.match('Carlos Other').status, 'partial');
  const next = api().createReviewStore(s.options);
  await next.ensure();
  assert.equal(next.match('Carlos Perez').status, 'reviewed');
});

test('acknowledged confirmation updates local and shared cache without extending the one-hour TTL', async () => {
  const s=setup(); await s.store.ensure();
  const before=s.store.status().fetchedAt;
  const review=s.store.match('Jane Doe').rows[0];
  s.advance(1000);
  s.store.applyConfirmation(review,['Carlos Perez']);
  assert.equal(s.store.match('Carlos Perez').status,'reviewed');
  assert.equal(s.store.status().fetchedAt,before);
  const other=api().createReviewStore(s.options); await other.ensure();
  assert.equal(other.match('Carlos Perez').status,'reviewed');
  s.store.applyConfirmation(review,[]);
  assert.equal(s.store.match('Carlos Perez').status,'missing');
  assert.equal(s.count(),1);
});
test('multiline confirmations survive quoted CSV and old v2 cache is migrated', async () => {
  const s=setup();
  s.respond('Timestamp,Name,Email,Comments,Rating 1-5,ChatGPT Response,GMB Page,Review ID,AgencyZoom Matches\n2026-10-16,Selina Perez,,Great,5,,GIA,,"Carlos Perez\nJane Doe"\n');
  await s.store.ensure();
  assert.equal(s.store.match('Jane Doe').status,'reviewed');
  const saved=JSON.parse(s.disk.get('data')); saved.version=2;
  s.disk.set('data',JSON.stringify(saved));
  await api().createReviewStore(s.options).ensure();
  assert.equal(s.count(),2);
});

test('two tabs keep different acknowledged matches without overwriting shared cache', async () => {
  const s=setup();await s.store.ensure();const second=api().createReviewStore(s.options);await second.ensure();
  const one=s.store.match('Jose Gomez').rows[0],two=second.match('Jane Doe').rows[0];
  s.advance(1000);s.store.applyConfirmation(one,['Alice Smith'],10001000);
  second.applyConfirmation(two,['Bob Jones'],10001001);
  const reload=api().createReviewStore(s.options);await reload.ensure();
  assert.equal(reload.match('Alice Smith').status,'reviewed');
  assert.equal(reload.match('Bob Jones').status,'reviewed');
  second.applyConfirmation(two,[],10001002);
  s.store.applyConfirmation(two,['Bob Jones'],10001001);
  const afterUndo=api().createReviewStore(s.options);await afterUndo.ensure();
  assert.equal(afterUndo.match('Bob Jones').status,'missing');
});

test('a CSV download started before a save cannot erase that acknowledged match', async () => {
  const s=setup(); await s.store.ensure();
  let finish;const options={...s.options,fetchCsv:()=>new Promise(resolve=>finish=resolve)};
  const store=api().createReviewStore(options);await store.ensure();
  const oldRow=store.match('Jane Doe').rows[0];
  s.advance(1000);const pending=store.ensure(true);
  s.advance(1000);store.applyConfirmation(oldRow,['Carlos Perez'],123);
  s.advance(1000);finish(csv);await pending;
  assert.equal(store.match('Carlos Perez').status,'reviewed');
});


test('No match is customer-and-review scoped; new reviews remain eligible and Undo restores yellow', async () => {
  const headers=['Timestamp','Name','Email','Comments','Rating 1-5','ChatGPT Response','GMB Page','Review ID','AgencyZoom Matches','','','No Match Customer','Google Reviewer','Google Review ID','Review Date','Rating','Review Text','Google Page','Marked At (UTC)','No Match Status'];
  const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const old=['2026','Selina Perez','','Great','5','','GIA','old-id',''];
  const audit=['Carlos Perez','Selina Perez','old-id','2026','5','Great','GIA','2026-10-20T00:00:00Z','No match'];
  const serialize=rows=>[headers,...rows].map(r=>r.map(quote).join(',')).join('\n');
  let response=serialize([[...old,'','',...audit]]);
  const store=api().createReviewStore({fetchCsv:async()=>response,read:()=>'',write:()=>{}});
  await store.ensure();
  assert.equal(store.match('Carlos Perez').status,'missing');
  assert.equal(store.match('Carlos Perez').dismissedRows.length,1);
  assert.equal(store.match('Juan Perez').status,'partial');
  assert.equal(store.match('Selina Perez').status,'reviewed');
  response=serialize([[...old,'','',...audit],['2027','Selina Perez','','New review','5','','GIA','new-id','',...Array(11).fill('')]]);
  await store.ensure(true);
  assert.equal(store.match('Carlos Perez').status,'partial');
  assert.equal(store.match('Carlos Perez').rows[0].id,'new-id');
  response=serialize([[...old,'','',...audit.slice(0,8),'Undone']]);
  await store.ensure(true);
  assert.equal(store.match('Carlos Perez').status,'partial');
});


test('No match acknowledgments survive reload and older responses cannot restore dismissed reviews',async()=>{
  const s=setup();await s.store.ensure();
  const row=s.store.match('Jane Doe').rows[0];
  s.store.applyConfirmation(row,[],100,['Carlos Doe']);
  assert.equal(s.store.match('Carlos Doe').status,'missing');
  s.store.applyConfirmation(row,[],99,[]);
  assert.equal(s.store.match('Carlos Doe').status,'missing');
  const second=api().createReviewStore(s.options);
  assert.equal(second.match('Carlos Doe').status,'missing');
  assert.equal(second.match('Carlos Doe').dismissedRows.length,1);
  second.applyConfirmation(row,[],101,[]);
  assert.equal(second.match('Carlos Doe').status,'partial');
});
