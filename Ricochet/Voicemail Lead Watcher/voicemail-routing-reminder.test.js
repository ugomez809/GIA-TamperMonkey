const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, 'ricochet-voicemail-lead-watcher.user.js');

class FakeElement {}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
}

function createFakeDocument() {
  return {
    body: {
      appendChild() {}
    },
    createElement() {
      return {
        id: '',
        style: {},
        textContent: '',
        dataset: {}
      };
    },
    addEventListener() {},
    querySelector() {
      return null;
    }
  };
}

function loadScriptForTest() {
  const source = fs.readFileSync(scriptPath, 'utf8').replace(
    /\}\)\(\);\s*$/,
    `
  globalThis.__ricochetVmTestApi = {
    parseVoicemailRoutingCsv,
    applyVoicemailRouting,
    getVoicemailRouteForVendor,
    updateBadgeFromSession,
    state
  };
})();`
  );

  const context = {
    console: { log() {} },
    document: createFakeDocument(),
    Element: FakeElement,
    GM_getValue: (_key, defaultValue) => defaultValue,
    GM_setValue() {},
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout() {},
    clearTimeout() {},
    window: { prompt: () => '' }
  };

  context.globalThis = context;
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.angular = null;

  vm.runInNewContext(source, context, { filename: scriptPath });
  return context.__ricochetVmTestApi;
}

function setActiveCall(api, vendor, outboundCallAmount) {
  api.state.activeSession = {
    sent: false,
    isCallOpen: true,
    payload: {
      vendor,
      outboundCallAmount
    }
  };
}

function testShowReminderFalseHidesOnlyReminder() {
  const api = loadScriptForTest();
  const routes = api.parseVoicemailRoutingCsv([
    'Vendor,Group,Active,Notes,Show Reminder',
    'everquote-ulises-auto,NoVoicemail,TRUE,No voicemail,FALSE'
  ].join('\n'));

  assert.equal(routes[0].showReminder, false);

  api.applyVoicemailRouting(routes, 'test');
  assert.equal(api.getVoicemailRouteForVendor('everquote-ulises-auto').group, 'novoicemail');
  assert.equal(api.getVoicemailRouteForVendor('everquote-ulises-auto').showReminder, false);

  setActiveCall(api, 'everquote-ulises-auto', '2');
  api.updateBadgeFromSession();

  assert.equal(api.state.badge.style.display, 'none');
  assert.equal(api.state.badge.textContent, '');
}

function testShowReminderDefaultsTrue() {
  const api = loadScriptForTest();
  const routes = api.parseVoicemailRoutingCsv([
    'Vendor,Group,Active,Notes',
    'regular-vendor,Call,TRUE,Existing sheet format'
  ].join('\n'));

  api.applyVoicemailRouting(routes, 'test');
  assert.equal(api.getVoicemailRouteForVendor('regular-vendor').showReminder, true);

  setActiveCall(api, 'regular-vendor', '2');
  api.updateBadgeFromSession();

  assert.equal(api.state.badge.style.display, 'flex');
  assert.equal(api.state.badge.textContent, 'Remember to Leave a Voicemail');
}

testShowReminderFalseHidesOnlyReminder();
testShowReminderDefaultsTrue();
console.log('voicemail routing reminder tests passed');
