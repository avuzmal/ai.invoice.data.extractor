# Phase 01: AI Invoice Data Extractor System Documentation

This guide provides detailed setup, execution, testing, and operational parameters for Phase 01 of the **AI Invoice Data Extractor** system.

---

## 1. System Architecture

The pipeline consists of an end-to-end flow of **11 nodes** (under the 15-node limit constraint) to poll Gmail, filter PDF attachments, download and extract text content, invoke Claude (using `claude-opus-4-5`), parse the structured response, and write the mapped data to Google Sheets.

```
                  ┌──────────────────────┐
                  │ 1. Gmail Trigger     │
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │ 2. Select Attachment │
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │ 3. Filter PDF Emails │
                  └──────────┬───────────┘
                             │
                  ┌──────────▼───────────┐
                  │ 4. Extract PDF Text  │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              │ 5. Validate & Prep Extract  │
              └──────────────┬──────────────┘
                             │
               ┌─────────────┴─────────────┐
               │ 6. IF Extraction Success  ├──────────────┐ (FALSE)
               └─────────────┬─────────────┘              │
                             │ (TRUE)                     │
               ┌─────────────▼─────────────┐   ┌──────────▼──────────┐
               │ 7. Prepare Claude Payload │   │ 10. Prep Failed Row │
               └─────────────┬─────────────┘   └──────────┬──────────┘
                             │                            │
               ┌─────────────▼─────────────┐              │
               │ 8. Claude API Call        │              │
               └─────────────┬─────────────┘              │
                             │                            │
               ┌─────────────▼─────────────┐              │
               │ 9. Parse Claude Response  │              │
               └─────────────┬─────────────┘              │
                             │                            │
              ┌──────────────▼────────────────────────────▼──┐
              │ 11. Google Sheets Append Row                 │
              └──────────────────────────────────────────────┘
```

---

## 2. Node-by-Node Configuration Reference

### 1. Gmail Trigger
* **Type:** `n8n-nodes-base.gmailTrigger` (Version 1)
* **Description:** Monitors incoming messages and downloads the attachments.
* **Parameters:**
  * **Poll Times:** Every `5` minutes (`everyX` mode)
  * **Format:** `resolved` (gives detailed objects including MIME-types and raw elements)
  * **Download Attachments:** `True` (Checks the option so n8n fetches attachments directly into binary storage)
  * **Filters:**
    * **Read Status:** `unread`
    * **Search Query (q):** `has:attachment filename:pdf` (to pre-filter to only emails with PDF files before processing)
  * **Options:**
    * **Mark as Read:** `True` (prevents double execution in future cycles)

### 2. Select PDF Attachment (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Description:** Inspects incoming binary elements, looks for `application/pdf` MIME type, normalizes the binary key to `invoice_pdf` so that succeeding nodes have a predictable input, and parses out the sender's email.
* **JS Code:**
```javascript
const binaryKeys = Object.keys(item.binary || {});
const pdfKey = binaryKeys.find(k => item.binary[k].mimeType && item.binary[k].mimeType.includes('application/pdf'));

if (pdfKey) {
  item.json.has_pdf = true;
  item.json.pdf_filename = item.binary[pdfKey].fileName;
  item.json.pdf_mime_type = item.binary[pdfKey].mimeType;
  let email = null;
  if (item.json.from) {
    if (typeof item.json.from === 'string') {
      const match = item.json.from.match(/<([^>]+)>/);
      email = match ? match[1] : item.json.from;
    } else if (item.json.from.value && item.json.from.value[0]) {
      email = item.json.from.value[0].address;
    } else if (item.json.from.text) {
      const match = item.json.from.text.match(/<([^>]+)>/);
      email = match ? match[1] : item.json.from.text;
    }
  }
  item.json.sender_email = email || 'unknown@example.com';
  item.binary = {
    invoice_pdf: item.binary[pdfKey]
  };
} else {
  item.json.has_pdf = false;
  item.binary = {};
}
return item;
```

### 3. Filter PDF Emails
* **Type:** `n8n-nodes-base.filter` (Version 1)
* **Description:** Discards emails that do not contain a PDF attachment.
* **Conditions:**
  * `{{ $json.has_pdf }}` (Boolean) equals `true`.
* **Action on mismatch:** Skips silently.

### 4. Extract PDF Text
* **Type:** `n8n-nodes-base.extractFromFile` (Version 1)
* **Description:** Parses the raw textual representation from the binary attachment.
* **Parameters:**
  * **Operation:** `pdf`
  * **Binary Property:** `invoice_pdf`
* **Settings:**
  * **On Error:** `Continue (Regular Output)` (allows us to trap/log errors ourselves downstream rather than failing the execution entirely)

