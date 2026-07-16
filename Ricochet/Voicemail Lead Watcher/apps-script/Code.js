const SPREADSHEET_ID = '1u4eFoyKGE5j3iKl_PuGg54ftwni4OSnHT1N5Sc_xkLE';
const ROUTING_SHEET_NAME = 'Voicemail Routing';
const DEFAULT_GROUP = 'Call';
const DEFAULT_SHOW_REMINDER = true;

function doGet() {
  try {
    return jsonResponse_({
      ok: true,
      generatedAt: new Date().toISOString(),
      spreadsheetId: SPREADSHEET_ID,
      sheetName: ROUTING_SHEET_NAME,
      defaultGroup: DEFAULT_GROUP,
      routes: getActiveRoutes_()
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function doPost() {
  return doGet();
}

function testRouting() {
  return JSON.stringify(getActiveRoutes_());
}

function getActiveRoutes_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ROUTING_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Missing sheet tab: ${ROUTING_SHEET_NAME}`);
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((value) => normalizeHeader_(value));
  const vendorIndex = headers.indexOf('vendor');
  const groupIndex = headers.indexOf('group');
  const activeIndex = headers.indexOf('active');
  const showReminderIndex = headers.indexOf('show reminder');

  if (vendorIndex < 0 || groupIndex < 0 || activeIndex < 0) {
    throw new Error('Expected headers: Vendor, Group, Active; optional: Show Reminder');
  }

  return values.slice(1)
    .map((row) => ({
      vendor: cleanText_(row[vendorIndex]),
      group: cleanText_(row[groupIndex]),
      active: isActive_(row[activeIndex]),
      showReminder: showReminderIndex < 0
        ? DEFAULT_SHOW_REMINDER
        : isReminderShown_(row[showReminderIndex])
    }))
    .filter((route) => route.active && route.vendor && route.group)
    .map((route) => ({
      vendor: route.vendor,
      group: route.group,
      showReminder: route.showReminder
    }));
}

function normalizeHeader_(value) {
  return cleanText_(value).toLowerCase();
}

function cleanText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isActive_(value) {
  if (value === true) return true;
  const clean = cleanText_(value).toLowerCase();
  return clean === 'true' || clean === 'yes' || clean === 'y' || clean === '1';
}

function isReminderShown_(value) {
  if (value === false) return false;
  if (value === true) return true;
  const clean = cleanText_(value).toLowerCase();
  if (!clean) return DEFAULT_SHOW_REMINDER;
  if (clean === 'false' || clean === 'no' || clean === 'n' || clean === '0' || clean === 'off') return false;
  if (clean === 'true' || clean === 'yes' || clean === 'y' || clean === '1' || clean === 'on') return true;
  return DEFAULT_SHOW_REMINDER;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
