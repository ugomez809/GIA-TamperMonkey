const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const mainPath = path.join(dir, 'ulises-google-review-helper.user.js');
const updaterPath = path.join(dir, 'ulises-google-review-helper-updater.user.js');
const installerConfigPath = path.join(root, 'Installer', 'installer-config.json');

const encodedBase = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Google%20Review%20Helper';

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function metadataBlock(source) {
  const match = source.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  assert.ok(match, 'metadata block exists');
  return match[1];
}

function metadataValue(source, key) {
  const match = metadataBlock(source).match(new RegExp(`^//\\s*@${key}\\s+(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function includes(source, text, label) {
  assert.ok(source.includes(text), `${label}: ${text}`);
}

const main = read(mainPath);
assert.equal(metadataValue(main, 'name'), 'Ulises AgencyZoom Google Review Helper');
assert.equal(metadataValue(main, 'namespace'), 'local.agencyzoom.ulises-google-review-helper');
assert.equal(metadataValue(main, 'match'), 'https://app.agencyzoom.com/integration/messages/index*');
assert.equal(metadataValue(main, 'connect'), 'qkjbpszojgyvhzrlopys.supabase.co');
assert.equal(metadataValue(main, 'updateURL'), `${encodedBase}/ulises-google-review-helper.user.js`);
assert.equal(metadataValue(main, 'downloadURL'), `${encodedBase}/ulises-google-review-helper.user.js`);
includes(main, "const AGENCY_NAME = 'Ulises Gomez Agency';", 'agency name');
includes(main, "const AGENCY_ID = 'e51d3d22-5099-425b-865e-a24924b3624c';", 'agency id');
includes(main, "const ROOT_ID = 'ugomez-google-review-helper';", 'unique DOM root');
includes(main, 'https://gomezagency.net/feedback/', 'Ulises feedback request URL');
assert.doesNotMatch(main, /https:\/\/gomezagency\.net\/review\//);
assert.doesNotMatch(main, /Carlos Perez Agency|CARLOS_AGENCY_ID|cpagy\.com\/review|cpagy-google-review-helper/);

const updater = read(updaterPath);
assert.equal(metadataValue(updater, 'name'), 'Ulises AgencyZoom Google Review Helper Updater');
assert.equal(metadataValue(updater, 'namespace'), 'local.agencyzoom.ulises-google-review-helper.updater');
assert.equal(metadataValue(updater, 'match'), 'https://app.agencyzoom.com/integration/messages/index*');
assert.equal(metadataValue(updater, 'updateURL'), `${encodedBase}/ulises-google-review-helper-updater.user.js`);
assert.equal(metadataValue(updater, 'downloadURL'), `${encodedBase}/ulises-google-review-helper-updater.user.js`);
includes(updater, '// @connect      api.github.com', 'GitHub API connect');
includes(updater, '// @connect      raw.githubusercontent.com', 'raw GitHub connect');
includes(updater, '// @connect      qkjbpszojgyvhzrlopys.supabase.co', 'Supabase connect for eval target');
includes(updater, "const TARGET_ID = 'ulises-agencyzoom-google-review-helper';", 'updater target id');
includes(updater, "const TARGET_FILE = 'ulises-google-review-helper.user.js';", 'updater target file');
includes(updater, `const BASE_URL = '${encodedBase}';`, 'updater base URL');
includes(updater, "const COMMIT_API_URL = 'https://api.github.com/repos/ugomez809/GIA-TamperMonkey/commits/main';", 'commit API URL');
assert.ok(!updater.includes('window.location.reload()'), 'updater must not reload AgencyZoom by default');
assert.ok(!updater.includes('location.reload()'), 'updater must not reload AgencyZoom by default');
assert.ok(!updater.includes('location.assign('), 'updater must not navigate AgencyZoom after cache updates');

const installer = JSON.parse(read(installerConfigPath));
const entry = installer.scripts.find((script) => script.path === 'AgencyZoom/Google Review Helper/ulises-google-review-helper-updater.user.js');
assert.ok(entry, 'installer config includes Ulises Google Review Helper updater');
assert.deepEqual(entry.positions, ['PRODUCER', 'CSR']);
assert.deepEqual(entry.tags, ['Ulises Gomez']);
assert.match(entry.summary, /Google review/i);
assert.match(entry.details, /AgencyZoom SMS/i);
