# 🛡️ Enterprise-Level Audit & Hardening Checklist

As the AI Invoice Data Extractor transitions to production, the following enterprise-grade hardening measures must be validated to ensure security, scalability, and data privacy.

## 1. Security & Identity Management
- [x] **Principle of Least Privilege (Google OAuth):** Ensure the Google Drive OAuth scopes are restricted to `https://www.googleapis.com/auth/drive.file` (only files created/opened by the app) rather than the global `drive` scope. For Gmail, use `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.modify` (if archiving).
- [x] **API Key Rotation Policy:** The Anthropic (`claudeApiKey`) and n8n webhook secrets should be rotated every 90 days. Store credentials strictly within n8n's encrypted vault (`N8N_ENCRYPTION_KEY` must be backed up securely), never hardcoded in nodes.
- [x] **Network Isolation:** Deploy the n8n instance within a private VPC (Virtual Private Cloud). Expose only the required webhook endpoints via a reverse proxy (e.g., NGINX/Traefik) secured with TLS 1.3 and a Web Application Firewall (WAF).
- [x] **Service Accounts:** If utilizing Google Cloud Service Accounts instead of OAuth, restrict the service account to specific IP addresses and bind it strictly to the target Google Sheet and Drive folders.

## 2. Scalability & Queue Management
- [x] **High-Volume Throttling:** If 500 invoices are dropped simultaneously, n8n's default synchronous execution can cause CPU spikes and memory exhaustion. 
  - **Action:** Configure n8n for **Queue Mode** using Redis (`EXECUTIONS_MODE=queue`). This distributes the workload across multiple worker nodes.
- [x] **Concurrency Limits:** Set `WEBHOOK_TUNNEL_URL` and enable `EXECUTIONS_TIMEOUT_MAX` (e.g., 3600 seconds) to kill hanging executions. Limit parallel executions per workflow in n8n settings to prevent hitting Anthropic API rate limits (e.g., max 5 concurrent requests).
- [x] **API Rate Limit Handling:** The workflow currently implements exponential backoff (3 retries starting at 5s). Ensure the Anthropic account tier supports the expected Token Per Minute (TPM) limit during peak batch processing.

## 3. Data Privacy & Compliance
- [x] **Execution Data Purging:** Invoices contain PII and sensitive financial data. Configure n8n to aggressively prune execution logs. Set `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` and `EXECUTIONS_DATA_MAX_AGE=168` (7 days) for failed executions.
- [x] **Data Masking (If Logging Required):** If payload logging is mandatory for compliance, ensure n8n is configured to *not* save binary files (PDFs/Images) to the execution database (`N8N_DEFAULT_BINARY_DATA_MODE=filesystem` and aggressively clear the temp folder).
- [x] **GDPR / CCPA:** Ensure the target Google Sheets and Drive folders reside in geographic regions compliant with corporate data residency requirements (e.g., EU data centers).
