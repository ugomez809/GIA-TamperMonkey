// Ulises Google Review shared confirmations — service v0.5.0.
// Deploy as owner with Anyone access. Match submissions require no staff setup.
// Writes only column I confirmations and the No Match audit table L:T on the fixed sheet.
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
function noMatchHeaders() {
  return ['No Match Customer','Google Reviewer','Google Review ID','Review Date','Rating','Review Text','Google Page','Marked At (UTC)','No Match Status'];
}
function noMatchIdentity(review) {
  return review.id ? JSON.stringify(['id',review.id]) : JSON.stringify(['review',review.reviewer_name || '',review.original_review_date || '',review.rating || '',review.comment || '',review.page || '']);
}
function noMatchReview(values) {
  return {reviewer_name:values[1],id:values[2],original_review_date:values[3],rating:values[4],comment:values[5],page:values[6]};
}
function validateNoMatchTable(grid) {
  const header = noMatchHeaders();
  const blank = !grid.some(row => row.slice(11,20).some(value => String(value || '').trim()));
  if (!blank && header.some((value,i) => grid[0][11+i] !== value)) throw Error('No Match table L:T is occupied or its headers changed.');
  return blank;
}
function noMatchNames(grid, review) {
  const key = noMatchIdentity(review);
  return grid.slice(1).filter(row => row[19] === 'No match' && noMatchIdentity(noMatchReview(row.slice(11,20))) === key).map(row => row[11]);
}
function planNoMatchWrite(grid, request, timestamp) {
  validateNoMatchTable(grid);
  if (!['reject','restore'].includes(request.action)) throw Error('Invalid No Match action.');
  const match = planMatchWrite(grid,{...request,action:'confirm'});
  if (matchNameKey(request.customerName) === matchNameKey(request.review.reviewer_name)) throw Error('An exact name match cannot be dismissed.');
  if (request.action === 'reject' && matchNames(grid[match.row-1][8]).some(name => matchNameKey(name) === matchNameKey(request.customerName))) throw Error('Undo the confirmed match before marking No match.');
  const identity = noMatchIdentity(request.review);
  const found = [];
  for (let i=1;i<grid.length;i++) {
    if (matchNameKey(grid[i][11]) === matchNameKey(request.customerName) && noMatchIdentity(noMatchReview(grid[i].slice(11,20))) === identity) found.push(i);
  }
  if (found.length > 1) throw Error('Duplicate No Match records. Resolve them in the sheet.');
  if (request.action === 'restore' && !found.length) throw Error('No dismissal found to undo.');
  let i = found[0];
  if (i === undefined) {
    i = 1;
    while (i < grid.length && grid[i].slice(11,20).some(value => String(value || '').trim())) i++;
  }
  const review = request.review;
  const existing = found.length ? grid[i].slice(11,20) : null;
  const values = request.action === 'restore' ? [...existing.slice(0,8),'Undone'] :
    existing && existing[8] === 'No match' ? existing :
    [request.customerName.trim(),review.reviewer_name,review.id || '',review.original_review_date,review.rating,review.comment,review.page,timestamp,'No match'];
  return {row:i+1,values};
}
function assertNoMatchFormulaFree(sheet) {
  if (sheet.getRange(1,12,Math.max(1,sheet.getLastRow()),9).getFormulas().some(row => row.some(Boolean))) throw Error('No Match table L:T contains formulas; refusing to overwrite them.');
}
function writeNoMatchHeaders(sheet, grid) {
  if (validateNoMatchTable(grid)) {
    sheet.getRange(1,12,1,9).setValues([noMatchHeaders()]).setFontWeight('bold').setBackground('#fff2cc');
    noMatchHeaders().forEach((value,i) => { grid[0][11+i] = value; });
  }
}
function setupNoMatchTable() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(MATCH_SHEET_ID).getSheets().find(s => s.getSheetId() === 0);
    if (!sheet) throw Error('Review tab not found.');
    const grid = sheet.getRange(1,1,Math.max(1,sheet.getLastRow()),20).getDisplayValues();
    assertNoMatchFormulaFree(sheet);
    writeNoMatchHeaders(sheet,grid);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
function matchJson(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return matchJson({ ok: true, service: 'ulises-review-matches', version: '0.5.0' });
}
function doPost(event) {
  let lock;
  try {
    const body = event && event.postData && event.postData.contents;
    if (!body || body.length > 200000) throw Error('Invalid request size.');
    const input = JSON.parse(body);
    if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > 25) throw Error('Send between 1 and 25 match requests.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw Error('Sheet busy. Please retry.');
    const sheet = SpreadsheetApp.openById(MATCH_SHEET_ID).getSheets().find(s => s.getSheetId() === 0);
    if (!sheet) throw Error('Review tab not found.');
    const grid = sheet.getRange(1,1,sheet.getLastRow(),20).getDisplayValues();
    const properties = PropertiesService.getScriptProperties();
    const revision = Math.max(Date.now(), (Number(properties.getProperty('MATCH_REVISION')) || 0) + 1);
    properties.setProperty('MATCH_REVISION',String(revision));
    const results = input.requests.map(request => {
      try {
        if (['reject','restore'].includes(request.action)) {
          assertNoMatchFormulaFree(sheet);
          const planned = planNoMatchWrite(grid,request,new Date().toISOString());
          if (planned.row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),planned.row-sheet.getMaxRows());
          writeNoMatchHeaders(sheet,grid);
          // Escape formula-leading review text; displayed values remain plain text.
          const safe = planned.values.map(value => String(value || '').startsWith('=') ? "'" + value : String(value || ''));
          sheet.getRange(planned.row,12,1,9).setNumberFormat('@').setValues([safe]);
          if (!grid[planned.row-1]) grid[planned.row-1] = [];
          planned.values.forEach((value,i) => { grid[planned.row-1][11+i] = value; });
          const matched = planMatchWrite(grid,{...request,action:'confirm'});
          return {ok:true,names:matchNames(grid[matched.row-1][8]),rejectedNames:noMatchNames(grid,request.review),revision};
        }
        if (['confirm','auto'].includes(request.action) && noMatchNames(grid,request.review).some(name => matchNameKey(name) === matchNameKey(request.customerName))) throw Error('Undo No match before confirming this review.');
        const planned = planMatchWrite(grid,request);
        if (!grid[0][8]) { sheet.getRange(1,9).setValue(MATCH_HEADER); grid[0][8] = MATCH_HEADER; }
        if (grid[planned.row-1][8] !== planned.value) {
          sheet.getRange(planned.row,9).setNumberFormat('@').setValue(planned.value);
          grid[planned.row-1][8] = planned.value;
        }
        return { ok:true, names:planned.names, rejectedNames:noMatchNames(grid,request.review), revision };
      } catch (error) { return { ok:false, error:error.message }; }
    });
    SpreadsheetApp.flush();
    return matchJson({ ok:true, results });
  } catch (error) { return matchJson({ ok:false, error:error.message }); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
