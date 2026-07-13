# Phase 02: AI Invoice Data Extractor System Documentation (Multimodal Upgrade)

This guide provides the complete blueprint, setup instructions, and execution details for **Phase 02** of the **AI Invoice Data Extractor** system.

---

## 1. System Architecture (Phase 02)

Phase 02 upgrades the pipeline from a text-only PDF extractor to an **intelligent, multimodal file processor**. The pipeline automatically detects the file type via magic bytes, routing text-based PDFs to a fast textual extraction path, while converting scanned PDFs and handling raw images (JPEG/PNG) via a **Claude Vision API** path using `claude-3-5-sonnet-20241022`.

The system completes this end-to-end flow in **exactly 13 nodes** (under the 15-node limit constraint) by leveraging n8n's implicit `OR` connection logic—obviating any blocked/waiting inputs typical in custom merge nodes on mutually exclusive execution branches.

```
                         ┌─────────────────────────────┐
                         │      1. Gmail Trigger       │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────▼──────────────┐
                         │     2. detectFileType       │
                         └──────────────┬──────────────┘
                                        │
                     ┌──────────────────┴──────────────────┐
                     │          3. Switch Routing          │
                     └──────┬───────────┬───────────┬──────┘
             (pdf)          │           │ (jpeg/png)│ (unknown)
                            │           │           │
       ┌────────────────────▼┐          │           │
       │ 4. Extract PDF Text │          │           │
       └────────────┬────────┘          │           │
                    │                   │           │
       ┌────────────▼─────────────┐     │           │
       │5. IF PDF Text Length > 50│     │           │
       └────────────┬────────┬────┘     │           │
             (YES)  │        │ (NO)     │           │
    ┌───────────────▼┐ ┌─────▼──────────┴────────┐  │
    │ 6. Set Text    │ │ 7. Convert PDF to Image │  │
    │    Path Meta   │ └─────────────┬───────────┘  │
    └───────┬────────┘               │              │
            │          ┌─────────────▼───────────┐  │
            │          │ 8. binaryToBase64       │  │
            │          └─────────────┬───────────┘  │
            │                        │              │
            └───────────────┬────────┴──────────────┘
                            │ (Implicit Merge / OR Connection)
             ┌──────────────▼───────────────────────┐
             │ 9. Prep Claude Multimodal Payload    │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐   ┌───────────────────────────┐
             │ 10. Claude API Call                  │   │ 12. Prepare Failed Row    │
             └──────────────┬───────────────────────┘   └─────────────┬─────────────┘
                            │ (On Error/Success)                      │
             ┌──────────────▼───────────────────────┐                 │
             │ 11. Parse Claude Response            │                 │
             └──────────────┬───────────────────────┘                 │
                            │                                         │
                            └───────────────────────┬─────────────────┘
                                                    │
                                     ┌──────────────▼──────────────┐
                                     │ 13. Google Sheets Append    │
                                     └─────────────────────────────┘
```

---

## 2. Node-by-Node Parameter Configuration Reference

### 1. Gmail Trigger
* **Type:** `n8n-nodes-base.gmailTrigger` (Version 1)
* **Parameters:**
  * **Poll Times:** Every `5` minutes (`everyX` mode)
  * **Format:** `resolved`
  * **Download Attachments:** `True`
  * **Filters:**
    * **Read Status:** `unread`
    * **Search Query (q):** `has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)`
  * **Options:**
    * **Mark as Read:** `True`

