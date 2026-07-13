/**
 * Automatically applies conditional formatting to the "Sheet1" of the active spreadsheet
 * whenever a new row of invoice metadata is added via API (n8n) or edited.
 * This should be deployed as an installable "onChange" trigger.
 */
function handleSheetChange(e) {
  // Only execute for insert row or edit actions
  if (e.changeType !== "INSERT_ROW" && e.changeType !== "EDIT" && e.changeType !== "OTHER") return;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getName() !== "Sheet1") return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // Skip headers

  // 1. Column P: Status (Column 16)
  var statusCell = sheet.getRange(lastRow, 16);
  var status = statusCell.getValue();

  if (status === "AUTO_APPROVED") {
    statusCell.setBackground("#34A853"); // Green
    statusCell.setFontColor("#FFFFFF");
  } else if (status === "REVIEW_RECOMMENDED") {
    statusCell.setBackground("#FBBC04"); // Amber
    statusCell.setFontColor("#000000");
  } else if (status === "REVIEW_REQUIRED") {
    statusCell.setBackground("#EA4335"); // Red
    statusCell.setFontColor("#FFFFFF");
  } else {
    statusCell.setBackground(null);
    statusCell.setFontColor(null);
  }

  // 2. Column R: Avg Confidence (Column 18)
  var confCell = sheet.getRange(lastRow, 18);
  var conf = confCell.getValue();

  if (conf !== "") {
    var confVal = parseFloat(conf);
    if (!isNaN(confVal)) {
      if (confVal >= 85) {
        confCell.setFontColor("#34A853"); // Green
        confCell.setFontWeight("bold");
      } else if (confVal >= 65 && confVal < 85) {
        confCell.setFontColor("#FBBC04"); // Amber
        confCell.setFontWeight("bold");
      } else if (confVal < 65) {
        confCell.setFontColor("#EA4335"); // Red
        confCell.setFontWeight("bold");
      }
    }
  } else {
    confCell.setFontColor(null);
    confCell.setFontWeight("normal");
  }

  // 3. Column S: Low Confidence Fields (Column 19)
  var lowConfCell = sheet.getRange(lastRow, 19);
  var lowConfText = lowConfCell.getValue();

  if (lowConfText && lowConfText !== "None" && lowConfText !== "") {
    lowConfCell.setBackground("#F4CCCC"); // Light Red
  } else {
    lowConfCell.setBackground(null);
  }
}
