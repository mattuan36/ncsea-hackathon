# Deploying the API on Render (with Supabase)

GitHub Pages serves only the website. The API (documents, IFC extraction, materials) runs on
Render. IFC files live in Supabase Storage and everything else in Supabase Postgres, so the
Render service keeps nothing on disk and can be redeployed freely.

## 1. Supabase
1. Create a project.
2. **Connect** → copy the **Session pooler** connection string (port 5432). Put your password in
   it and add `?sslmode=require`. This is `DATABASE_URL`.
3. **Project Settings → API**: copy the project URL (`SUPABASE_URL`) and the `service_role` key
   (`SUPABASE_SERVICE_KEY`). The service key is a secret: Render only, never the frontend, never git.
4. No bucket step: the API creates a private bucket named `ifc-models` on first start.
   Supabase's free plan caps a single upload (50 MB, as far as I know); large Revit exports need a
   paid plan or a raised limit under **Storage → Settings**.

## 2. Render
1. **New → Blueprint**, pick this repo. `render.yaml` defines the web service.
2. Fill in `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` when prompted.
3. After the first deploy, open `https://<service>.onrender.com/api/health`. It should return `{"ok":true}`.

IFC extraction is memory hungry. If jobs end as "Interrupted" or the service restarts during
extraction, move the service to a larger plan.

## 3. GitHub
**Settings → Secrets and variables → Actions → Variables**: set `API_BASE` to the Render URL
(no trailing slash), then re-run **Deploy GitHub Pages**. Settings → Pages must use **GitHub Actions**.

## 4. Load the materials once
Matching needs the Dead Load spreadsheet. The host has no disk to leave it on, so upload it once:

```bash
curl -F "file=@Dead_Load.xlsx" https://<service>.onrender.com/api/materials/import-file
```

The rows are stored in Postgres and survive redeploys.

## Notes
- The API has no login: anyone with the URL can upload and delete. Fine for a hackathon; add auth before real use.
- Local development is unchanged. Leave `SUPABASE_*` empty and files stay on disk.
- `fly.toml` and the "Deploy site API" workflow are the older Fly route and are not used here.