### 2. detectFileType (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForAllItems`
* **Description:** Reads the first 4 bytes of the binary buffer to identify file signatures (magic bytes) reliably, normalizes binary keys, and extracts the sender's email.
* **JS Code:**
```javascript
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const binaryKeys = Object.keys(item.binary || {});
  if (binaryKeys.length === 0) {
    item.json.fileType = 'unknown';
    item.json.has_attachment = false;
    continue;
  }
  item.json.has_attachment = true;

  const attachmentKey = binaryKeys.find(k => {
    const mime = (item.binary[k].mimeType || '').toLowerCase();
    const name = (item.binary[k].fileName || '').toLowerCase();
    return mime.includes('pdf') || mime.includes('jpeg') || mime.includes('jpg') || mime.includes('png') ||
           name.endsWith('.pdf') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
  }) || binaryKeys[0];

  item.json.attachment_key = attachmentKey;
  item.json.pdf_filename = item.binary[attachmentKey].fileName;
  item.json.pdf_mime_type = item.binary[attachmentKey].mimeType;

  try {
    const buffer = await this.helpers.getBinaryDataBuffer(i, attachmentKey);
    if (buffer && buffer.length >= 4) {
      const magic = buffer.readUInt32BE(0);
      if (magic === 0x25504446) {
        item.json.fileType = 'pdf';
      } else if (magic === 0x89504E47) {
        item.json.fileType = 'png';
      } else if ((magic >> 8) === 0xFFD8FF || magic === 0xFFD8FFE0 || magic === 0xFFD8FFE1) {
        item.json.fileType = 'jpeg';
      } else {
        const mime = (item.binary[attachmentKey].mimeType || '').toLowerCase();
        if (mime.includes('pdf')) {
          item.json.fileType = 'pdf';
        } else if (mime.includes('jpeg') || mime.includes('jpg')) {
          item.json.fileType = 'jpeg';
        } else if (mime.includes('png')) {
          item.json.fileType = 'png';
        } else {
          item.json.fileType = 'unknown';
        }
      }
    } else {
      item.json.fileType = 'unknown';
    }
  } catch (e) {
    item.json.fileType = 'unknown';
    item.json.detection_error = e.message;
  }

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
    attachment: item.binary[attachmentKey]
  };
}
return items;
```

### 3. Switch Routing
* **Type:** `n8n-nodes-base.switch` (Version 1)
* **Parameters:**
  * **Data Type:** `string`
  * **Value1:** `={{ $json.fileType }}`
  * **Rules:**
    * Equal: `pdf` -> Output `0` (Path A: Text PDF Path)
    * Equal: `jpeg` -> Output `1` (Path B: Vision Image Path)
    * Equal: `png` -> Output `1` (Path B: Vision Image Path)
  * **Fallback Output:** `2` (Path C: Unsupported/Error Path)

### 4. Extract PDF Text
* **Type:** `n8n-nodes-base.extractFromFile` (Version 1)
* **Parameters:**
  * **Operation:** `pdf`
  * **Binary Property:** `attachment`
* **Settings:**
  * **On Error:** `Continue (Regular Output)`

### 5. IF PDF Text Length > 50
* **Type:** `n8n-nodes-base.if` (Version 1)
* **Parameters:**
  * **Conditions:**
    * **Number:** `={{ $json.text ? $json.text.length : 0 }}` is greater than `50`
  * **Routes:**
    * `TRUE` -> Goes to `Set Text Path Meta`
    * `FALSE` -> Goes to `Convert PDF to Image` (scanned PDF fallback)

### 6. Set Text Path Meta (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **JS Code:**
```javascript
item.json.path = 'text';
item.json.invoice_text = item.json.text || '';
return item;
```

### 7. Convert PDF to Image
* **Type:** `n8n-nodes-base.convertToFile` (Version 1)
* **Description:** Converts scanned PDF file into JPEG format. Force extraction to page 1 only at 300 DPI to save Claude Vision tokens and processing latency.
* **Parameters:**
  * **Operation:** `convertToImage`
  * **Binary Property:** `attachment`
  * **Options:**
    * **DPI:** `300`
    * **Page Range:** `1`
  * **Output Binary Property:** `attachment`

