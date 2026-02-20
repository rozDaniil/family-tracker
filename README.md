# Family Life Calendar MVP

Web-first MVP с философией "зеркало прожитого дня".

## Stack

- Frontend: Next.js, TypeScript, Tailwind, Zustand
- Backend: FastAPI, SQLAlchemy
- DB: PostgreSQL (в dev по умолчанию SQLite)

## Main Feature in This Iteration

- Отдельные календарные экраны-линзы (`/calendars`, `/calendars/[lensId]`) поверх одного родительского календаря.
- Линза хранит собственную конфигурацию: `view_type`, `range_preset`, фильтры категорий и участников.
- Поддержаны параллельные активные события (`Start/Stop`) без взаимной блокировки.

## Run Backend

```bash
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API base: `http://localhost:8000/api/v1`

## Run Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Frontend URL: `http://localhost:3000`

По умолчанию frontend ходит в `http://localhost:8000/api/v1`.
Можно переопределить через `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

## Google OAuth Setup

Backend `.env` must contain:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback
FRONTEND_URL=http://localhost:3000
```

Google Cloud Console checklist:

1. Open `APIs & Services -> OAuth consent screen`, configure app details and add scopes `openid`, `email`, `profile`.
2. If app is in testing mode, add your account to `Test users`.
3. Open `APIs & Services -> Credentials`, create `OAuth client ID` with type `Web application`.
4. Add Authorized redirect URI exactly:
   `http://localhost:8000/api/v1/auth/google/callback`

Frontend uses link-based start URL:
`http://localhost:8000/api/v1/auth/google/start`

## Resend Email Setup

Add to `backend/.env`:

```env
RESEND_API_KEY=your_resend_api_key
RESEND_SENDER_EMAIL=no-reply@yourdomain.com
RESEND_SENDER_NAME=Family Life
```

Resend is used for:
- invite emails (family calendar invitations)
- verification emails (`/auth/verify` link)

## Tests and Checks

```bash
cd backend
python -m pytest -q

cd ../frontend
pnpm lint
pnpm build
```
