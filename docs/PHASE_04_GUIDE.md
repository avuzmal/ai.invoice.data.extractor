# Phase 04: AI Invoice Data Extractor System Documentation (Production Upgrades)

This guide provides the complete blueprint, setup instructions, and execution details for **Phase 04** of the **AI Invoice Data Extractor** system.

---

## 1. System Architecture (Phase 04)

Phase 04 elevates the pipeline into a polished, production-ready solution by adding:
1. **Google Sheets Apps Script:** Applies automatic cell color-coding for status alerts and text coloring based on confidence thresholds on sheet change triggers.
2. **Notification Routing & Templates:** Routes custom notification emails (Gmail nodes) dynamically styled using HTML templates directly referencing the upstream `determineStatus` node to bypass any Google Sheets API column mapping limitations.
3. **Automated Folder Management & Archiving:**
   * Restricts search and creation to the nested path `/Invoices/Processed/YYYY-MM/` by searching within the designated Processed Parent Folder.
   * Leverages `alwaysOutputData: true` settings to prevent workflow halts if a folder is not found.
   * Utilizes a native `Merge Folder ID` (Index 0: original `detectFileType` holding the raw binary stream, Index 1: searched/created folder `id`) to guarantee that original binary file buffers are completely intact.
   * Seamlessly uploads original binary files (Scenario A: Gmail) or moves existing Google Drive files (Scenario B: Drive Trigger).

---

## 2. Google Sheets Apps Script (Conditional Formatting)

n8n's Google Sheets node writes row data efficiently but does not natively apply cell color formats. To solve this, deploy this bounded Apps Script in your spreadsheet. Since API-driven appends do *not* fire simple `onEdit` triggers, this is built to run on an installable **Spreadsheet Change** trigger.

### The Apps Script Code
```javascript
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
```

### Deployment Instructions
1. Open your target Google Spreadsheet containing columns A to U.
2. Select **Extensions** from the top menu, then click **Apps Script**.
3. Delete any boilerplate code inside the editor pane.
4. Copy and paste the script above into `Code.gs`.
5. Click the **Save** (floppy disk) icon at the top of the editor.
6. Click the **Triggers** (clock) icon on the left sidebar.
7. Click **Add Trigger** button in the bottom right corner of the window.
8. Set the following options in the modal dialog:
   * **Choose which function to run:** `handleSheetChange`
   * **Choose which deployment should run:** `Head`
   * **Select event source:** `From spreadsheet`
   * **Select event type:** `On change`
9. Click **Save** and accept the Google authentication permissions prompt if requested.
10. Trigger a workflow execution or type test row entries. The script will automatically format cells upon append!

---

## 3. Dynamic Notification Expressions

To bypass n8n's Google Sheets Append node's column metadata stripping, both notifications reference the upstream auditing node (`determineStatus`) directly to construct fully-populated alert templates.

### A. Auto-Approved Template (TRUE Path)
* **Email Subject:**
```text
={{ '✅ Invoice processed — ' + ($('determineStatus').item.json.extracted_data?.vendor_name || 'Unknown') + ' · ' + ($('determineStatus').item.json.extracted_data?.currency || '$') + ($('determineStatus').item.json.extracted_data?.total || '0.00') }}
```
* **HTML Body:**
```html
Invoice #{{ $('determineStatus').item.json.extracted_data?.invoice_number || 'N/A' }} from {{ $('determineStatus').item.json.extracted_data?.vendor_name || 'Unknown Vendor' }} has been automatically extracted and approved.<br><br>
<b>Total:</b> {{ $('determineStatus').item.json.extracted_data?.currency || '$' }}{{ $('determineStatus').item.json.extracted_data?.total || '0.00' }}<br>
<b>Due Date:</b> {{ $('determineStatus').item.json.extracted_data?.due_date || 'N/A' }}<br><br>
<a href="https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit">View in Google Sheets</a>
```

