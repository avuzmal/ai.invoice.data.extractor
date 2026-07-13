# Phase 05: AI Invoice Data Extractor System Documentation (Final Production Release)

This guide provides the complete blueprint, setup instructions, and execution details for **Phase 05 (Final Production Release)** of the **AI Invoice Data Extractor** system.

---

## 1. Directory Structure Organization

To package this project in a visually stunning, client-ready structure, organize the repository folders as follows:

```text
/ai.invoice.data.extractor
│
├── /workflows
│   └── workflow.json          # Complete importable 26-node n8n Phase 05 JSON
│
├── /scripts
│   └── sheets_trigger.gs      # Google Apps Script conditional formatting script
│
├── /docs
│   ├── PHASE_01_GUIDE.md      # Phase 01: Gmail text-based extraction guide
│   ├── PHASE_02_GUIDE.md      # Phase 02: Multimodal vision & routing guide
│   ├── PHASE_03_GUIDE.md      # Phase 03: Validation and audit logic guide
│   └── PHASE_04_GUIDE.md      # Phase 04: Google Sheets & archiving guide
│
├── README.md                  # Premium overview, features, diagrams, and install guide
├── PHASE_05_GUIDE.md          # This Phase 05 technical configuration & test guide
└── LICENSE                    #MIT License
```

Let's create the `/workflows` and `/scripts` and `/docs` directories and move the guides there so the folder structure is perfectly clean!
*(Note: We will do this file placement using the file commands after writing this document).*

---

## 2. Technical Node Parameter Specifications

### A. Deterministic Duplicate Detection
* **`Check Duplicate` (Google Sheets Node):**
  * **Operation:** `readRows`
  * **Document ID:** `YOUR_SPREADSHEET_ID_HERE`
  * **Sheet Name:** `Sheet1`
  * **Filters (Conditions):**
    * Column: `Vendor Name` == `={{ $('determineStatus').item.json.extracted_data?.vendor_name }}`
    * Column: `Invoice Number` == `={{ $('determineStatus').item.json.extracted_data?.invoice_number }}`
    * Column: `Total` == `={{ $('determineStatus').item.json.extracted_data?.total }}`
  * **Settings:**
    * **OnError:** `Continue (Regular Output)`
    * **Always Output Data:** `True` (Prevents n8n from halting executions when there are no matches).
* **`Is Duplicate?` (IF Node):**
  * **Conditions:**
    * **String:** `{{ $json["Invoice Number"] || $json.invoice_number }}` is not empty.
  * **Routes:**
    * `TRUE`: Route to duplicate archiving branch (`Duplicate Alert` email -> Google Drive `/Invoices/Duplicates/` folder uploads).
    * `FALSE`: Proceed to the main spreadsheet append and processed file archiving flow.

### B. Credit Notes Edge Case (Code Nodes)
* **Inside `validateFields` (Required/Dates/Negative values):**
  * Parses total as float. If total is `< 0`, adds `"CREDIT_NOTE"` to the flags array:
  ```javascript
  if (data.total?.value !== null && data.total?.value !== undefined) {
    const totalVal = parseFloat(data.total.value);
    if (!isNaN(totalVal) && totalVal < 0) {
      item.json.flags.push("CREDIT_NOTE");
    }
  }
  ```
* **Inside `determineStatus` (Status & Color rules):**
  * Checks if flags array has `"CREDIT_NOTE"`. If yes, it ensures the status is at least `"REVIEW_RECOMMENDED"`. If the status is already `"REVIEW_REQUIRED"`, it keeps it at `REVIEW_REQUIRED`:
  ```javascript
  if (flags.includes("CREDIT_NOTE")) {
    if (status === "AUTO_APPROVED") {
      status = "REVIEW_RECOMMENDED";
      statusColor = "#FBBC04"; // Amber
    }
  }
  ```

### C. Multi-Page Text Truncation Limit
* **Inside `Prepare Claude Multimodal Payload` (Payload Assembler):**
  * Truncates text extracted from long multi-page invoices if it exceeds `10,000` characters to optimize Claude processing times and tokens:
  ```javascript
  let extractedText = item.json.text || '';
  if (extractedText.length > 10000) {
    extractedText = extractedText.substring(0, 10000) + '\n... [TRUNCATED DUE TO 10,000 CHAR LIMIT]';
  }
  ```

