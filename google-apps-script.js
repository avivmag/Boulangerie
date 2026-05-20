const SHEET_NAME = "Leads";
const HEADERS = [
  "createdAt",
  "fullName",
  "phone",
  "email",
  "marketingConsent",
  "couponCode"
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const input = JSON.parse(e.postData.contents || "{}");
    const sheet = getLeadsSheet();
    const values = sheet.getDataRange().getValues();
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);

    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      const existingPhone = normalizePhone(row[2]);
      const existingEmail = normalizeEmail(row[3]);

      if (existingPhone === phone || existingEmail === email) {
        return jsonResponse({
          error: "already_claimed",
          claimedAt: row[0],
          couponCode: row[5]
        });
      }
    }

    sheet.appendRow([
      input.createdAt || new Date().toISOString(),
      String(input.fullName || "").trim(),
      phone,
      email,
      input.marketingConsent ? "כן" : "לא",
      input.couponCode
    ]);

    return jsonResponse({
      ok: true,
      couponCode: input.couponCode
    });
  } catch (error) {
    return jsonResponse({
      error: "bad_request",
      message: error.message
    });
  } finally {
    lock.releaseLock();
  }
}

function getLeadsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  return sheet;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.indexOf("972") === 0) {
    return "0" + digits.slice(3);
  }
  return digits;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
