const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const updaterPath = path.join(__dirname, 'policycenter-mileage-calculator-updater.user.js');
const updater = fs.existsSync(updaterPath) ? fs.readFileSync(updaterPath, 'utf8') : '';
const cacheKey = 'tmStaffPerScriptUpdater:policycenter-mileage-calculator:code';
const sha = 'a'.repeat(40);
const target = (version) => `// ==UserScript==\n// @namespace local.policycenter.hosted-mileage\n// @version ${version}\n// ==/UserScript==\nwindow.runs.push('${version}');`;

async function run({ cache = '', remote = target('1.3.0'), offline = false, badCommit = false, hostname = 'policycenter-2.farmersinsurance.com', search = '', store = new Map() } = {}) {
  if (cache) store.set(cacheKey, cache);
  const requests = [], warnings = [], runs = [];
  let reloads = 0;
  const location = { hostname, pathname: '/pc/PolicyCenter.do', search, reload: () => reloads++ };
  const context = vm.createContext({
    URLSearchParams, Date, console: { info() {}, warn: (...args) => warnings.push(args) },
    location, window: { location, runs },
    GM_getValue: (key, fallback) => store.get(key) ?? fallback,
    GM_setValue: (key, value) => store.set(key, value),
    GM_deleteValue: (key) => store.delete(key),
    GM_xmlhttpRequest(options) {
      requests.push(options);
      queueMicrotask(() => {
        if (offline) return options.onerror();
        const isCommit = options.url.startsWith('https://api.github.com/');
        options.onload({ status: 200, responseText: isCommit ? JSON.stringify({ sha: badCommit ? 'invalid' : sha }) : remote });
      });
    }
  });
  vm.runInContext(updater, context);
  await new Promise(resolve => setImmediate(resolve));
  return { store, requests, warnings, runs, reloads };
}

test('first install downloads, executes once and caches a commit-pinned target', async () => {
  const result = await run();
  assert.deepEqual(result.runs, ['1.3.0']);
  assert.equal(result.store.get(cacheKey), target('1.3.0'));
  assert.match(result.requests[1].url, new RegExp(`/${sha}/General%20Utilities/Mileage%20Calculator/`));
  assert.ok(result.requests.every(request => request.method === 'GET'));
});

test('cached target runs offline', async () => {
  const result = await run({ cache: target('1.2.0'), offline: true });
  assert.deepEqual(result.runs, ['1.2.0']);
  assert.equal(result.reloads, 0);
});

test('a broken cached copy is replaced with a working remote target', async () => {
  const result = await run({ cache: target('1.2.0') + '\nthrow new Error("broken cache");' });
  assert.deepEqual(result.runs, ['1.2.0', '1.3.0']);
  assert.equal(result.store.get(cacheKey), target('1.3.0'));
});

test('a newer target is cached without re-execution or refresh, then runs on next load', async () => {
  const result = await run({ cache: target('1.2.0') });
  assert.deepEqual(result.runs, ['1.2.0']);
  assert.equal(result.store.get(cacheKey), target('1.3.0'));
  assert.equal(result.reloads, 0);
  const next = await run({ store: result.store });
  assert.deepEqual(next.runs, ['1.3.0']);
});

test('invalid GitHub SHA falls back to the main branch URL', async () => {
  const result = await run({ badCommit: true });
  assert.deepEqual(result.runs, ['1.3.0']);
  assert.match(result.requests[1].url, /\/main\/General%20Utilities\/Mileage%20Calculator\//);
});

test('wrong script or HTML never replaces valid cached code', async () => {
  const result = await run({ cache: target('1.2.0'), remote: '// ==UserScript==\n// @namespace other-script\n// @version 9.0' });
  assert.equal(result.store.get(cacheKey), target('1.2.0'));
  assert.deepEqual(result.runs, ['1.2.0']);
  assert.ok(result.warnings.length);
});

test('clear flag discards cache and loads the remote target', async () => {
  const result = await run({ cache: target('1.2.0'), search: '?mileageUpdaterClear=1' });
  assert.deepEqual(result.runs, ['1.3.0']);
});

test('non-PolicyCenter pages do not fetch or execute', async () => {
  const result = await run({ cache: target('1.2.0'), hostname: 'example.com' });
  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.runs, []);
});

test('metadata carries updater identity, matching hosts, and future Sheets network permissions', () => {
  for (const host of ['api.github.com', 'raw.githubusercontent.com', 'script.google.com', 'script.googleusercontent.com', 'sheets.googleapis.com', 'docs.google.com', 'spreadsheets.google.com']) {
    assert.match(updater, new RegExp(`^// @connect\\s+${host.replaceAll('.', '\\.')}\\s*$`, 'm'));
  }
  assert.match(updater, /^\/\/ @noframes\s*$/m);
  assert.match(updater, /^\/\/ @grant\s+GM_xmlhttpRequest\s*$/m);
  assert.match(updater, /^\/\/ @downloadURL\s+https:\/\/raw.githubusercontent.com\/ugomez809\/GIA-TamperMonkey\/main\/General%20Utilities\/Mileage%20Calculator\/policycenter-mileage-calculator-updater.user.js\s*$/m);
  const main = fs.readFileSync(path.join(__dirname, 'policycenter-mileage-calculator.user.js'), 'utf8');
  const matches = source => [...source.matchAll(/^\/\/ @match\s+(.+)$/gm)].map(match => match[1].trim());
  assert.deepEqual(matches(updater), matches(main));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../Installer/installer-config.json'), 'utf8'));
  assert.ok(config.scripts.some(script => script.path === 'General Utilities/Mileage Calculator/policycenter-mileage-calculator-updater.user.js'));
});
