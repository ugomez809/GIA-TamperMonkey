// Ulises Google Review shared confirmations — service v0.4.0.
// Deploy as owner. Set MATCH_WRITE_KEY in Script Properties before deployment.
// Only the fixed review sheet, gid 0, column I can be modified by this service.
const MATCH_SHEET_ID = '1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA';
const MATCH_HEADER = 'AgencyZoom Matches';

function matchNameKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function matchNames(value) {
  return String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
function planMatchWrite(grid, request) {
  const headers = grid[0].map(v => String(v).trim());
  if (headers[8] && headers[8] !== MATCH_HEADER) throw Error('Column I is already used by another field.');
  const columns = ['Timestamp','Name','Comments','Rating 1-5','GMB Page','Review ID'];
  const indexes = columns.map(name => headers.indexOf(name));
  if (indexes.some(i => i < 0 || i >= 8)) throw Error('Review sheet columns changed.');
  const name = String(request.customerName || '').trim();
  if (name.length < 2 || name.length > 160 || /[\r\n]/.test(name) || /^[=+@-]/.test(name) ||
      !/[a-zA-Z\u00c0-\u024f]{2}/.test(name) || /^(unknown|unmatched|no name|missing name|loading)(\b|$)/i.test(name)) throw Error('A valid customer name is required.');
  const review = request.review;
  if (!review || !['confirm','auto','remove'].includes(request.action)) throw Error('Invalid match request.');
  const fields = ['original_review_date','reviewer_name','comment','rating','page','id'];
  const candidates = [];
  for (let i = 1; i < grid.length; i++) {
    if (fields.every((field,j) => String(grid[i][indexes[j]] || '').trim() === String(review[field] || '').trim())) candidates.push(i);
  }
  if (!candidates.length) throw Error('Review changed or was not found. Refresh the review list.');
  if (candidates.length !== 1) throw Error('Ambiguous review: multiple identical rows. Resolve duplicates in the sheet.');
  const exact = matchNameKey(name) === matchNameKey(review.reviewer_name);
  if (request.action === 'auto' && !exact) throw Error('Automatic confirmation requires an exact name.');
  if (request.action === 'remove' && exact) throw Error('An exact name match cannot be removed.');
  const rowIndex = candidates[0];
  const existing = matchNames(grid[rowIndex][8]);
  const key = matchNameKey(name);
  let names = existing;
  if (request.action === 'remove') names = existing.filter(n => matchNameKey(n) !== key);
  else if (!existing.some(n => matchNameKey(n) === key)) names = [...existing, name];
  if (names.length > 100) throw Error('Too many confirmations for one review.');
  return { row: rowIndex + 1, value: names.join('\n'), names };
}
function matchJson(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return matchJson({ ok: true, service: 'ulises-review-matches', version: '0.4.0' });
}
function doPost(event) {
  let lock;
  try {
    const body = event && event.postData && event.postData.contents;
    if (!body || body.length > 200000) throw Error('Invalid request size.');
    const input = JSON.parse(body);
    const key = PropertiesService.getScriptProperties().getProperty('MATCH_WRITE_KEY');
    if (!key || key.length < 32 || input.token !== key) throw Error('Unauthorized save key.');
    if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > 25) throw Error('Send between 1 and 25 match requests.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw Error('Sheet busy. Please retry.');
    const sheet = SpreadsheetApp.openById(MATCH_SHEET_ID).getSheets().find(s => s.getSheetId() === 0);
    if (!sheet) throw Error('Review tab not found.');
    const grid = sheet.getRange(1,1,sheet.getLastRow(),9).getDisplayValues();
    const properties = PropertiesService.getScriptProperties();
    const revision = Math.max(Date.now(), (Number(properties.getProperty('MATCH_REVISION')) || 0) + 1);
    properties.setProperty('MATCH_REVISION',String(revision));
    const results = input.requests.map(request => {
      try {
        const planned = planMatchWrite(grid,request);
        if (!grid[0][8]) { sheet.getRange(1,9).setValue(MATCH_HEADER); grid[0][8] = MATCH_HEADER; }
        if (grid[planned.row-1][8] !== planned.value) {
          sheet.getRange(planned.row,9).setNumberFormat('@').setValue(planned.value);
          grid[planned.row-1][8] = planned.value;
        }
        return { ok:true, names:planned.names, revision };
      } catch (error) { return { ok:false, error:error.message }; }
    });
    SpreadsheetApp.flush();
    return matchJson({ ok:true, results });
  } catch (error) { return matchJson({ ok:false, error:error.message }); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
