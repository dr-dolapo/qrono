# Deploying Qrono to Cloudflare

Qrono deploys itself from GitHub. **Every merge to `main`** runs the checks, applies database
changes, and deploys the API and the web app to your Cloudflare account. You can also run it by
hand from the **Actions** tab, under **Deploy → Run workflow**.

```
checks → database migrations → API Worker (qrono-api) → web Worker (qrono-web) → health check
```

The first time, you need to do the four steps below (about 10 minutes). Nothing else is needed:
the database is created automatically on the first deploy.

---

## One-time setup

### 1. Choose your workers.dev subdomain

In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Workers & Pages**. If it asks
you to pick a `workers.dev` subdomain, choose one (for example your company name). Qrono will
then live at `https://qrono-web.<your-subdomain>.workers.dev` until you add your own domain.

### 2. Copy your Account ID

It's shown on the right-hand side of the **Workers & Pages** overview page (and in the URL
after `dash.cloudflare.com/`).

### 3. Create an API token for GitHub

1. Go to **My Profile → API Tokens → Create Token**.
2. Next to **Edit Cloudflare Workers**, choose **Use template**.
3. Under **Permissions**, make sure these are all there, and **add D1** (the template leaves it out):
   | Scope | Item | Access |
   |---|---|---|
   | Account | Workers Scripts | Edit |
   | Account | **D1** | **Edit** |
   | Account | Account Settings | Read |
4. Under **Account Resources**, pick your account.
5. **Continue to summary → Create Token**, and copy the token. It's only shown once.

### 4. Add the secrets to GitHub

In the repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | The token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | The Account ID from step 2 |

Then go to **Actions → Deploy → Run workflow**. When it finishes, the run's summary shows Qrono's
address.

---

## Until email is set up

Out of the box, Qrono runs with `EMAIL_MODE=log`: emails (sign-up confirmation, password reset,
invitations, event emails) are **written to the logs instead of being sent**. To try Qrono yourself
before email is set up:

1. Sign up on the site.
2. In Cloudflare, open **Workers & Pages → qrono-api → Logs**, find the email, and open the link
   in it.

This is fine for trying it out, but **turn on email before inviting real users**.

## Turning on email

Email goes out through **Cloudflare Email Service**, which needs:

1. The **Workers Paid** plan on your Cloudflare account.
2. **A domain on Cloudflare** (for example `qrono.app`), onboarded as a **sending domain** under
   **Email Service** in the dashboard.

Then, in GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Value |
|---|---|
| `EMAIL_MODE` | `send` |
| `MAIL_FROM` | e.g. `Qrono <no-reply@qrono.app>` (must be on the sending domain) |

Run the **Deploy** workflow again.

## Using your own domain (optional)

1. In Cloudflare: **Workers & Pages → qrono-web → Settings → Domains & Routes → Add → Custom
   domain**, e.g. `app.qrono.app`.
2. In GitHub, add the repository variable `APP_ORIGIN` = `https://app.qrono.app` (no trailing slash).
3. Run the **Deploy** workflow again.

`APP_ORIGIN` must match the address people use, because Qrono uses it for email links, for login
cookies and to block requests from other sites.

---

## Good to know

- **The API isn't public.** `qrono-api` has no public URL; it's only reachable through the web app
  (`/api/...`), via a service binding.
- **Database changes** live in `apps/api/migrations/` and are applied automatically before each
  deploy. Never edit a migration that has already run; add a new one.
- **Rolling back code:** **Workers & Pages → qrono-api / qrono-web → Deployments** lets you
  roll back to an earlier version. Database migrations don't roll back automatically, so if a
  rollback crosses a migration, check that the older code still works with the newer database.
- **Restoring data:** D1 keeps a history of the database (Time Travel), so it can be restored to an
  earlier point if something goes wrong. See Cloudflare's D1 documentation.
- **A failed deploy** stops at the failing step and leaves the previous version running. The
  error message says what to fix (for example a missing token permission).

## Before inviting real users

- Turn on email (above).