### 5. Validate & Prep Extraction (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Description:** Examines the output of the extraction. If the extraction failed or text is empty, flags `extraction_failed = true`. If text is present but contains fewer than 50 characters, logs a warning but proceeds.
* **JS Code:**
```javascript
if (item.json.error || !item.json.text) {
  item.json.extraction_failed = true;
  item.json.extraction_warning = null;
  item.json.invoice_text = '';
} else {
  item.json.extraction_failed = false;
  item.json.invoice_text = item.json.text;
  if (item.json.text.length < 50) {
    item.json.extraction_warning = 'Extraction returned < 50 characters: ' + item.json.text.length;
    console.warn(item.json.extraction_warning);
  } else {
    item.json.extraction_warning = null;
  }
}
return item;
```

### 6. IF Extraction Success
* **Type:** `n8n-nodes-base.if` (Version 1)
* **Description:** Directs workflow along the happy path (Claude API extraction) or the failure path (log failure to sheet directly).
* **Conditions:**
  * `{{ $json.extraction_failed }}` (Boolean) equals `false` (leads to TRUE output)

### 7. Prepare Claude Payload (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Description:** Prepares the system prompt and dynamic prompt variables formatted as a Claude messages payload structure.
* **JS Code:**
```javascript
const invoiceText = item.json.invoice_text || '';
const systemPrompt = `You are a specialized invoice data extraction engine. Extract structured data from invoice documents and return ONLY valid JSON with no markdown formatting, no explanations, no preamble.\n\nReturn this exact JSON structure with all fields present:\n\n{\n  "invoice_number": {"value": null, "confidence": 0},\n  "invoice_date": {"value": null, "confidence": 0},\n  "due_date": {"value": null, "confidence": 0},\n  "vendor": {\n    "name": {"value": null, "confidence": 0},\n    "address": {"value": null, "confidence": 0},\n    "email": {"value": null, "confidence": 0}\n  },\n  "client": {\n    "name": {"value": null, "confidence": 0}\n  },\n  "line_items": [\n    {\n      "description": {"value": null, "confidence": 0},\n      "quantity": {"value": null, "confidence": 0},\n      "unit_price": {"value": null, "confidence": 0},\n      "line_total": {"value": null, "confidence": 0}\n    }\n  ],\n  "currency": {"value": null, "confidence": 0},\n  "subtotal": {"value": null, "confidence": 0},\n  "tax_amount": {"value": null, "confidence": 0},\n  "total": {"value": null, "confidence": 0},\n  "payment_terms": {"value": null, "confidence": 0}\n}\n\nRules:\n1. All dates must be YYYY-MM-DD format\n2. All monetary values must be numeric only (no $, no commas)\n3. If a field is not present, use {"value": null, "confidence": 100}\n4. line_items must be an array (even if single item)\n\nExtract from this invoice text:\n${invoiceText}`;

item.json.claude_payload = {
  model: 'claude-opus-4-5',
  max_tokens: 2000,
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: systemPrompt
        }
      ]
    }
  ]
};
return item;
```

### 8. Claude API Call (HTTP Request)
* **Type:** `n8n-nodes-base.httpRequest` (Version 4.1)
* **Description:** Executes a POST request to Claude API with built-in retry options.
* **Parameters:**
  * **Method:** `POST`
  * **URL:** `https://api.anthropic.com/v1/messages`
  * **Authentication:** `Generic Credential` -> `Header Auth` (name: `Claude API Key`)
  * **Headers:**
    * `anthropic-version`: `2023-06-01`
    * `content-type`: `application/json`
    * `x-api-key`: `={{$credentials.claudeApiKey}}`
  * **Body:** `JSON` -> `={{ JSON.stringify($json.claude_payload) }}`
  * **Options:**
    * **Retry On Fail:** `True`
    * **Max Retries:** `1`
    * **Retry Interval (ms):** `5000` (5 seconds)
* **Settings:**
  * **On Error:** `Continue (Regular Output)` (allows downstream parsing to record API-level errors gracefully to the Google Sheet)

