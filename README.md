# 📑 AI Invoice Data Extractor System (Phase 05 Final Production Release)

[![n8n v1.0+](https://img.shields.io/badge/n8n-v1.0%2B-FF6F61?style=for-the-badge&logo=n8n)](https://n8n.io)
[![Claude 3.5 Sonnet](https://img.shields.io/badge/Model-Claude%203.5%20Sonnet-CD7F32?style=for-the-badge&logo=anthropic)](https://anthropic.com)
[![Google Sheets](https://img.shields.io/badge/Sheets-Enterprise-34A853?style=for-the-badge&logo=google-sheets)](https://google.com/sheets)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

An enterprise-grade, fault-tolerant, and intelligent document processing and auditing system built in **n8n**. It automates the ingestion, extraction, deterministic auditing, compliance classification, duplicate prevention, and archiving of invoice files.

---

## 🚀 Key Features

* ✅ **Multimodal Ingestion:** Handles clean text-based PDFs, scanned (image-based) PDFs via Page-1 300 DPI conversion, and direct JPEG/PNG files.
* ✅ **Claude 3.5 Sonnet Integration:** Performs dynamic data extraction with custom multimodal templates and 3-retry exponential backoff protection.
* ✅ **Deterministic Auditing:** Deep-compares line item sums vs. subtotals, and calculates expected grand totals with math discrepancy assertions.
* ✅ **Automatic Compliance States:** Classifies invoices into `AUTO_APPROVED` (Green), `REVIEW_RECOMMENDED` (Amber), and `REVIEW_REQUIRED` (Red) based on audit flags and confidence scoring.
* ✅ **Deterministic Duplicate Prevention:** Searches Google Sheets and auto-diverts double-submittals to a Google Drive `/Duplicates/` folder while keeping the original spreadsheet clean.
* ✅ **Automated File Archiving:** Dynamically generates monthly folders (`/Invoices/Processed/YYYY-MM/`) and uploads Gmail attachments or moves existing Drive files seamlessly.
* ✅ **Dead-Letter Audit Logging:** Maintains high-fidelity `Audit_Log` and `Error_Log` tabs with execution durations, token usages, and priority admin notifications.

---

## 📊 Pipeline Architecture (Mermaid.js Flowchart)

```mermaid
flowchart TD
    %% Styling definitions
    classDef layerTrigger fill:#ECE2FF,stroke:#9370DB,stroke-width:2px;
    classDef layerIngest fill:#E1F5FE,stroke:#0288D1,stroke-width:2px;
    classDef layerAI fill:#FFF3E0,stroke:#F57C00,stroke-width:2px;
    classDef layerAudit fill:#E8F5E9,stroke:#388E3C,stroke-width:2px;
    classDef layerOutput fill:#FFEBEE,stroke:#D32F2F,stroke-width:2px;

    %% 1. TRIGGER LAYER
    subgraph Trigger_Layer [1. Trigger Layer]
        A[Gmail Attachment Trigger]
        B[Google Drive File Trigger]
    end
    class Trigger_Layer layerTrigger;

    %% 2. INGESTION LAYER
    subgraph Ingestion_Layer [2. Ingestion & Routing Layer]
        C[detectFileType Node]
        D{Switch Routing}
        E[Extract PDF Text]
        F{Text Length > 50?}
        G[Convert PDF to Image]
        H[binaryToBase64]
    end
    class Ingestion_Layer layerIngest;

    %% 3. AI PROCESSING LAYER
    subgraph AI_Layer [3. AI Processing Layer]
        I[Prepare Claude Payload]
        J[Claude 3.5 Sonnet API Call]
        K[Parse Claude Response]
    end
    class AI_Layer layerAI;

    %% 4. VALIDATION & COMPLIANCE LAYER
    subgraph Validation_Layer [4. Validation Layer]
        L[validateMath Node]
        M[validateFields Node]
        N[classifyConfidence Node]
        O[determineStatus Node]
        P{Is Duplicate?}
    end
    class Validation_Layer layerAudit;

    %% 5. OUTPUT & FILE ARCHIVING LAYER
    subgraph Output_Layer [5. Output & Archiving Layer]
        Q[Google Sheets Append Row]
        R{IF Auto-Approved}
        S[Success Notification]
        T[Review Notification]
        U[Search/Create Processed Folder]
        V[Upload / Move Processed File]
        W[Audit Log Append]
        X[Duplicate Alert Email]
        Y[Upload / Move Duplicate File]
    end
    class Output_Layer layerOutput;

    %% Connection Mappings
    A --> C
    B --> C
    C --> D

    D -- "fileType: pdf" --> E
    D -- "fileType: jpeg/png" --> H
    D -- "fileType: unknown" --> M

    E --> F
    F -- "YES" --> I
    F -- "NO" --> G
    G --> H
    H --> I

    I --> J
    J --> K
    K --> L
    L --> M
    M --> N
    N --> O
    O --> P

    P -- "NO" --> Q
    P -- "YES" --> X
    X --> Y

    Q --> R
    Q --> U
    R -- "TRUE" --> S
    R -- "FALSE" --> T

    U --> V
    V --> W

    class A,B layerTrigger;
    class C,D,E,F,G,H layerIngest;
    class I,J,K layerAI;
    class L,M,N,O,P layerAudit;
    class Q,R,S,T,U,V,W,X,Y layerOutput;
```

---

## 📂 Project Directory Structure

```text
/ai.invoice.data.extractor
│
├── /workflows
│   └── workflow.json          # Main importable 26-node n8n Phase 05 JSON
│
├── /scripts
│   └── sheets_trigger.gs      # Google Apps Script conditional formatting trigger
│
├── /docs
│   ├── PHASE_01_GUIDE.md      # Phase 01: Gmail text-based extraction guide
│   ├── PHASE_02_GUIDE.md      # Phase 02: Multimodal vision & routing guide
│   ├── PHASE_03_GUIDE.md      # Phase 03: Validation and audit logic guide
│   └── PHASE_04_GUIDE.md      # Phase 04: Google Sheets & archiving guide
│
├── README.md                  # Main premium project summary and presentation
├── PHASE_05_GUIDE.md          # Technical setup and duplicate testing protocols
└── LICENSE                    # MIT open-source license
```

---

## 🎨 Professional Google Sheets Cell Formatting

New sheet rows are automatically color-coded with bolded compliance metrics to make the sheet highly professional and easy to parse:

* **Column P (Status):**
  * `AUTO_APPROVED` turns solid green (**#34A853**) with white text.
  * `REVIEW_RECOMMENDED` turns solid amber (**#FBBC04**) with black text.
  * `REVIEW_REQUIRED` turns solid red (**#EA4335**) with white text.
* **Column R (Avg Confidence):**
  * `>= 85%` turns bold green text.
  * `65%` to `84%` turns bold amber text.
  * `< 65%` turns bold red text.
* **Column S (Low Confidence Fields):**
  * If fields are present, background highlights light red (**#F4CCCC**).

---

## 🛠️ Installation & Setup Guide

### 1. n8n Import
1. Download `/workflows/workflow.json` from this repository.
2. In your n8n cloud or self-hosted workspace, click **Add Workflow** > **Import from File** (or copy JSON and paste directly onto the editor canvas).
3. Bind your credentials to the Google Sheets, Gmail, and Header Auth (Claude API Key) nodes.

### 2. Google Sheets Setup
1. Create a Google Spreadsheet.
2. Setup three sheets named:
   * **`Sheet1`:** Main metadata ledger with column headers `Timestamp` to `Flags` (Columns A to U).
   * **`Audit_Log`:** Performance and token tracker (`Timestamp`, `Filename`, `Final Status`, `Processing Duration`, `Tokens Used`).
   * **`Error_Log`:** Error ledger (`Timestamp`, `Source File`, `Error Stage`, `Error Message`).
3. Bind the Google Apps Script (`/scripts/sheets_trigger.gs`) inside **Extensions** > **Apps Script** as an installable **On Change** trigger as described in `/docs/PHASE_04_GUIDE.md`.

---

## 📹 Visual Demo (Placeholders)

### n8n Active Pipeline Canvas
![n8n Workflow](https://via.placeholder.com/1000x450.png?text=n8n+Active+Pipeline+Canvas+-+15+Audit+Nodes)

### Automatically Formatted Google Sheets Ledger
![Google Sheet](https://via.placeholder.com/1000x250.png?text=Color-Coded+Google+Sheets+Invoice+Ledger)

### Stakeholder Review Required Alert Email
![Review Required Alert](https://via.placeholder.com/600x350.png?text=Gmail+Stakeholder+Review+Required+Alert+Email)

---

## 📜 License
Licensed under the [MIT License](LICENSE).
