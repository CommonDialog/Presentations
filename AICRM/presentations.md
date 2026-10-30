# Google API Keys Setup Steps

1. **Create Gemini Key (`GEMINI_API_KEY`)**:
   - Go to `https://aistudio.google.com/apikey` and create a key.
   - At `https://ai.studio/projects`, make sure billing is on **Pay-as-you-go** (or has Prepay funds) — setting a `$10` spend cap alone still fails with `402` if Prepay balance is `$0`.

2. **Why You Need a Second Key for Google Places**:
   - AI Studio keys (`AQ...`) are bound to a service account and locked by Google to **only** allow `Gemini API` and `Agent Platform (Vertex) API`.
   - You cannot add `Places API (New)` to an AI Studio service-account-bound key.

3. **Enable `Places API (New)` First**:
   - In Google Cloud Console -> **APIs & Services -> Library**, search **`Places API (New)`** and click **Enable**.
   - *(APIs do not appear in the key restrictions dropdown until they are enabled on the project.)*

4. **Create Places Key (`GOOGLE_PLACES_NEW_API`)**:
   - Go to **APIs & Services -> Credentials -> + Create Credentials -> API key**.
   - Under **API restrictions**, select **`Places API (New)`** and click **Create**.
   - Put both keys in `.env` (`GEMINI_API_KEY` and `GOOGLE_PLACES_NEW_API`).