### 8. binaryToBase64 (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForAllItems`
* **Description:** Encodes any image binary (JPG, PNG, or converted scanned PDF page) to raw Base64 strings.
* **JS Code:**
```javascript
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  const binaryKeys = Object.keys(item.binary || {});
  if (binaryKeys.length === 0) {
    item.json.base64String = '';
    item.json.mimeType = 'image/jpeg';
    item.json.path = 'vision';
    continue;
  }

  const imageKey = binaryKeys.find(k => {
    const mime = (item.binary[k].mimeType || '').toLowerCase();
    return mime.includes('jpeg') || mime.includes('jpg') || mime.includes('png');
  }) || binaryKeys[0];

  try {
    const buffer = await this.helpers.getBinaryDataBuffer(i, imageKey);
    if (buffer) {
      item.json.base64String = buffer.toString('base64');
      item.json.mimeType = item.binary[imageKey].mimeType || 'image/jpeg';
    } else {
      item.json.base64String = '';
      item.json.mimeType = 'image/jpeg';
    }
  } catch (err) {
    console.error('Failed to encode binary to base64', err);
    item.json.base64String = '';
    item.json.mimeType = 'image/jpeg';
  }
  item.json.path = 'vision';
}
return items;
```

### 9. Prepare Claude Multimodal Payload (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Assembles the updated Claude Multimodal body payload using model `claude-3-5-sonnet-20241022`. Receives items from either `Set Text Path Meta` OR `binaryToBase64` implicitly, bypassing deadlock-prone custom merge nodes.
* **JS Code:**
```javascript
const systemPrompt = `You are a specialized invoice data extraction engine. You will receive either raw text or an image of an invoice. Extract structured data and return ONLY valid JSON with no markdown formatting, no explanations, no preamble.

Return this exact JSON structure with all fields present:

{
  "invoice_number": {"value": null, "confidence": 0},
  "invoice_date": {"value": null, "confidence": 0},
  "due_date": {"value": null, "confidence": 0},
  "vendor": {
    "name": {"value": null, "confidence": 0},
    "address": {"value": null, "confidence": 0},
    "email": {"value": null, "confidence": 0}
  },
  "client": {
    "name": {"value": null, "confidence": 0}
  },
  "line_items": [
    {
      "description": {"value": null, "confidence": 0},
      "quantity": {"value": null, "confidence": 0},
      "unit_price": {"value": null, "confidence": 0},
      "line_total": {"value": null, "confidence": 0}
    }
  ],
  "currency": {"value": null, "confidence": 0},
  "subtotal": {"value": null, "confidence": 0},
  "tax_amount": {"value": null, "confidence": 0},
  "total": {"value": null, "confidence": 0},
  "payment_terms": {"value": null, "confidence": 0}
}

Rules:
1. All dates must be YYYY-MM-DD format
2. All monetary values must be numeric only (no $, no commas)
3. If a field is not present, use {"value": null, "confidence": 100}
4. line_items must be an array (even if single item)

Additional Rule for Images: If reading from an image, infer missing context visually (e.g., logos for vendor name, layout for line items). If a field is completely illegible, use {"value": null, "confidence": 0}.`;

const path = item.json.path || 'text';
let content = [];

if (path === 'text') {
  const extractedText = item.json.invoice_text || '';
  content = [
    {
      type: "text",
      text: `${systemPrompt}\n\nINVOICE TEXT:\n${extractedText}`
    }
  ];
} else if (path === 'vision') {
  const base64String = item.json.base64String || '';
  const mimeType = item.json.mimeType || 'image/jpeg';
  content = [
    {
      type: "text",
      text: systemPrompt
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: base64String
      }
    }
  ];
}

item.json.claude_payload = {
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 2000,
  messages: [
    {
      role: 'user',
      content: content
    }
  ]
};
return item;
```

### 10. Claude API Call
* **Type:** `n8n-nodes-base.httpRequest` (Version 4.1)
* **Parameters:**
  * **Method:** `POST`
  * **URL:** `https://api.anthropic.com/v1/messages`
  * **Headers:**
    * `anthropic-version`: `2023-06-01`
    * `content-type`: `application/json`
    * `x-api-key`: `={{$credentials.claudeApiKey}}`
  * **Body:** `JSON` -> `={{ JSON.stringify($json.claude_payload) }}`
  * **Options:**
    * **Retry On Fail:** `True`
    * **Max Retries:** `1`
    * **Retry Interval (ms):** `5000`
* **Settings:**
  * **On Error:** `Continue (Regular Output)`

### 11. Parse Claude Response
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Parses structured JSON from Claude response, handling Markdown backticks safely.

