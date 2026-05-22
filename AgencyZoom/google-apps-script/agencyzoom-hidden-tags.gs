/*
 * AgencyZoom hidden tag registry.
 *
 * Setup:
 * 1. Create or open the Google Sheet that should store hidden tags.
 * 2. Extensions > Apps Script, paste this file into Code.gs.
 * 3. Optional but recommended: Project Settings > Script properties:
 *    - MANAGER_TOKEN: required for writes from the manager userscript.
 *    - READ_TOKEN: optional token required for reads from producer userscripts.
 *    - SPREADSHEET_ID: only needed if this script is not bound to the Sheet.
 * 4. Run setupHiddenTagsSheet once.
 * 5. Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone with the link
 * 6. Paste the /exec Web App URL into the Tampermonkey scripts.
 */

const HIDDEN_TAGS_SHEET_NAME = 'HiddenTags';
const HIDDEN_TAGS_HEADERS = [
  'key',
  'text',
  'tagId',
  'active',
  'updatedAt',
  'updatedBy',
  'sourceUrl',
  'selectorHint'
];

function setupHiddenTagsSheet() {
  const sheet = getHiddenTagsSheet_();
  ensureHiddenTagsHeaders_(sheet);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HIDDEN_TAGS_HEADERS.length);
}

function doGet(e) {
  const action = getParam_(e, 'action') || 'list';
  if (!isReadAuthorized_(e)) {
    return json_({
      ok: false,
      error: 'unauthorized',
      message: 'READ_TOKEN is set in Apps Script properties, but the request did not include a matching token.'
    });
  }

  if (action === 'list' || action === 'get') {
    const tags = readHiddenTags_().filter((tag) => tag.active);
    return json_({
      ok: true,
      tags,
      count: tags.length,
      updatedAt: new Date().toISOString()
    });
  }

  return json_({
    ok: false,
    error: 'unknown_action',
    action
  });
}

function doPost(e) {
  const payload = parsePayload_(e);
  const action = payload.action || getParam_(e, 'action') || 'replace';

  if (!isWriteAuthorized_(e, payload)) {
    return json_({
      ok: false,
      error: 'unauthorized',
      message: 'MANAGER_TOKEN is set in Apps Script properties, but the request did not include a matching token.'
    });
  }

  if (action === 'replace') {
    const tags = replaceHiddenTags_(payload.tags || [], payload.updatedBy || payload.manager || '');
    return json_({
      ok: true,
      action,
      tags,
      count: tags.length,
      updatedAt: new Date().toISOString()
    });
  }

  if (action === 'add') {
    const tags = upsertHiddenTags_(payload.tags || [payload.tag].filter(Boolean), payload.updatedBy || payload.manager || '');
    return json_({
      ok: true,
      action,
      tags,
      count: tags.length,
      updatedAt: new Date().toISOString()
    });
  }

  if (action === 'remove') {
    const removedKeys = normalizeRemoveKeys_(payload);
    const tags = removeHiddenTags_(removedKeys, payload.updatedBy || payload.manager || '');
    return json_({
      ok: true,
      action,
      removedKeys,
      tags,
      count: tags.length,
      updatedAt: new Date().toISOString()
    });
  }

  return json_({
    ok: false,
    error: 'unknown_action',
    action
  });
}

function replaceHiddenTags_(inputTags, updatedBy) {
  const now = new Date().toISOString();
  const tags = normalizeInputTags_(inputTags, now, updatedBy);
  const sheet = getHiddenTagsSheet_();
  ensureHiddenTagsHeaders_(sheet);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, HIDDEN_TAGS_HEADERS.length).setValues([HIDDEN_TAGS_HEADERS]);

  if (tags.length) {
    sheet.getRange(2, 1, tags.length, HIDDEN_TAGS_HEADERS.length).setValues(tags.map(tagToRow_));
  }

  sheet.setFrozenRows(1);
  return tags;
}

function upsertHiddenTags_(inputTags, updatedBy) {
  const current = readHiddenTags_();
  const byKey = {};
  current.forEach((tag) => {
    byKey[tag.key] = tag;
  });

  const now = new Date().toISOString();
  normalizeInputTags_(inputTags, now, updatedBy).forEach((tag) => {
    byKey[tag.key] = tag;
  });

  return replaceHiddenTags_(Object.keys(byKey).map((key) => byKey[key]), updatedBy);
}

function removeHiddenTags_(keys, updatedBy) {
  const removeSet = {};
  keys.forEach((key) => {
    removeSet[key] = true;
  });

  const kept = readHiddenTags_().filter((tag) => !removeSet[tag.key]);
  return replaceHiddenTags_(kept, updatedBy);
}

