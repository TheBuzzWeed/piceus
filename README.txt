PICEUS Website

This workspace now uses a Vite + React frontend at the root and a FastAPI backend under api/ for Vercel deployment.

Project target

- Intended Vercel scope: buzz-corp
- Intended Vercel project: piceus
- Intended production domains: www.piceus.com and piceus.com
- Repo-side placeholders for Vercel linking live in vercel.project.example.json. The real Vercel link file should remain local at .vercel/project.json and is intentionally gitignored.

Setup

1. Copy .env.example to .env and update the MATRIX and contact settings.
2. Install frontend dependencies with npm install.
3. Install backend dependencies with python3 -m pip install -r requirements.txt.

Local development

1. Start the API: uvicorn api.index:app --reload --port 8000
2. Start the frontend: npm run dev

Deployment

- Frontend builds to dist/ with Vite.
- Vercel serves the React app and routes /api/* to api/index.py.
- This repo is intended to become the source of truth for the BuzzCorp www.piceus.com project.
- The current Vercel CLI on this machine is logged into the wrong account, so project linking should be done only after switching to the correct buzz-corp scope.

Safe Vercel attach flow

1. Verify the current CLI identity before linking: vercel whoami
2. If it is not BuzzCorp, log out and switch accounts before doing anything else.
3. After switching, confirm the correct team scope: vercel switch buzz-corp
4. Link this repo to the existing PICEUS project: vercel link --scope buzz-corp --project piceus
5. Pull the real project metadata into .vercel/project.json locally.
6. In Vercel, verify that the project owns both www.piceus.com and piceus.com before any deploy.
7. Only after the domain check passes, deploy from this repo.

Live MATRIX integration

- The frontend now uses the same access_token and refresh_token storage keys found in the live MATRIX shell.
- FastAPI proxies the current upstream MATRIX auth and widget endpoints from PICEUS_MATRIX_API_URL so the homepage can resolve real session state and live content.
- The homepage becomes the PICEUS authenticated landing experience when a live MATRIX session is present.

Notes

- The original static design has been ported into the React app as the new PICEUS homepage experience.
- app.js remains in the repo as legacy reference while the React app takes over runtime behavior.
- Existing live auth routes observed in the deployed bundle include /login, /register, /forgot-password, /api/auth/me, /api/auth/login, /api/auth/refresh, /api/auth/logout, and widget endpoints for metrics, status, alerts, and logs.
