const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/ulises-google-review-helper.user.js`, 'utf8');
function api() {
  const context = { Map, Date, URLSearchParams, console };
  vm.runInNewContext(source.replace(/  const observer = new MutationObserver[\s\S]*$/, '  globalThis.api = { createReviewStore, parseReviewCsv };\n})();'), context);
  return context.api;
}
const csv = 'Timestamp,Name,Email,Comments,Rating 1-5,ChatGPT Response,GMB Page,Review ID\r\n2026-10-16,"José, Gomez",private@example.com,"Great, thanks\n""team""",5,,GIA,123\r\n2026-10-15,Jane Doe,,,4,,Farmers,456\r\n';
function setup() {
  let time = 10000000, requests = 0, response = csv, fail = false;
  const disk = new Map();
  const options = { now: () => time, read: () => disk.get('data'), write: v => disk.set('data', v), fetchCsv: async () => { requests++; if (fail) throw Error('offline'); return response; } };
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
  s.advance(3 * 60 * 60 * 1000);
  await second.ensure(); assert.equal(s.count(), 1);
  s.advance(60 * 60 * 1000 + 1);
  s.respond(csv.replace('Jane Doe', 'Janet Doe'));
  await second.ensure();
  assert.equal(s.count(), 2);
  assert.equal(second.exact('Jane Doe').length, 0);
  assert.equal(second.exact('Janet Doe').length, 1);
});
test('failed refresh retains last good data and backs off', async () => {
  const s = setup(); await s.store.ensure(); s.advance(14400001); s.fail();
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
test('manual refresh bypasses the four-hour cache', async () => {
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
