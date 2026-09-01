# Deployment

The coach panel is a static React application. It should be deployed as a container to **Cloud Run**, not Vertex AI. Vertex AI provides AI-model services and is not a secure frontend hosting platform.

## Required build variables

Create a production environment file in the deployment pipeline, never in Git:

```
VITE_SUPABASE_URL=https://uiytfdlssxbsempboldt.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<project publishable key>
```

Only the public project URL and publishable key belong in the web build. Do not expose a service role key.

## Cloud Run

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions _IMAGE=REGION-docker.pkg.dev/PROJECT/gymello/coach-panel:latest
gcloud run deploy gymello-coach-panel \
  --image REGION-docker.pkg.dev/PROJECT/gymello/coach-panel:latest \
  --region REGION --allow-unauthenticated --port 8080
```

Before go-live, add the Cloud Run URL to Supabase Auth redirect URLs and set the `APP_ORIGIN` Edge Function secret to the same origin.
