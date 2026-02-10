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

## Tests and Checks

```bash
cd backend
python -m pytest -q

cd ../frontend
pnpm lint
pnpm build
```
