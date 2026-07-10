/**
 * Feedback sink for the Local Genres Research app.
 *
 * A bound Apps Script: it lives inside a Google Sheet (Extensions > Apps Script),
 * so it writes to that sheet with no ID to configure. Deployed as a web app with
 * "Anyone" access, it gives the deployed PWA a single public URL to POST to.
 *
 * Each submitted batch becomes one row: [Received, Filename, Comment (markdown)].
 * The app posts JSON as text/plain (a "simple" request, so no CORS preflight);
 * we parse it out of the raw body.
 */

var SHEET_NAME = 'Feedback'

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME)
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Received', 'Filename', 'Comment (markdown)'])
    sh.setFrozenRows(1)
  }
  return sh
}

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    sheet_().appendRow([new Date(), data.filename || '', data.markdown || ''])
    return json_({ ok: true })
  } catch (err) {
    return json_({ ok: false, error: String(err) })
  }
}

function doGet() {
  // Visiting the URL in a browser confirms the endpoint is live.
  return ContentService.createTextOutput('Genre feedback endpoint is live.')
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}