### 9. Parse Claude Response (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Description:** Extracts raw content from `content[0].text`, attempts to parse JSON, handles markdown wrap characters if present, extracts nested values, and sets fallback options in case of syntax issues.
* **JS Code:**
```javascript
let extracted = {
  invoice_number: null,
  invoice_date: null,
  due_date: null,
  vendor_name: null,
  vendor_address: null,
  vendor_email: null,
  client_name: null,
  subtotal: null,
  tax_amount: null,
  total: null,
  currency: null,
  raw_response: null
};

if (item.json.error || !item.json.content || !item.json.content[0] || !item.json.content[0].text) {
  extracted.raw_response = item.json.error ? JSON.stringify(item.json.error) : 'API_FAILED_OR_INVALID_RESPONSE';
  item.json.extracted_data = extracted;
  item.json.success = false;
  return item;
}

const rawText = item.json.content[0].text;
extracted.raw_response = rawText;

try {
  let jsonStr = rawText.trim();
  if (jsonStr.includes('```json')) {
    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
  } else if (jsonStr.includes('```')) {
    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
  }

  const data = JSON.parse(jsonStr);

  extracted.invoice_number = data.invoice_number?.value ?? null;
  extracted.invoice_date = data.invoice_date?.value ?? null;
  extracted.due_date = data.due_date?.value ?? null;
  extracted.vendor_name = data.vendor?.name?.value ?? null;
  extracted.vendor_address = data.vendor?.address?.value ?? null;
  extracted.vendor_email = data.vendor?.email?.value ?? null;
  extracted.client_name = data.client?.name?.value ?? null;
  extracted.subtotal = data.subtotal?.value ?? null;
  extracted.tax_amount = data.tax_amount?.value ?? null;
  extracted.total = data.total?.value ?? null;
  extracted.currency = data.currency?.value ?? null;

  item.json.extracted_data = extracted;
  item.json.success = true;
} catch (err) {
  console.error('Failed to parse Claude response JSON', err);
  extracted.raw_response = 'PARSE_FAILED: ' + rawText;
  item.json.extracted_data = extracted;
  item.json.success = false;
}
return item;
```

### 10. Prepare Failed Extraction Row (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Description:** Executes if step (6) redirects to `FALSE`. Generates a fallback object matching the same schema with `raw_response` populated as `"EXTRACTION_FAILED"`.
* **JS Code:**
```javascript
item.json.extracted_data = {
  invoice_number: null,
  invoice_date: null,
  due_date: null,
  vendor_name: null,
  vendor_address: null,
  vendor_email: null,
  client_name: null,
  subtotal: null,
  tax_amount: null,
  total: null,
  currency: null,
  raw_response: 'EXTRACTION_FAILED'
};
item.json.success = false;
return item;
```

### 11. Google Sheets Append
* **Type:** `n8n-nodes-base.googleSheets` (Version 4)
* **Description:** Appends a new data row to the target sheet.
* **Parameters:**
  * **Operation:** `appendRow`
  * **Document ID:** `YOUR_SPREADSHEET_ID_HERE` (Dynamic selection)
  * **Sheet Name:** `Sheet1`
  * **Columns Mapping Mode:** `Define Below`
  * **Column Headers & Mapping Expressions:**
    * **Timestamp:** `={{ new Date().toISOString() }}`
    * **Source Email:** `={{ $json.sender_email || 'unknown@example.com' }}`
    * **Attachment Filename:** `={{ $json.pdf_filename || 'N/A' }}`
    * **Invoice Number:** `={{ $json.extracted_data?.invoice_number }}`
    * **Invoice Date:** `={{ $json.extracted_data?.invoice_date }}`
    * **Due Date:** `={{ $json.extracted_data?.due_date }}`
    * **Vendor Name:** `={{ $json.extracted_data?.vendor_name }}`
    * **Vendor Address:** `={{ $json.extracted_data?.vendor_address }}`
    * **Vendor Email:** `={{ $json.extracted_data?.vendor_email }}`
    * **Client Name:** `={{ $json.extracted_data?.client_name }}`
    * **Subtotal:** `={{ $json.extracted_data?.subtotal }}`
    * **Tax Amount:** `={{ $json.extracted_data?.tax_amount }}`
    * **Total:** `={{ $json.extracted_data?.total }}`
    * **Currency:** `={{ $json.extracted_data?.currency }}`
    * **Raw Response:** `={{ $json.extracted_data?.raw_response }}`

---

## 3. Credentials Setup Guide

To configure the workflow inside n8n, prepare and link the following credentials:

### A. Gmail Credential (OAuth2)
1. In n8n, create a new credential of type **Gmail OAuth2 API**.
2. Create a Google Cloud Platform project in the GCP Console, enable the Gmail API, and generate an OAuth Client ID/Client Secret.
3. Add n8n's callback redirect URI (provided inside the n8n Gmail credential window) to the authorized redirect URIs in GCP.
4. Set Scopes to: `https://www.googleapis.com/auth/gmail.modify` (needed to read emails and mark them as read).
5. Click **Connect** and authenticate your account.

### B. Claude API Key (Header Auth)
1. In n8n, create a credential of type **Header Auth**.
2. Name it `Claude API Key`.
3. Set **Name** as `x-api-key`.
4. Set **Value** to your secret Anthropic API Key (e.g. `sk-ant-...`).