### D. Advanced Error & Retry Logic (Claude API)
* **`Claude API Call` (HTTP Request Node):**
  * **Retry On Fail:** `True`
  * **Retry Attempts:** `3` (Three retries)
  * **Retry Interval:** `5000` (Starts at 5 seconds)
  * **Retry Exponential Backoff:** `True` (Backs off automatically with wait values e.g. 5s, 15s, 45s).

---

## 3. High-Fidelity Dead-Letter Logs Mapping

To guarantee production-grade audit transparency, two auxiliary logs are maintained in separate sheet tabs:

### A. Performance and Usage Audit Ledger (`Audit_Log` tab)
* **Timestamp:** `={{ new Date().toISOString() }}`
* **Filename:** `={{ $('detectFileType').item.json.pdf_filename || 'N/A' }}`
* **Final Status:** `={{ $('determineStatus').item.json.status }}`
* **Processing Duration:** `={{ (new Date().getTime() - new Date($execution.startedAt).getTime()) / 1000 + ' seconds' }}` (Tracks extraction performance directly).
* **Tokens Used:** `={{ $('Claude API Call').item.json.usage?.output_tokens ? ($('Claude API Call').item.json.usage.input_tokens + $('Claude API Call').item.json.usage.output_tokens) : 0 }}` (Maintains precise Anthropic token usage logs).

### B. Dead-Letter Error Ledger (`Error_Log` tab)
* **Timestamp:** `={{ new Date().toISOString() }}`
* **Source File:** `={{ $('detectFileType').item.json.pdf_filename || 'N/A' }}`
* **Error Stage:** `Claude API Extraction / Parsing`
* **Error Message:** `={{ $('Parse Claude Response').item.json.extracted_data?.raw_response || 'API Connection Failed' }}`

---

## 4. Testing Protocol

Ensure your Phase 05 pipeline is production-ready by executing these testing protocols:

### Test Case A: Deterministic Duplicate Rejection
1. E-mail a standard invoice PDF (e.g., `invoice_1001.pdf` from "Vendor A" for `$150.00`) to the monitored inbox.
2. Trigger the workflow. Confirm the row writes to `Sheet1`, notifications are routed, and the file is archived in your monthly processed directory.
3. E-mail the **exact same invoice file** a second time.
4. Trigger the workflow.
5. **Verify:**
   * `Check Duplicate` searches Sheet1, finds the match, and returns the row.
   * `Is Duplicate?` branches to **TRUE**.
   * A high-priority **Duplicate Alert** email is sent to the admin.
   * The duplicate file is uploaded/moved into the `/Invoices/Duplicates/` folder on Google Drive.
   * **Crucial:** Confirm **no new row** is written to `Sheet1` (the master ledger is preserved completely clean).

### Test Case B: Claude Timeout Recovery & Dead-Letter Log
1. Temporarily disrupt your network connection, block `api.anthropic.com` in your sandbox hosts file, or use an invalid API Key to simulate API timeout/connection failure.
2. Send an invoice.
3. Trigger the workflow.
4. **Verify:**
   * The workflow attempts to connect to Claude, fails, retries after 5 seconds, retries after 15 seconds, and makes its final retry after 45 seconds.
   * Upon failing the final attempt, `IF Success Check` redirects to **FALSE**.
   * An entry is appended to the **`Error_Log`** sheet containing:
     * **Source File:** `invoice.pdf`
     * **Error Stage:** `Claude API Extraction / Parsing`
     * **Error Message:** `API Connection Failed`
   * A critical **Admin Alert Email** is sent notifying the systems administrator.

### Test Case C: High-Fidelity Performance Auditing
1. Process any valid invoice.
2. Open your spreadsheet and navigate to the **`Audit_Log`** tab.
3. **Verify:**
   * A new row is written with the correct filename and final status.
   * **Processing Duration** displays the elapsed time in seconds (e.g. `4.2 seconds`).
   * **Tokens Used** displays the exact sum of input and output tokens consumed by the Claude 3.5 Sonnet request.
