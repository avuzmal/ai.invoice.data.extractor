# Phase 03: AI Invoice Data Extractor System Documentation (Intelligent Auditing)

This guide provides the complete blueprint, setup instructions, and execution details for **Phase 03** of the **AI Invoice Data Extractor** system.

---

## 1. System Architecture (Phase 03)

Phase 03 transforms the extraction pipeline into an **intelligent auditing and compliance platform**. The pipeline continues to automatically routing files by type (text-based PDF vs. scanned PDF vs. raw images), but integrates four new deterministic validation and status nodes immediately after parsing the Claude API JSON response:

The entire pipeline is consolidated into **exactly 15 nodes** (complying with clean and highly optimized workflows) by using n8n's implicit `OR` connection logic and flat mapping fallbacks.

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
            ┌───────▼┐ ┌─────▼──────────┴────────┐  │
            │        │ │ 6. Convert PDF to Image │  │
            │        │ └─────────────┬───────────┘  │
            │        │               │              │
            │        │ ┌─────────────▼───────────┐  │
            │        │ │ 7. binaryToBase64       │  │
            │        │ └─────────────┬───────────┘  │
            │        │               │              │
            └───────┬┴───────────────┴──────────────┘
                    │ (Implicit OR Connection)
             ┌──────▼───────────────────────────────┐
             │ 8. Prep Claude Multimodal Payload    │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐
             │ 9. Claude API Call                   │
             └──────────────┬───────────────────────┘
                            │ (On Error/Success)
             ┌──────────────▼───────────────────────┐
             │ 10. Parse Claude Response            │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐
             │ 11. validateMath                     │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐◄──────────────┘
             │ 12. validateFields                   │ (Unified Fallback from Switch)
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐
             │ 13. classifyConfidence               │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐
             │ 14. determineStatus                  │
             └──────────────┬───────────────────────┘
                            │
             ┌──────────────▼───────────────────────┐
             │ 15. Google Sheets Append             │
             └──────────────────────────────────────┘
```

---

## 2. Validation & Classification Nodes Specification

### Node 11: `validateMath` (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Performs mathematical cross-checks:
  1. **Line Items Check:** Sums all `line_total` values and checks them against `subtotal`. Adds flag `LINE_ITEM_SUM_MISMATCH` if difference > $0.02.
  2. **Grand Total Check:** Calculates `subtotal + tax - discount` and checks it against `total`. Adds flag `TOTAL_MISMATCH` if difference > $0.02.
* **JS Code:**
```javascript
const item = $input.item;
item.json.mathDiscrepancies = [];
item.json.flags = item.json.flags || [];

if (item.json.success && item.json.extracted_json) {
  const data = item.json.extracted_json;

  // Check 1: Line Items Sum vs Subtotal
  if (data.line_items && Array.isArray(data.line_items) && data.subtotal && data.subtotal.value !== null) {
    let lineItemsSum = 0;
    let hasLineItems = false;
    for (const line of data.line_items) {
      if (line.line_total && line.line_total.value !== null) {
        const val = parseFloat(line.line_total.value);
        if (!isNaN(val)) {
          lineItemsSum += val;
          hasLineItems = true;
        }
      }
    }

    if (hasLineItems) {
      const subtotalVal = parseFloat(data.subtotal.value);
      if (!isNaN(subtotalVal)) {
        const diff = Math.abs(lineItemsSum - subtotalVal);
        if (diff > 0.02) {
          item.json.mathDiscrepancies.push(`Line items sum (${lineItemsSum.toFixed(2)}) ≠ subtotal (${subtotalVal.toFixed(2)})`);
          item.json.flags.push("LINE_ITEM_SUM_MISMATCH");
        }
      }
    }
  }

  // Check 2: Grand Total Match
  if (data.subtotal && data.subtotal.value !== null && data.total && data.total.value !== null) {
    const subtotal = parseFloat(data.subtotal.value);
    const total = parseFloat(data.total.value);
    const tax = data.tax_amount && data.tax_amount.value !== null ? parseFloat(data.tax_amount.value) : 0;
    const discount = data.discount_amount && data.discount_amount.value !== null ? parseFloat(data.discount_amount.value) : 0;

    if (!isNaN(subtotal) && !isNaN(total)) {
      const expectedTotal = subtotal + tax - discount;
      const diff = Math.abs(expectedTotal - total);
      if (diff > 0.02) {
        item.json.mathDiscrepancies.push(`Calculated total (${expectedTotal.toFixed(2)}) ≠ stated total (${total.toFixed(2)})`);
        item.json.flags.push("TOTAL_MISMATCH");
      }
    }
  }
}

return item;
```

### Node 12: `validateFields` (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Enforces strict field presence and formatting rules:
  1. **Required Fields:** Ensures `invoice_number`, `invoice_date`, `total`, and `vendor.name` are present and not null. Adds flag `MISSING_[FIELD_NAME]`.
  2. **Date Format:** Validates `invoice_date` and `due_date` format against `/^\d{4}-\d{2}-\d{2}$/`. Adds flag `INVALID_DATE_FORMAT_[FIELD]`.
  3. **Negative Totals:** Flags credit notes or negative totals with `NEGATIVE_TOTAL`.
* **JS Code:**
```javascript
const item = $input.item;
item.json.flags = item.json.flags || [];

