# 🛠️ Day 2 Operations & Maintenance Protocol

Once the AI Invoice Data Extractor is live in production, this protocol ensures long-term stability, performance monitoring, and safe update practices for your agency or internal team.

## 1. Routine Monitoring
To ensure the pipeline is running optimally without logging into the n8n server, rely on the automated Google Sheets telemetry:

- **Weekly Review:** Open the master Google Spreadsheet and navigate to the `Audit_Log` tab. Sort by `Processing Duration` to ensure the Anthropic API is responding within acceptable limits (typically < 10 seconds per invoice).
- **Error Triage:** Check the `Error_Log` tab. If you see repeated `API Connection Failed` or `Rate Limit Exceeded` messages, you may need to increase your Anthropic billing tier (Tier 2/3 recommended for high volume) or increase the `retryInterval` inside the n8n HTTP Request node.
- **Review Queue:** Check the main `Sheet1` for any rows colored **Red (REVIEW_REQUIRED)** or **Amber (REVIEW_RECOMMENDED)**. A human operator should verify the physical invoice against the extracted data.

## 2. Safe Updates & Prompt Tuning
As your vendors change or new invoice formats arise, you may wish to tweak the system prompt or upgrade the Claude model. 

- **Do Not Edit Production Directly:** Never modify the active workflow while it is toggled **Active**.
- **Model Upgrades:** Inside the `Prepare Claude Multimodal Payload` node, locate the `model:` parameter (currently `claude-3-5-sonnet-20241022`). When Anthropic releases a new version, update this string. Always test with 3-5 sample invoices before re-activating the workflow.
- **Prompt Adjustments:** The `systemPrompt` variable dictates extraction behavior. If you need to add a new field (e.g., `PO_Number`), you must add it to the JSON template in the prompt, AND add the corresponding column mapping in the `Google Sheets Append Row` node.

## 3. Backup Strategy
- **Workflow Backups:** Every time you modify the workflow, click the hamburger menu in n8n and select **Download**. Commit this `.json` file to your Git repository.
- **Data Backups:** n8n does not store the invoice data persistently (we intentionally purge it for privacy). Your Google Sheets act as the database. Rely on Google Workspace's built-in version history for the spreadsheets, and ensure the master Google Drive folder is protected from accidental deletion via IAM permissions.