### C. Google Sheets Credential (OAuth2)
1. In n8n, create a new credential of type **Google Sheets OAuth2 API**.
2. In GCP Console (same or different project), ensure **Google Sheets API** is enabled.
3. Authenticate using the corresponding client ID and client secret.
4. Verify the authorization is complete and has read/write privileges.

---

## 4. Google Sheets Template

Before executing your first run, create a new Google Spreadsheet and configure **exactly** these headers in Row 1 (columns A to O):

| Column | Column Header | Value Format Example |
| :--- | :--- | :--- |
| **A** | `Timestamp` | `2023-11-20T14:32:00.000Z` |
| **B** | `Source Email` | `billing@vendor.com` |
| **C** | `Attachment Filename` | `inv_48293.pdf` |
| **D** | `Invoice Number` | `INV-48293` |
| **E** | `Invoice Date` | `2023-11-18` |
| **F** | `Due Date` | `2023-12-18` |
| **G** | `Vendor Name` | `Acme Corp Ltd` |
| **H** | `Vendor Address` | `123 Main St, New York, NY 10001` |
| **I** | `Vendor Email` | `sales@acme.com` |
| **J** | `Client Name` | `Initech LLC` |
| **K** | `Subtotal` | `1250.00` |
| **L** | `Tax Amount` | `100.00` |
| **M** | `Total` | `1350.00` |
| **N** | `Currency` | `USD` |
| **O** | `Raw Response` | *(Full raw JSON string from Claude response)* |

*Note: Ensure the Sheet Name matches `Sheet1` or update the sheet name value inside node 11 settings accordingly.*

---

## 5. Test Instructions

Follow these steps to perform manual/interactive verification of Phase 01:

1. **Upload the Workflow JSON:**
   * Copy the content of `workflow.json`.
   * Open your n8n workflow editor canvas.
   * Click the settings options / options menu and select "Import from JSON" (or paste directly onto the canvas using `Ctrl+V` / `Cmd+V`).
2. **Associate Credentials:**
   * Map the Gmail, Google Sheets, and Header Auth (Claude API Key) credentials to their respective nodes.
3. **Configure Spreadsheet Target:**
   * Open the "Google Sheets Append" node, insert your Google Spreadsheet's exact ID, and verify the sheet is named `Sheet1`.
4. **Draft and Send a Sample Email:**
   * Create an email using a standard email account.
   * Attach a text-based, standard PDF invoice (e.g. from AWS, stripe, or standard office template).
   * Send the email to the monitored Gmail account.
5. **Manually Execute (Dry-Run):**
   * Inside n8n, click the **Listen for Test Event** / **Test Node** button on the Gmail Trigger or click **Execute Workflow** at the bottom of the screen.
   * Confirm that the email is pulled, marked as read, extraction succeeds, Claude is invoked, and the new row is written to the sheet.
6. **Negative Test Run (Graceful skip check):**
   * Draft and send an email containing a non-PDF attachment (e.g. `document.docx` or `image.png`).
   * Trigger the workflow execution.
   * Confirm that the filter skips execution silently without introducing errors or appending rows.

---

## 6. Expected Output Example (Google Sheets row)

When an invoice gets processed successfully, a row is appended containing:

* **Timestamp:** `2023-10-24T18:42:15.932Z`
* **Source Email:** `billing@acme.com`
* **Attachment Filename:** `invoice_9942.pdf`
* **Invoice Number:** `INV-9942`
* **Invoice Date:** `2023-10-23`
* **Due Date:** `2023-11-23`
* **Vendor Name:** `Acme Corporation`
* **Vendor Address:** `555 Industrial Pkwy, Sector 7`
* **Vendor Email:** `billing@acme.com`
* **Client Name:** `Homer Simpson`
* **Subtotal:** `850.00`
* **Tax Amount:** `72.25`
* **Total:** `922.25`
* **Currency:** `USD`
* **Raw Response:** `{"invoice_number":{"value":"INV-9942","confidence":95},"invoice_date":{"value":"2023-10-23","confidence":99},"due_date":{"value":"2023-11-23","confidence":99},"vendor":{"name":{"value":"Acme Corporation","confidence":99},"address":{"value":"555 Industrial Pkwy, Sector 7","confidence":95},"email":{"value":"billing@acme.com","confidence":90}},"client":{"name":{"value":"Homer Simpson","confidence":98}},"line_items":[{"description":{"value":"Nuclear rods","confidence":95},"quantity":{"value":10,"confidence":99},"unit_price":{"value":85.00,"confidence":99},"line_total":{"value":850.00,"confidence":99}}],"currency":{"value":"USD","confidence":99},"subtotal":{"value":850.00,"confidence":99},"tax_amount":{"value":72.25,"confidence":99},"total":{"value":922.25,"confidence":99},"payment_terms":{"value":"Net 30","confidence":90}}`