if (item.json.success && item.json.extracted_json) {
  const data = item.json.extracted_json;

  // Required fields check
  const required = {
    "invoice_number": data.invoice_number?.value,
    "invoice_date": data.invoice_date?.value,
    "total": data.total?.value,
    "vendor.name": data.vendor?.name?.value
  };

  for (const [key, val] of Object.entries(required)) {
    if (val === null || val === undefined) {
      const flagName = `MISSING_${key.toUpperCase().replace('.', '_')}`;
      item.json.flags.push(flagName);
    }
  }

  // Date format check
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (data.invoice_date?.value && !dateRegex.test(data.invoice_date.value)) {
    item.json.flags.push("INVALID_DATE_FORMAT_INVOICE_DATE");
  }
  if (data.due_date?.value && !dateRegex.test(data.due_date.value)) {
    item.json.flags.push("INVALID_DATE_FORMAT_DUE_DATE");
  }

  // Negative values check
  if (data.total?.value !== null && data.total?.value !== undefined) {
    const totalVal = parseFloat(data.total.value);
    if (!isNaN(totalVal) && totalVal < 0) {
      item.json.flags.push("NEGATIVE_TOTAL");
    }
  }
} else {
  // Fail path / Unsupported file / Extraction failed
  item.json.flags.push("MISSING_INVOICE_NUMBER");
  item.json.flags.push("MISSING_INVOICE_DATE");
  item.json.flags.push("MISSING_TOTAL");
  item.json.flags.push("MISSING_VENDOR_NAME");
}

return item;
```

### Node 13: `classifyConfidence` (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Recursively traverses the parsed nested JSON. Collects confidence scores, identifies low-confidence fields (`confidence < 75`), and calculates the overall average confidence score.
* **JS Code:**
```javascript
const item = $input.item;
item.json.lowConfidenceFields = [];
item.json.avgConfidence = 0;

if (item.json.success && item.json.extracted_json) {
  const data = item.json.extracted_json;
  const scores = [];
  const lowFields = [];

  function traverse(obj, path = "") {
    if (!obj || typeof obj !== "object") return;

    if ("value" in obj && "confidence" in obj) {
      if (obj.value !== null && obj.value !== undefined) {
        const conf = parseInt(obj.confidence, 10);
        if (!isNaN(conf)) {
          scores.push(conf);
          if (conf < 75) {
            lowFields.push({
              field: path,
              confidence: conf,
              value: obj.value
            });
          }
        }
      }
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((val, idx) => {
        traverse(val, `${path}[${idx}]`);
      });
    } else {
      for (const [key, val] of Object.entries(obj)) {
        const nextPath = path ? `${path}.${key}` : key;
        traverse(val, nextPath);
      }
    }
  }

  traverse(data);

  if (scores.length > 0) {
    const sum = scores.reduce((a, b) => a + b, 0);
    item.json.avgConfidence = Math.round(sum / scores.length);
  } else {
    item.json.avgConfidence = 0;
  }
  item.json.lowConfidenceFields = lowFields;
} else {
  item.json.avgConfidence = 0;
  item.json.lowConfidenceFields = [];
}

return item;
```

### Node 14: `determineStatus` (Code Node)
* **Type:** `n8n-nodes-base.code` (Version 2)
* **Mode:** `runOnceForEachItem`
* **Description:** Synthesizes validation outcomes into an audit classification:
  * **REVIEW_REQUIRED** (Color: `#EA4335` / Red): IF math discrepancies exist, OR `MISSING_INVOICE_NUMBER` or `MISSING_TOTAL` is flagged.
  * **REVIEW_RECOMMENDED** (Color: `#FBBC04` / Amber): IF average confidence score is `< 75`, OR if there are `> 2` low-confidence fields.
  * **AUTO_APPROVED** (Color: `#34A853` / Green): All rules pass successfully.
* **JS Code:**
```javascript
const item = $input.item;

const mathDiscrepancies = item.json.mathDiscrepancies || [];
const flags = item.json.flags || [];
const avgConfidence = item.json.avgConfidence ?? 0;
const lowConfidenceFields = item.json.lowConfidenceFields || [];

let status = "AUTO_APPROVED";
let statusColor = "#34A853"; // Green

if (
  mathDiscrepancies.length > 0 ||
  flags.includes("MISSING_INVOICE_NUMBER") ||
  flags.includes("MISSING_TOTAL")
) {
  status = "REVIEW_REQUIRED";
  statusColor = "#EA4335"; // Red
} else if (
  avgConfidence < 75 ||
  lowConfidenceFields.length > 2
) {
  status = "REVIEW_RECOMMENDED";
  statusColor = "#FBBC04"; // Amber
}

item.json.status = status;
item.json.statusColor = statusColor;

return item;
```

