# Feedback sink — Google Apps Script → Google Sheet

This gives the **deployed** app a public endpoint so a user (e.g. Katie) can
submit in-app comments fluidly, with no file to download and hand off. Each
batch lands as a row in a Google Sheet you own. Free, no server to keep running,
no secret tokens in the browser bundle.

The local dev inbox (`vite dev` → `feedback/incoming/`) and the download
fallback (offline) are unchanged; this only adds the deployed path.

## One-time setup (~5 minutes)

1. Create a new Google Sheet in your account. Name it e.g. `Genre App Feedback`.
2. In that sheet: **Extensions → Apps Script**. Delete the starter code, paste
   the contents of [`Code.gs`](./Code.gs), and **Save**.
3. **Deploy → New deployment**. Gear icon → **Web app**. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** **Anyone**
   Click **Deploy**, authorize when prompted, and copy the **Web app URL**
   (it looks like `https://script.google.com/macros/s/AKfyc.../exec`).
4. Sanity check: open that URL in a browser. You should see
   `Genre feedback endpoint is live.`
5. Give the app the URL at build time. Either:
   - **Deployed (GitHub Pages):** in the repo, **Settings → Secrets and
     variables → Actions → Variables**, add a variable named
     `VITE_FEEDBACK_URL` with the web-app URL as its value, then re-run the
     deploy (push to `main` or run the workflow manually). Or
   - **Local test of the deployed path:** `VITE_FEEDBACK_URL=<url> npm run build && npm run preview`.

That's it. New comments append as rows: `Received | Filename | Comment (markdown)`.

## Updating the script later

If you edit `Code.gs`, redeploy: **Deploy → Manage deployments → (edit, pencil)
→ Version: New version → Deploy**. The URL stays the same, so no rebuild is
needed. (A brand-new deployment mints a *new* URL and would need the variable
updated.)

## Notes

- The app posts JSON as `text/plain` with `mode: 'no-cors'`. That avoids a CORS
  preflight (Apps Script doesn't send CORS headers), so the browser can't read
  the response — the app treats a delivered request as success. A real network
  failure (offline) still triggers the download fallback, so a comment is never
  silently lost.
- The full structured record (route, location, importance, highlighted text) is
  inside each row's markdown, including a fenced `genre.feedback-batch/v1` JSON
  block, so nothing is dropped by flattening to one cell.