function readHiddenTags_() {
  const sheet = getHiddenTagsSheet_();
  ensureHiddenTagsHeaders_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, HIDDEN_TAGS_HEADERS.length).getValues();
  return values
    .map(rowToTag_)
    .filter((tag) => tag.key && tag.text);
}

function normalizeInputTags_(inputTags, now, updatedBy) {
  const byKey = {};
  const rows = Array.isArray(inputTags) ? inputTags : [];

  rows.forEach((input) => {
    const text = clean_(input && (input.text || input.name || input.label || input.tag || input.value));
    const key = normalizeTagKey_(input && input.key ? input.key : text);
    if (!text || !key) return;

    byKey[key] = {
      key,
      text,
      tagId: clean_(input && (input.tagId || input.id || input.dataId)),
      active: input && input.active === false ? false : true,
      updatedAt: clean_(input && input.updatedAt) || now,
      updatedBy: clean_(input && input.updatedBy) || clean_(updatedBy),
      sourceUrl: clean_(input && input.sourceUrl),
      selectorHint: clean_(input && input.selectorHint)
    };
  });

  return Object.keys(byKey)
    .sort((a, b) => byKey[a].text.localeCompare(byKey[b].text))
    .map((key) => byKey[key]);
}

function normalizeRemoveKeys_(payload) {
  const raw = payload.keys || payload.key || payload.tags || payload.tag || [];
  const values = Array.isArray(raw) ? raw : [raw];
  const keys = values
    .map((item) => normalizeTagKey_(item && item.key ? item.key : item && item.text ? item.text : item))
    .filter(Boolean);

  return Array.from(new Set(keys));
}

function rowToTag_(row) {
  return {
    key: clean_(row[0]),
    text: clean_(row[1]),
    tagId: clean_(row[2]),
    active: parseActive_(row[3]),
    updatedAt: clean_(row[4]),
    updatedBy: clean_(row[5]),
    sourceUrl: clean_(row[6]),
    selectorHint: clean_(row[7])
  };
}

function tagToRow_(tag) {
  return [
    tag.key,
    tag.text,
    tag.tagId || '',
    tag.active !== false,
    tag.updatedAt || '',
    tag.updatedBy || '',
    tag.sourceUrl || '',
    tag.selectorHint || ''
  ];
}

function parsePayload_(e) {
  const text = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return {};
    }
  }
  return e && e.parameter ? Object.assign({}, e.parameter) : {};
}

function isWriteAuthorized_(e, payload) {
  const expected = getScriptProperty_('MANAGER_TOKEN');
  if (!expected) return true;

  const provided = clean_(
    payload.managerToken ||
    payload.token ||
    getParam_(e, 'managerToken') ||
    getParam_(e, 'token')
  );

  return safeEquals_(expected, provided);
}

function isReadAuthorized_(e) {
  const expected = getScriptProperty_('READ_TOKEN');
  if (!expected) return true;

  const provided = clean_(
    getParam_(e, 'readToken') ||
    getParam_(e, 'token')
  );

  return safeEquals_(expected, provided);
}

function getHiddenTagsSheet_() {
  const spreadsheetId = getScriptProperty_('SPREADSHEET_ID');
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error('No active spreadsheet. Set SPREADSHEET_ID in Apps Script properties.');
  }

  return spreadsheet.getSheetByName(HIDDEN_TAGS_SHEET_NAME) ||
    spreadsheet.insertSheet(HIDDEN_TAGS_SHEET_NAME);
}

function ensureHiddenTagsHeaders_(sheet) {
  const width = HIDDEN_TAGS_HEADERS.length;
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(clean_);
  const missing = HIDDEN_TAGS_HEADERS.some((header, index) => current[index] !== header);

  if (missing) {
    sheet.getRange(1, 1, 1, width).setValues([HIDDEN_TAGS_HEADERS]);
  }
}

function getScriptProperty_(name) {
  return clean_(PropertiesService.getScriptProperties().getProperty(name));
}

function getParam_(e, name) {
  return e && e.parameter ? clean_(e.parameter[name]) : '';
}

function parseActive_(value) {
  const text = clean_(value).toLowerCase();
  return !['false', 'no', '0', 'inactive', 'off'].includes(text);
}

function normalizeTagKey_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function safeEquals_(expected, provided) {
  const left = clean_(expected);
  const right = clean_(provided);
  if (!left || !right || left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