---

## 3. Updated Google Sheets Column Mapping Expressions

Six new validation and audit metadata columns are added to the right of the Phase 02 table (Columns P to U):

| Column | Header Name | Expression Mapping | Output Example |
| :--- | :--- | :--- | :--- |
| **P** | `Status` | `={{ $json.status }}` | `REVIEW_REQUIRED` |
| **Q** | `Status Color` | `={{ $json.statusColor }}` | `#EA4335` |
| **R** | `Avg Confidence` | `={{ $json.avgConfidence }}` | `98` |
| **S** | `Low Confidence Fields` | `={{ $json.lowConfidenceFields && $json.lowConfidenceFields.length > 0 ? $json.lowConfidenceFields.map(f => f.field + ' (' + f.confidence + '%)').join(', ') : 'None' }}` | `vendor.address (60%), line_items[0].description (55%)` |
| **T** | `Math Discrepancies` | `={{ $json.mathDiscrepancies && $json.mathDiscrepancies.length > 0 ? $json.mathDiscrepancies.join(', ') : 'None' }}` | `Line items sum (100.00) ≠ subtotal (105.00)` |
| **U** | `Flags` | `={{ $json.flags && $json.flags.length > 0 ? $json.flags.join(', ') : 'None' }}` | `LINE_ITEM_SUM_MISMATCH, TOTAL_MISMATCH` |

---

## 4. Testing Protocol

Ensure the deterministic auditing engine classifies status correctly by triggering and verifying these test scripts:

### Test Case 1: Mathematical Mismatch (Expected: `REVIEW_REQUIRED` / Red)
* **Goal:** Verify that a discrepancy in line item addition or grand totals triggers `REVIEW_REQUIRED`.
* **Setup:**
  1. Draft a sample text-based invoice PDF (or modify a sample) where:
     * Line item 1: $100.00, Line item 2: $50.00.
     * Stated Subtotal: $150.00 (correct).
     * Tax: $15.00, Discount: $0.00.
     * Stated Total: $195.00 (mathematically incorrect, expected is $165.00).
  2. Send this invoice to your monitored Gmail account and execute the workflow.
* **Verification:**
  * Confirm `validateMath` catches the math error: `item.json.mathDiscrepancies` contains `"Calculated total (165.00) ≠ stated total (195.00)"`.
  * Confirm `item.json.flags` contains `"TOTAL_MISMATCH"`.
  * Confirm `determineStatus` assigns status `"REVIEW_REQUIRED"` and color `"#EA4335"`.
  * Verify Google Sheets row displays:
    * **Status:** `REVIEW_REQUIRED`
    * **Status Color:** `#EA4335`
    * **Math Discrepancies:** `Calculated total (165.00) ≠ stated total (195.00)`
    * **Flags:** `TOTAL_MISMATCH`

### Test Case 2: Low-Confidence Field Trigger (Expected: `REVIEW_RECOMMENDED` / Amber)
* **Goal:** Verify that low OCR/extraction confidence values trigger a review warning.
* **Setup:**
  1. Select a heavily blurred or hand-written invoice image file (JPEG or PNG).
  2. Send this image file as an attachment and trigger the pipeline.
  3. Claude Vision extracts the fields but tags several (e.g., `vendor.address` or `due_date`) with a confidence level < 75 (e.g. `55%` or `60%`).
* **Verification:**
  * Confirm `classifyConfidence` traverses the JSON and collects those low scores.
  * Confirm `lowConfidenceFields` contains the field paths and scores.
  * If average confidence is `< 75` OR if `lowConfidenceFields.length > 2`, confirm `determineStatus` assigns `"REVIEW_RECOMMENDED"` and color `"#FBBC04"`.
  * Verify Google Sheets row displays:
    * **Status:** `REVIEW_RECOMMENDED`
    * **Status Color:** `#FBBC04`
    * **Low Confidence Fields:** `vendor.address (60%), due_date (55%)`

### Test Case 3: Missing Fields (Expected: `REVIEW_REQUIRED` / Red)
* **Goal:** Verify that an invoice missing a required field (e.g. invoice number) triggers an error status.
* **Setup:**
  1. Draft an invoice document that omits the label or value for "Invoice Number".
  2. Send the file and trigger execution.
  3. Claude extracts `"invoice_number": {"value": null, "confidence": 100}` (meaning it is sure the field is not present).
* **Verification:**
  * Confirm `validateFields` flags the missing required element: `item.json.flags` contains `"MISSING_INVOICE_NUMBER"`.
  * Confirm `determineStatus` evaluates this flag and assigns `"REVIEW_REQUIRED"` and color `"#EA4335"`.
  * Verify Google Sheets row displays:
    * **Status:** `REVIEW_REQUIRED`
    * **Status Color:** `#EA4335`
    * **Flags:** `MISSING_INVOICE_NUMBER`
