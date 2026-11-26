# qrono.co.uk

The public site: landing page, Terms of Use, Privacy Policy, Support and account-deletion help.
The app itself is at app.qrono.co.uk (`apps/web`).

- Page text lives in `content/*.py`; the shared header and footer in `build.py`; styles in `public/site.css`.
- `python3 build.py` writes the HTML into `public/`. The deploy workflow runs it, then `wrangler deploy`.
- The Worker attaches itself to `qrono.co.uk` and `www.qrono.co.uk` (see `wrangler.jsonc`). That needs the
  `qrono.co.uk` zone on the same Cloudflare account, with no other DNS record on the apex or `www`.

Before publishing, replace the placeholders in the Terms and Privacy Policy:
`[RC NUMBER]`, `[REGISTERED ADDRESS]` and `[LIABILITY CAP, e.g. ₦100,000]`. Have a lawyer review both.
