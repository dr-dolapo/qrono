"""Builds the static pages in public/ from one header and footer. Run: python3 build.py"""
import pathlib
LOGO='''<svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17112B"/><stop offset="1" stop-color="#050409"/></linearGradient></defs><rect width="100" height="100" rx="23" fill="url(#lg)"/><g transform="translate(50 50) scale(1.08) translate(-51 -49)"><circle cx="49" cy="47" r="27" fill="none" stroke="#A97BFF" stroke-width="10"/><ellipse cx="41" cy="45" rx="5.5" ry="7.5" fill="#FFFFFF"/><ellipse cx="57" cy="45" rx="5.5" ry="7.5" fill="#FFFFFF"/><line x1="68" y1="66" x2="80" y2="78" stroke="#A97BFF" stroke-width="11" stroke-linecap="round"/></g></svg>'''
APP="https://app.qrono.co.uk"
def page(path,title,desc,body):
    html=f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#050409">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">{LOGO}<span>Qrono</span></a>
    <nav class="nav" aria-label="Main">
      <a class="wide" href="/#how">How it works</a>
      <a class="wide" href="/support">Support</a>
      <a href="{APP}/login">Log in</a>
      <a class="btn btn-primary" href="{APP}/signup">Get started</a>
    </nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer>
  <div class="wrap">
    <p>© 2026 Tend Technologies Limited. Qrono is a product of Tend Technologies Limited.</p>
    <nav aria-label="Legal">
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/support">Support</a>
      <a href="/delete-account">Delete your account</a>
    </nav>
  </div>
</footer>
<script src="/typed.js" defer></script>
</body>
</html>
'''
    out=pathlib.Path("public")/path
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(html)

for name in ["home","terms","privacy","support","delete_account","not_found"]:
    exec(open(f"content/{name}.py").read())
