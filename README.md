# 📑 OmniExtract: Enterprise AI Invoice Data Extractor

<div align="center">
  <img src="https://via.placeholder.com/800x200/09090b/ffffff?text=OMNI+EXTRACT+HERO+GRAPHIC" alt="OmniExtract Hero Banner">
</div>

<div align="center">
  
[![n8n v1.0+](https://img.shields.io/badge/n8n-v1.0%2B-FF6F61?style=for-the-badge&logo=n8n)](https://n8n.io)
[![Claude 3.5 Sonnet](https://img.shields.io/badge/Model-Claude%203.5%20Sonnet-CD7F32?style=for-the-badge&logo=anthropic)](https://anthropic.com)
[![Google Sheets](https://img.shields.io/badge/Sheets-Enterprise-34A853?style=for-the-badge&logo=google-sheets)](https://google.com/sheets)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

**Intelligent. Resilient. Fully Automated.**

</div>

An enterprise-grade, fault-tolerant document processing and auditing system built in **n8n**. OmniExtract automates the ingestion, extraction, deterministic auditing, compliance classification, duplicate prevention, and archiving of complex invoice files at scale.

---

## 📚 Documentation & Guides

Whether you are a developer deploying the system or an operator maintaining it, everything you need is documented:

* 🚀 **[Zero-to-Hero Installation Guide](docs/INSTALLATION.md)** - Step-by-step GCP setup and n8n Docker deployment.
* 🛡️ **[Enterprise Security Audit](docs/ENTERPRISE_AUDIT.md)** - Learn how this architecture scales securely.
* 🛠️ **[Day 2 Maintenance Protocol](docs/MAINTENANCE.md)** - Monitoring, backup, and safe update strategies.

---

## 🌟 Key Capabilities

* ✅ **Multimodal Ingestion:** Dynamically processes clean text-based PDFs, scanned image-based PDFs, and direct JPEGs/PNGs.
* ✅ **Claude 3.5 Sonnet Engine:** Extracts complex nested tables and metadata with custom multimodal prompting and 3-retry exponential backoff protection.
* ✅ **Deterministic Auditing:** Performs strict mathematical assertion checks on line items vs. subtotals.
* ✅ **Compliance Triage:** Classifies invoices dynamically into `AUTO_APPROVED` 🟢, `REVIEW_RECOMMENDED` 🟡, and `REVIEW_REQUIRED` 🔴.
* ✅ **Zero-Duplicate Architecture:** Auto-diverts duplicate submittals to quarantine folders while keeping the master Google Sheet pristine.
* ✅ **Dead-Letter Telemetry:** Logs granular processing durations and Claude token usage to dedicated audit tracking sheets.

---

## 📊 Enterprise Pipeline Architecture

The following diagram illustrates the 5 distinct operational layers within the n8n pipeline.

```mermaid
flowchart TD
    %% Styling definitions
    classDef layerTrigger fill:#f3e8ff,stroke:#9333ea,stroke-width:2px,color:#000;
    classDef layerIngest fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#000;
    classDef layerAI fill:#ffedd5,stroke:#ea580c,stroke-width:2px,color:#000;
    classDef layerAudit fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#000;
    classDef layerOutput fill:#ffe4e6,stroke:#e11d48,stroke-width:2px,color:#000;

    %% 1. TRIGGER LAYER
    subgraph Trigger_Layer [1. Trigger Layer]
        A[Gmail Attachment Trigger]
        B[Google Drive File Trigger]
    end
    class Trigger_Layer,A,B layerTrigger;

    %% 2. INGESTION LAYER
    subgraph Ingestion_Layer [2. Ingestion & Routing Layer]
        C[Detect File Type]
        D{Format Switch}
        E[Extract PDF Text]
        F{Length > 50 chars?}
        G[Convert PDF to JPEG]
        H[Binary to Base64]
    end
    class Ingestion_Layer,C,D,E,F,G,H layerIngest;

    %% 3. AI PROCESSING LAYER
    subgraph AI_Layer [3. AI Processing Layer]
        I[Prepare Claude Payload & Truncate]
        J[Claude 3.5 Sonnet Vision API]
        K[Parse JSON Response]
    end
    class AI_Layer,I,J,K layerAI;

    %% 4. VALIDATION & COMPLIANCE LAYER
    subgraph Validation_Layer [4. Validation Layer]
        L[Validate Math & Line Items]
        M[Validate Required Fields & Credit Notes]
        N[Determine Status Color Code]
        O{Is Duplicate?}
    end
    class Validation_Layer,L,M,N,O layerAudit;

    %% 5. OUTPUT & FILE ARCHIVING LAYER
    subgraph Output_Layer [5. Output & Archiving Layer]
        P[Google Sheets Append]
        Q{Status Check}
        R[Send Slack/Email Alert]
        S[Archive Processed File]
        T[Append to Audit_Log / Error_Log]
        U[Quarantine Duplicate File]
    end
    class Output_Layer,P,Q,R,S,T,U layerOutput;

    %% Routing logic
    A & B --> C --> D
    
    D -- "PDF" --> E --> F
    F -- "Text Heavy" --> I
    F -- "Scanned" --> G --> H --> I
    D -- "Image" --> H
    
    I --> J --> K
    
    K --> L --> M --> N --> O
    
    O -- "NO" --> P
    O -- "YES" --> U
    
    P --> Q
    Q -- "Review Needed" --> R
    
    P --> S --> T
```

---

## 📸 Visual Demo Assets (Strategy)

To make this repository visually compelling for stakeholders, place the following screenshots in the `/assets/` directory (these are currently placeholders to be updated by the developer):

1. **`assets/01-n8n-canvas.png` (The Brain):** A wide, zoomed-out shot of the beautiful 26-node n8n canvas demonstrating the scale and visual branching of the logic.
2. **`assets/02-google-sheets-dashboard.png` (The Output):** A close-up of the `Sheet1` ledger. Showcase the conditional formatting—rows glowing Green (Auto-Approved) alongside Red (Review Required) rows to prove the triage works.
3. **`assets/03-claude-multimodal.png` (The Intelligence):** A split-screen shot. On the left, a blurry/scanned PDF invoice. On the right, the perfectly structured JSON output generated by Claude 3.5 Sonnet.
4. **`assets/04-duplicate-quarantine.png` (The Safety Net):** An email screenshot of the high-priority "Duplicate Alert" showing that the system successfully caught and blocked a double-submittal.

> **Note to Junior Dev:** Take these 4 screenshots on your local deployment and update the image tags below!

### Platform Previews
![n8n Canvas](assets/01-n8n-canvas.png)

---

## 📜 License
Licensed under the [MIT License](LICENSE).
