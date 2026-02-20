# Security Best Practices Report

## Executive Summary
Проведен целевой security-аудит `backend` (FastAPI) и `frontend` (Next.js).
Найдены уязвимости высокого и среднего приоритета в управлении секретами, защите от brute-force, безопасности websocket и обработке файлов.
Критичных RCE/SQLi в коде не обнаружено.

## High Severity

### FLC-SEC-001
- Rule ID: `FASTAPI-AUTH-004` / `FASTAPI-SESS-001`
- Severity: High
- Location: `backend/app/core/config.py:10`, `backend/app/core/config.py:11`
- Evidence:
  - `jwt_secret: str = "dev-jwt-secret-change-me"`
  - `csrf_secret: str = "dev-csrf-secret-change-me"`
- Impact: Если production запущен с дефолтами, атакующий может подделывать JWT/CSRF токены и обходить аутентификацию/защиту запросов.
- Fix:
  - Убрать небезопасные дефолты для `jwt_secret` и `csrf_secret`.
  - Сделать их обязательными через переменные окружения и fail-fast при отсутствии.
- Mitigation:
  - Ротация секретов перед любым production-релизом.
  - Отдельные секреты для каждого окружения.
- False positive notes: Если в runtime всегда подставляются безопасные значения из secret manager, риск снижен.

### FLC-SEC-002
- Rule ID: `FASTAPI-DOS-001` / `FASTAPI-AUTH-001`
- Severity: High
- Location: `backend/app/api/auth.py:265`
- Evidence:
  - Эндпоинт `@router.post("/login")` не содержит `_check_rate_limit(...)`, при том что в других auth-flow rate-limit есть (`/password/forgot`, `/verify-email/resend`).
- Impact: Возможен brute-force/credential stuffing по паролям и массовая проверка утекших учетных данных.
- Fix:
  - Добавить rate limit на `/auth/login` по IP + email (комбинированный ключ).
  - Ввести progressive delays/временную блокировку после N неудачных попыток.
- Mitigation:
  - WAF/edge rate limiting.
  - Мониторинг аномалий логина и алерты.
- False positive notes: Если ограничение уже делается на уровне reverse proxy/CDN, проверить и задокументировать.

## Medium Severity

### FLC-SEC-003
- Rule ID: `FASTAPI-AUTH-001`
- Severity: Medium
- Location: `backend/app/api/auth.py:551`, `backend/app/api/auth.py:556`, `backend/app/api/auth.py:561`
- Evidence:
  - Legacy endpoint `/auth/session` может вернуть сессию для произвольного `user_id`:
    - `if payload.user_id: ... existing = db.get(User, payload.user_id)`
    - `token=str(existing.id)`
  - Защищен только флагом `auth_allow_legacy_session`.
- Impact: При ошибочной активации флага это превращается в прямой IDOR/impersonation (захват аккаунта по известному `user_id`).
- Fix:
  - Удалить endpoint полностью или оставить только в тестовом профиле сборки.
  - Если временно нужен, требовать отдельный admin-only secret и жесткий allowlist окружений.
- Mitigation:
  - Явно проверить, что `AUTH_ALLOW_LEGACY_SESSION=false` во всех не-dev окружениях.
- False positive notes: При текущем дефолте (`False`) риск латентный, но высокий при misconfiguration.

### FLC-SEC-004
- Rule ID: `FASTAPI-UPLOAD-001` / `FASTAPI-FILES-001`
- Severity: Medium
- Location: `backend/app/api/profile.py:113`, `backend/app/api/profile.py:121`, `backend/app/main.py:33`
- Evidence:
  - Тип файла проверяется только по `UploadFile.content_type` (клиент-контролируемый).
  - Пользовательские файлы публикуются через `StaticFiles` (`/uploads`).
- Impact: Возможна загрузка некорректного/вредоносного содержимого под видом изображения; при цепочке ошибок конфигурации/сниффинга это повышает риск XSS/abuse.
- Fix:
  - Добавить серверную валидацию сигнатуры файла (magic bytes) и перекодирование изображений.
  - Отдавать пользовательские файлы с безопасными заголовками (`X-Content-Type-Options: nosniff`, при необходимости `Content-Disposition: attachment`).
- Mitigation:
  - Ограничение форматов до JPEG/PNG/WebP.
  - Антивирус/сканер для uploads.
- False positive notes: Если файлы всегда проксируются CDN с жестким `Content-Type` и `nosniff`, риск ниже.

### FLC-SEC-005
- Rule ID: `FASTAPI-WS-001`
- Severity: Medium
- Location: `backend/app/api/live.py:117`, `backend/app/api/live.py:164`
- Evidence:
  - WebSocket авторизуется cookie-токеном, но нет проверки `Origin` перед `websocket.accept()`.
- Impact: Риск Cross-Site WebSocket Hijacking в сценариях, где cookie все же отправляется (same-site/subdomain/proxy edge-cases).
- Fix:
  - Валидировать `Origin` по allowlist (`settings.frontend_url`) до `accept()`.
  - Логировать и блокировать невалидные origin.
- Mitigation:
  - Отдельный ws-token с коротким TTL.
- False positive notes: При строгой схеме cookie/SameSite и изоляции домена риск частично снижается, но проверка Origin все равно рекомендована.

## Low Severity

### FLC-SEC-006
- Rule ID: `FASTAPI-AUTH-002`
- Severity: Low
- Location: `backend/app/api/invites.py:34`, `backend/app/api/auth.py:259`, `backend/app/api/profile.py:207`, `frontend/app/auth/verify/page.tsx:10`, `frontend/app/auth/invite/page.tsx:10`, `frontend/app/auth/reset/page.tsx:17`
- Evidence:
  - Одноразовые токены передаются через query string (`?token=...`) и читаются из URL.
- Impact: Токены могут попадать в browser history, referrer, логи прокси/аналитики.
- Fix:
  - Перейти на одноразовые короткоживущие коды + POST-обмен.
  - Как минимум добавить `Referrer-Policy: no-referrer` или `strict-origin` и минимальный TTL.
- Mitigation:
  - Немедленная инвалидизация токена после первого использования (у вас уже реализовано для verify/reset).
- False positive notes: Для email-link flow это распространенная практика, но риск утечки остается.

### FLC-SEC-007
- Rule ID: `FASTAPI-DEPLOY-003` / `NEXT-CSP-001`
- Severity: Low
- Location: `backend/app/main.py:16`, `backend/app/main.py:26`, `frontend/next.config.ts:3`, `frontend/app/layout.tsx:23`
- Evidence:
  - В коде не видно настройки security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) и `TrustedHostMiddleware`.
- Impact: Увеличенная площадь атаки для XSS/clickjacking/host-header abuse при небезопасном edge-конфиге.
- Fix:
  - Добавить baseline security headers на backend/edge.
  - Добавить `TrustedHostMiddleware` с allowlist доменов.
- Mitigation:
  - Если это уже реализовано на reverse proxy/CDN, зафиксировать в deployment docs и IaC.
- False positive notes: Может быть закрыто инфраструктурой; в репозитории это не видно.
