# SynthData standalone — accounts on synthdata.testforge-ai.com

Adds Home, Register, Login, Forgot-Password (email), and per-user saved datasets
to the subdomain — fully self-contained, no changes to the platform.

Two pieces:
1. **web/index.html** — now includes the hero/Home section, Log in / Create account
   buttons, the auth modal (login / register / forgot / reset), "Save to account",
   and a "My datasets" panel. Still one static file.
2. **standalone/** — a small Node API (this folder): JWT auth, scrypt password
   hashing, rate-limited endpoints, SMTP reset emails, SQLite storage. Datasets
   are stored as recipes (ddl + plan + seed) and regenerated deterministically
   on download — tiny DB, byte-identical results.

## Deploy (~10 min on the VPS)

```bash
# 1. copy the code up (from your PC)
scp -r E:\Sy\testforge\standalone E:\Sy\testforge\src <user>@66.55.65.18:/opt/synthdata/
scp E:\Sy\testforge\web\index.html <user>@66.55.65.18:/var/www/synthdata/index.html

# 2. on the VPS
cd /opt/synthdata/standalone
npm install                       # better-sqlite3 builds natively here
cp .env.example .env
nano .env                         # set JWT_SECRET (64 random chars) + SMTP_* (same as platform)

# 3. systemd service
sudo cp synthdata-api.service /etc/systemd/system/
sudo chown -R www-data /opt/synthdata
sudo systemctl daemon-reload
sudo systemctl enable --now synthdata-api
curl -s localhost:8791/api/health   # -> {"ok":true}
```

## nginx — add the /api proxy

Edit `/etc/nginx/sites-available/synthdata`, add inside the `server { }` block
(certbot's 443 block):

```nginx
    location /api/ {
        proxy_pass http://127.0.0.1:8791;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $host;
    }
```

Then: `sudo nginx -t && sudo systemctl reload nginx`

(The existing `try_files $uri /index.html;` already serves `/reset?token=...` —
the page reads the token from the URL and opens the reset form.)

## Smoke test

1. https://synthdata.testforge-ai.com → hero + "Create free account"
2. Register → nav shows your name, "My datasets" panel appears
3. Load sample → Generate → **Save to account** → dataset listed
4. Download .db / .sql from My datasets; delete works
5. Log out → Log in → Forgot password? → email arrives (SMTP configured) →
   link opens the reset form → new password works, old rejected
6. Reset link is single-use and expires after 1 hour

## Notes

- API binds to 127.0.0.1 only — reachable solely through nginx.
- Rate limits: login/register 10 per 15 min per IP, forgot/reset 5 per 15 min.
- Without SMTP_* set, reset links are printed to the service journal
  (`journalctl -u synthdata-api`) — useful for testing before email is wired.
- Generation itself still happens in the visitor's browser; the account only
  stores recipes. AI keys are never sent to this server.
