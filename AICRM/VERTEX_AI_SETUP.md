# Vertex AI Setup & Pre-Deployment Pipeline Guide (`AICRM`)

This project is configured with a **Vertex AI Pre-Deployment Pipeline** that performs:
1. **Automated AI Code Review** (`npm run ai:review`) — Audits `server/` and `client/` code against `SPEC.md` for security flaws, data-integrity bugs, and spec compliance, generating `reports/code-review.md` and blocking deployment if any `CRITICAL` issues are found.
2. **Automated Test Generation** (`npm run ai:generate-tests`) — Inspects the Express API and generates edge-case integration tests in `server/tests/vertex-generated.test.ts`.
3. **Automated Test Execution & Build** (`npm run predeploy`) — Runs the complete gate (`ai:review` -> `ai:generate-tests` -> `npm test` -> `npm run build`).

---

## 1. Local Setup with Google Cloud Vertex AI (Two Easy Options)

### Option A: Vertex AI API Key (Fastest — No CLI Installation Required)
1. Go to [Google Cloud Console — Vertex AI Studio](https://console.cloud.google.com/vertex-ai).
2. Click **Get API key** (or go to **Vertex AI Studio $\rightarrow$ Settings $\rightarrow$ API Keys**) and create a Vertex AI API key.
3. Open [`.env`](file:///c:/Dev/AICRM/.env) and paste it into:
   ```env
   USE_VERTEX_AI=true
   VERTEX_API_KEY=your_vertex_api_key_here
   ```

### Option B: Google Cloud Project + Service Account / `gcloud` CLI
1. In the [Google Cloud Console](https://console.cloud.google.com/vertex-ai), enable the Vertex AI API and copy your **Project ID** (e.g. `my-aicrm-prod`).
2. Authenticate using either:
   - **Service Account JSON file**: Create a Service Account with the `Vertex AI User` role, download its JSON key, and set `GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json` in `.env`, **OR**
   - **Google Cloud CLI**: Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth application-default login`.
3. Set your Project ID in [`.env`](file:///c:/Dev/AICRM/.env):
   ```env
   USE_VERTEX_AI=true
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   GOOGLE_CLOUD_LOCATION=us-central1
   ```

---

## 2. Running the Pre-Deploy Pipeline Commands

From `c:\Dev\AICRM`:

| Command | Description |
| :--- | :--- |
| `npm run ai:review` | Runs Vertex AI Code Review on `server/src` & `client/src`, outputs terminal summary + `reports/code-review.md` |
| `npm run ai:generate-tests` | Uses Vertex AI to generate Vitest + Supertest edge-case tests in `server/tests/vertex-generated.test.ts` |
| `npm test` | Runs all baseline and AI-generated tests in `server/tests/` |
| `npm run predeploy` | Runs the complete gate: **Review $\rightarrow$ Generate Tests $\rightarrow$ Run Tests $\rightarrow$ Build** |

---

## 3. GitHub Actions CI/CD Setup (`.github/workflows/vertex-predeploy.yml`)

To run this pipeline automatically on every Push or Pull Request in GitHub:
1. In Google Cloud Console $\rightarrow$ **IAM & Admin** $\rightarrow$ **Service Accounts**, create a service account with the **Vertex AI User** (`roles/aiplatform.user`) role and download a JSON key.
2. In your GitHub repository $\rightarrow$ **Settings** $\rightarrow$ **Secrets and variables** $\rightarrow$ **Actions**, add:
   - `GOOGLE_CLOUD_PROJECT`: Your GCP Project ID
   - `GCP_CREDENTIALS_JSON`: The contents of the Service Account JSON key