### 12. Prepare Failed Extraction Row
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Prepares fallback row structure in case of unsupported file types or extraction pipeline failures.
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
  raw_response: item.json.fileType === 'unknown' ? 'UNSUPPORTED_FILE_TYPE' : 'EXTRACTION_FAILED'
};
item.json.success = false;
return item;
```

### 13. Google Sheets Append
* **Type:** `n8n-nodes-base.googleSheets` (Version 4)
* **Parameters:**
  * **Operation:** `appendRow`
  * **Columns Mapping Mode:** `Define Below`
  * **Mapping Expressions:**
    * **Timestamp:** `={{ new Date().toISOString() }}`
    * **Source Email:** `={{ $('detectFileType').item.json.sender_email || 'unknown@example.com' }}`
    * **Attachment Filename:** `={{ $('detectFileType').item.json.pdf_filename || 'N/A' }}`
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
Identical to Phase 01: Ensure **Gmail API OAuth2**, **Claude API Key Header Auth**, and **Google Sheets OAuth2** are authenticated and mapped correctly to their respective nodes.

---

## 4. Google Sheets Template
Maintain backward compatibility with Phase 01. Configure exactly these headers in Row 1 (A-O):

`Timestamp`, `Source Email`, `Attachment Filename`, `Invoice Number`, `Invoice Date`, `Due Date`, `Vendor Name`, `Vendor Address`, `Vendor Email`, `Client Name`, `Subtotal`, `Tax Amount`, `Total`, `Currency`, `Raw Response`.

---

## 5. Testing Protocol

Test each path sequentially to verify that file-type routing and multimodal extraction execute reliably:

### Test Case A: Clean Text-Based PDF (Path A)
1. E-mail a clean, text-based PDF invoice to your monitored inbox.
2. Trigger the workflow in n8n.
3. **Verification:**
   * Open the execution log. Confirm the file routes to `detectFileType` (`fileType` matches `"pdf"`).
   * Confirm the flow branches to `Extract PDF Text`.
   * Confirm `IF PDF Text Length > 50` goes to the **TRUE** branch (`Set Text Path Meta`).
   * Confirm the Claude payload gets constructed with `type: "text"` containing raw invoice text.
   * Confirm Google Sheets writes the parsed row containing the extracted fields.

### Test Case B: Scanned/Image-Based PDF (Path B)
1. Generate an image-based PDF (e.g. by scanning a printed invoice as PDF or wrapping a JPG in a PDF container).
2. Email the scanned PDF attachment.
3. Trigger the workflow.
4. **Verification:**
   * Confirm the file routes to `detectFileType` (`fileType` matches `"pdf"`).
   * Confirm the flow branches to `Extract PDF Text`.
   * Confirm `IF PDF Text Length > 50` goes to the **FALSE** branch (text is `< 50` characters).
   * Confirm the workflow invokes `Convert PDF to Image` followed by `binaryToBase64`.
   * Confirm the Claude payload gets constructed with `type: "image"` containing the base64 string.
   * Confirm Google Sheets writes the parsed row successfully.

### Test Case C: Direct JPG or PNG Image (Path C)
1. Send an email containing a direct `.jpg` or `.png` invoice image attachment.
2. Trigger the workflow.
3. **Verification:**
   * Confirm `detectFileType` identifies `fileType` as `"jpeg"` or `"png"`.
   * Confirm the `Switch Routing` node routes the item directly to `binaryToBase64` (skipping the PDF conversion node).
   * Confirm the Claude payload gets constructed with `type: "image"` and the correct mimetype header (`image/jpeg` or `image/png`).
   * Confirm Google Sheets writes the parsed row successfully.

### Test Case D: Graceful Fail on Unsupported File Types
1. Send an email with an unsupported format (e.g. `invoice.docx`, `invoice.xlsx` or text file).
2. Trigger the workflow.
3. **Verification:**
   * Confirm `detectFileType` identifies `fileType` as `"unknown"`.
   * Confirm `Switch Routing` routes to `Prepare Failed Extraction Row`.
   * Confirm Google Sheets writes a row with `Raw Response` set to `UNSUPPORTED_FILE_TYPE`.