### B. Review Required/Recommended Template (FALSE Path)
* **Email Subject:**
```text
={{ '⚠️ Invoice needs review — ' + ($('determineStatus').item.json.extracted_data?.vendor_name || 'Unknown') + ' · ' + ($('determineStatus').item.json.extracted_data?.currency || '$') + ($('determineStatus').item.json.extracted_data?.total || '0.00') }}
```
* **HTML Body:**
```html
Invoice #{{ $('determineStatus').item.json.extracted_data?.invoice_number || 'N/A' }} from {{ $('determineStatus').item.json.extracted_data?.vendor_name || 'Unknown Vendor' }} requires your attention.<br><br>
<b>Status:</b> <span style="color:{{ $('determineStatus').item.json.statusColor || '#EA4335' }};font-weight:bold;">{{ $('determineStatus').item.json.status }}</span><br><br>
<b>Issues Found:</b><br>
- Math Discrepancies: {{ $('determineStatus').item.json.mathDiscrepancies && $('determineStatus').item.json.mathDiscrepancies.length > 0 ? $('determineStatus').item.json.mathDiscrepancies.join(', ') : 'None' }}<br>
- Low Confidence Fields: {{ $('determineStatus').item.json.lowConfidenceFields && $('determineStatus').item.json.lowConfidenceFields.length > 0 ? $('determineStatus').item.json.lowConfidenceFields.map(f => f.field + ' (' + f.confidence + '%)').join(', ') : 'None' }}<br>
- Flags: {{ $('determineStatus').item.json.flags && $('determineStatus').item.json.flags.length > 0 ? $('determineStatus').item.json.flags.join(', ') : 'None' }}<br><br>
<a href="https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit">Review in Google Sheets</a>
```

*(Note: Replace `YOUR_SPREADSHEET_ID_HERE` with your actual Google Spreadsheet ID).*

---

## 4. File Archiving & Lifecycle Node Flow

The archiving path is built with dynamic check/create steps and splits gracefully depending on file origin (Gmail vs. Google Drive):

1. **`Search Folder` (Google Drive Node):** Queries files for directory matching `new Date().toISOString().substring(0, 7)` (e.g. `2023-11`) within your designated Processed Parent Folder ID (`YOUR_PROCESSED_PARENT_FOLDER_ID_HERE`). `"alwaysOutputData": true` is enabled to prevent execution halts if the folder is missing.
2. **`IF Folder Exists` (IF Node):** Verifies if `id` exists in the search outcome.
   * `TRUE`: Routes directly to `Merge Folder ID`.
   * `FALSE`: Routes to `Create Folder` node first, then passes the newly created folder ID to `Merge Folder ID`.
3. **`Merge Folder ID` (Merge Node):** Merges the searched or created folder `id` with the original `detectFileType` item. This maintains full context and preserves the raw `attachment` binary stream flawlessly.
4. **`IF Gmail vs Drive` (IF Node):** Checks origin of the item:
   * **`gmail` Path (Upload Attachment):** Uploads the original raw binary `attachment` file.
   * **`drive` Path (Move File):** Performs file location adjustment by moving the existing file `id` to the parent folder `id`.
5. **Resiliency Settings:** All Google Drive upload/move nodes have **`On Error: Continue (Regular Output)`** enabled. If drive uploads fail (e.g. storage limit or permissions), the workflow logs the issue but does *not* fail the pipeline or lock notifications.

---

## 5. Testing Protocol

### Test Case 1: Apps Script Cell Formatting
1. Overwrite several sample cell values in columns P, R, and S inside your Google Sheet.
2. **Verify:**
   * Writing `AUTO_APPROVED` instantly turns the cell solid green.
   * Writing `REVIEW_REQUIRED` instantly turns the cell solid red.
   * Changing Column R (Avg Confidence) to `90` formats text green. Changing it to `55` formats text red.
   * Writing low confidence strings in Column S turns the cell light red.

### Test Case 2: Notification Routing & Subject Formatting
1. Draft and send an invoice with correct amounts and dates.
2. Execute the workflow and confirm `Success Notification` triggers with subject: `✅ Invoice processed — Acme · USD150.00` and displays correct approval details.
3. Draft and send an invoice with invalid math (e.g., mismatched subtotal vs. line total).
4. Execute the workflow and confirm `Review Notification` triggers with subject `⚠️ Invoice needs review...` and lists the mismatch under "Issues Found".

### Test Case 3: Folder Lookup, Auto-Creation, and Archiving
1. Ensure the directory `YYYY-MM` corresponding to the current month does not exist on your Google Drive under your Processed parent folder.
2. Send an invoice file.
3. Trigger the workflow.
4. **Verify:**
   * The workflow auto-detects that the folder does not exist.
   * It creates a new folder named `YYYY-MM` (e.g., `2023-11`) inside Google Drive.
   * It uploads the processed invoice attachment directly inside that folder.
   * Send a second invoice in the same month.
   * Confirm the workflow successfully searches and finds the pre-existing folder, uploading the file directly into it without attempting to recreate the folder.
