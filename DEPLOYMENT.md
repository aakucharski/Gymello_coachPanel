# Deploy Gymello Coach Panel on Vercel

## 1. Import project

1. Open Vercel and import the GitHub repository aakucharski/Gymello_coachPanel.
2. Select the production branch after review and merge.
3. Vercel detects Vite automatically.

## 2. Build settings

- Framework Preset: Vite
- Build Command: npm run build
- Output Directory: dist
- Install Command: npm install

## 3. Environment variables

Set these for Preview and Production:

    VITE_SUPABASE_URL=https://<project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>

Never add the Supabase service_role key to Vercel. Browser code must use only the publishable key.

## 4. Supabase configuration

After the first Vercel deployment, add the generated panel URL and final custom domain to:

- Supabase Auth Redirect URLs
- Supabase Auth Site URL when it becomes the primary panel domain
- the APP_ORIGIN secret used by the invitation Edge Function

## 5. Smoke test

1. Sign in as master_admin.
2. Invite a coach.
3. Sign in as coach and invite a client.
4. Publish a client plan.
5. Confirm the notifications and coach chat work.

Vercel hosts the React panel. Supabase provides Auth, the database, Realtime, Edge Functions and the payment-alert scheduler.
