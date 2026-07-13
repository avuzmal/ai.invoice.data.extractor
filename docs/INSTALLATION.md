# 🚀 Zero-to-Hero: Installation & Deployment Guide

Welcome! This guide will walk you step-by-step through deploying the Enterprise AI Invoice Data Extractor. No prior cloud infrastructure experience is required, but please follow the steps precisely.

---

## 🛠️ Step 1: Prerequisites

Before beginning, ensure you have the following:
* **Server Environment:** A Linux VM (Ubuntu 22.04 LTS recommended) with **Docker** and **Docker Compose** installed.
* **n8n Version:** v1.0 or higher.
* **Anthropic Account:** An active [Anthropic Console](https://console.anthropic.com/) account with billing enabled to generate a Claude API key.
* **Google Account:** A Google Cloud (GCP) account, a Gmail inbox (for receiving invoices), and Google Drive/Sheets.

---

## ☁️ Step 2: Google Cloud Console Setup (OAuth 2.0)

To allow n8n to read emails, write to Google Sheets, and manage Google Drive folders, you must create a dedicated Google Cloud App.

### 2.1 Create a GCP Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. In the top-left dropdown, click **New Project**.
3. Name it `Invoice Extractor App` and click **Create**. Ensure this project is selected.

### 2.2 Enable Required APIs
1. In the search bar, type **APIs & Services** and select it.
2. Click **+ ENABLE APIS AND SERVICES**.
3. Search for and enable the following three APIs (one by one):
   * **Gmail API**
   * **Google Drive API**
   * **Google Sheets API**

### 2.3 Configure the OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**.
2. Select **Internal** (if you have Google Workspace) or **External** (if using a personal Gmail), then click **Create**.
3. Fill out the required fields:
   * **App Name:** `AI Invoice Extractor`
   * **User Support Email:** Your email.
   * **Developer Contact Information:** Your email.
4. Click **Save and Continue**.
5. On the **Scopes** page, you do not need to add scopes here (n8n will request them automatically). Click **Save and Continue**.
6. (If External) On the **Test Users** page, add the Gmail address you will use for the pipeline. Click **Save and Continue**.

### 2.4 Generate OAuth 2.0 Credentials
1. Go to **APIs & Services > Credentials**.
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
3. Select **Web application** as the Application type.
4. Name it `n8n Web Client`.
5. Under **Authorized redirect URIs**, click **+ ADD URI** and enter your n8n URL appended with the OAuth callback path. 
   * *Example:* `https://n8n.yourdomain.com/rest/oauth2-credential/callback`
   * *(If testing locally on your PC, use `http://localhost:5678/rest/oauth2-credential/callback`)*
6. Click **Create**.
7. **Crucial:** A modal will appear with your **Client ID** and **Client Secret**. Copy these to a secure notepad; you will need them in Step 4.

---

## 🐳 Step 3: n8n Environment Setup

We strongly recommend deploying n8n via Docker to isolate dependencies.

1. SSH into your server and create a directory:
   ```bash
   mkdir n8n-invoice-extractor && cd n8n-invoice-extractor
   ```

2. Create a `docker-compose.yml` file:
   ```bash
   nano docker-compose.yml
   ```

3. Paste the following configuration (replace `<YOUR_ENCRYPTION_KEY>` with a long, random string, and `<YOUR_DOMAIN>` with your URL):
   ```yaml
   version: '3.8'

   services:
     n8n:
       image: docker.n8n.io/n8nio/n8n
       restart: always
       ports:
         - "5678:5678"
       environment:
         - N8N_HOST=<YOUR_DOMAIN>
         - N8N_PORT=5678
         - N8N_PROTOCOL=https
         - NODE_ENV=production
         - WEBHOOK_URL=https://<YOUR_DOMAIN>/
         - N8N_ENCRYPTION_KEY=<YOUR_ENCRYPTION_KEY>
         - EXECUTIONS_DATA_SAVE_ON_SUCCESS=none
         - EXECUTIONS_DATA_MAX_AGE=168
       volumes:
         - n8n_data:/home/node/.n8n

   volumes:
     n8n_data:
   ```

4. Save the file and start the container in the background:
   ```bash
   docker-compose up -d
   ```

---

## 🔐 Step 4: Credential Configuration in n8n

1. Navigate to your n8n instance (e.g., `https://n8n.yourdomain.com`).
2. Create an admin account and log in.
3. On the left sidebar, click **Credentials** > **Add Credential**.

### 4.1 Add Anthropic API Key
1. Search for **Header Auth** (or Claude, depending on your n8n version) and select it.
2. Name it `Claude API Key`.
3. Set the Name to `x-api-key`.
4. Set the Value to your Anthropic API key. Save it.

### 4.2 Add Google OAuth2 Credentials
1. Click **Add Credential** > search for **Google Sheets OAuth2 API**.
2. Copy the **Client ID** and **Client Secret** you generated in Step 2.
3. Click **Sign in with Google** and authorize the connection using your designated Gmail account.
4. Repeat this process for **Google Drive OAuth2 API** and **Gmail OAuth2 API** using the exact same Client ID and Secret.

---

## ⚡ Step 5: Workflow Import & Activation

1. Download the `workflows/workflow.json` file from this repository.
2. In n8n, go to **Workflows** > **Add Workflow**.
3. Click the three dots (`...`) in the top right > **Import from File**, and select the JSON file.
4. **Map Credentials:** Double-click any node with a warning icon (⚠️) and assign the credentials you created in Step 4.
5. **Configure IDs:**
   * Double-click the **Google Sheets** nodes. Replace `YOUR_SPREADSHEET_ID_HERE` with the ID from your Google Sheets URL.
   * Double-click the **Google Drive** folder search/creation nodes and ensure they point to your desired root folder.
6. Toggle the workflow to **Active** in the top right corner.

**🎉 Congratulations! Your Enterprise AI Invoice Data Extractor is now live.** Send a test invoice to your Gmail inbox to watch the magic happen!
