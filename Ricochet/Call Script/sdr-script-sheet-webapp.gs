const SPREADSHEET_ID = '1rLp-13rk71Nr7VQwDgrxcoEdU2Er8NiuisOLLtNtBrc';
const SHEET_NAME = 'SDR Script Access';

function doPost(e) {
  return handle_(JSON.parse((e.postData && e.postData.contents) || '{}'));
}

function doGet(e) {
  return handle_({ name: e.parameter.name });
}

function handle_(payload) {
  const name = clean_(payload.name);
  if (!name) return json_({ ok: false, enabled: true, error: 'Missing name' });

  const sheet = accessSheet_();
  const now = new Date();
  const values = sheet.getDataRange().getValues();
  const wanted = name.toLowerCase();
  let row = values.findIndex((item, index) => index && clean_(item[0]).toLowerCase() === wanted) + 1;

  if (!row) {
    sheet.appendRow([name, 'TRUE', now, now]);
    row = sheet.getLastRow();
  } else {
    sheet.getRange(row, 4).setValue(now);
  }

  applyValidation_(sheet);
  const enabled = String(sheet.getRange(row, 2).getValue()).toUpperCase() !== 'FALSE';
  return json_({ ok: true, name, enabled });
}

function accessSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Name', 'Enabled', 'First Seen', 'Last Seen']);
  sheet.setFrozenRows(1);
  applyValidation_(sheet);
  return sheet;
}

function applyValidation_(sheet) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(false).build();
  sheet.getRange('B2:B').setDataValidation(rule);
}

function clean_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
