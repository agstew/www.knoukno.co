# Kno U Kno auth starter

A Node.js/Express starter with PostgreSQL-backed accounts, JWT authentication in secure HTTP-only cookies, email verification and password reset through Resend, one-time PayPal checkout, and Railway/Docker deployment configuration.

## Local setup

Requirements: Node.js 22+, npm, and Docker Compose (or a local PostgreSQL 14+ instance).

```sh
cp .env.example .env
```

Set a fresh `JWT_SECRET` of at least 32 characters in `.env`. For email verification and password-reset links, add a Resend API key and a sender address verified by Resend. Configure the tier catalog and PayPal credentials to enable checkout.

Start the app and PostgreSQL with Docker Compose:

```sh
docker compose up --build
```

Or, if PostgreSQL is already running:

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. The app applies the idempotent schema in `db/schema.sql` at startup. `npm test` runs the API tests without an external database; `npm run check` checks JavaScript syntax.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | Set to `true` to require verified TLS |
| `JWT_SECRET` | HS256 signing secret, at least 32 characters |
| `PUBLIC_APP_URL` | Base URL used to create email links |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Verification and password-reset email |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal REST credentials |
| `PAYPAL_ENV` | `sandbox` or `production` |
| `PAYPAL_CURRENCY` | Three-letter currency shared by the tier catalog |
| `PAYPAL_TIERS` | JSON array of tier IDs, names, descriptions, amounts, and included features |

Never commit `.env` or production credentials. Use sandbox credentials and a non-production PayPal account while testing checkout.

## Auth and payment flow

- `POST /api/auth/register` creates an unverified account and emails a one-time verification link.
- `POST /api/auth/verify-email` verifies that link; `POST /api/auth/resend-verification` can issue another.
- `POST /api/auth/login` issues a 15-minute JWT in an HTTP-only, `SameSite=Lax` cookie. Accounts must be verified first.
- `GET /api/auth/me` returns the authenticated profile.
- `POST /api/auth/logout` increments the account token version and clears the cookie, invalidating the current token.
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` handle one-time password-reset links.
- `GET /api/paypal/config`, `POST /api/paypal/orders`, and `POST /api/paypal/capture` implement one-time tier checkout. Each order accepts one configured tier ID; prices are read from server configuration, and captures are checked against the stored order and signed-in account.
- Mutating API requests require the CSRF cookie value in the `x-csrf-token` header. The included browser client adds it automatically.

The live site currently has no paid tiers defined. Add tier names, prices, and features in `PAYPAL_TIERS` before enabling PayPal credentials. The starter does not include admin roles, subscription billing, or authorization to perform any paid action after checkout. Add those business rules before using payments in production.

## Railway

The repository includes `railway.json` and a Dockerfile. Create a Railway PostgreSQL service, connect its `DATABASE_URL` to the app service, and configure the environment variables above in Railway's Variables panel. Use a strong production JWT secret, a verified Resend sender/domain, the public Railway app URL, and PayPal production credentials only when ready.

## Docker

`docker-compose.yml` runs the Node app and PostgreSQL with a named data volume. For local setup, copy `.env.example` to `.env` first and replace the development values. The Docker image runs as the non-root `node` user.
