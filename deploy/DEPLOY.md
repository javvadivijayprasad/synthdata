# Deploying synthdata.testforge-ai.com

The web app is **one static file** (`web/index.html`). It deploys to your existing
Kamatera VPS — the same server running testforge-ai.com (nginx + certbot are already
installed there by `scripts/setup-vps.sh`). Your DNS is managed at **GoDaddy**.

Total time: ~15 minutes (most of it DNS propagation).

---

## Step 1 — GoDaddy DNS (5 min)

1. Log in at **godaddy.com** → My Products
2. Next to **testforge-ai.com**, click **DNS** (or Manage DNS)
3. Click **Add New Record** and enter:

   | Field | Value |
   |---|---|
   | Type | **A** |
   | Name | **synthdata** |
   | Value | **your VPS IP** — same IP as the existing A record for testforge-ai.com (visible in the same DNS list, usually the record named `@`) |
   | TTL | 600 seconds (or default) |

4. Save. GoDaddy usually propagates in 5–30 minutes.

**Check propagation** (from your PC):
```cmd
nslookup synthdata.testforge-ai.com
```
When it returns your VPS IP, continue.

---

## Step 2 — VPS: nginx site (5 min)

SSH into the VPS (same way you deploy the platform):

```bash
ssh <user>@<vps-ip>

# 1. web root
sudo mkdir -p /var/www/synthdata

# 2. nginx server block
sudo tee /etc/nginx/sites-available/synthdata > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name synthdata.testforge-ai.com;

    root /var/www/synthdata;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    # keep index.html fresh so updates roll out immediately
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/html text/css application/javascript;
}
EOF

# 3. enable + reload
sudo ln -s /etc/nginx/sites-available/synthdata /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 3 — SSL certificate (2 min)

Only works AFTER the DNS record resolves (Step 1). certbot + the nginx plugin are
already installed on this VPS:

```bash
sudo certbot --nginx -d synthdata.testforge-ai.com
```

Choose "redirect HTTP to HTTPS" when asked. Certbot auto-renews via its systemd timer.

---

## Step 4 — Upload the page (1 min)

From your PC (PowerShell or CMD):

```cmd
scp E:\Sy\testforge\web\index.html <user>@<vps-ip>:/tmp/index.html
```

Then on the VPS:

```bash
sudo mv /tmp/index.html /var/www/synthdata/index.html
```

(Two steps because /var/www needs sudo; scp directly works if your SSH user owns the dir:
`sudo chown <user> /var/www/synthdata` once, then scp straight there next time.)

---

## Step 5 — Smoke test

1. Open **https://synthdata.testforge-ai.com**
2. Click **Load sample (e-commerce)**
3. Paste your Anthropic key → **Author plan with AI** → plan YAML appears
4. **Generate data** → preview renders, status shows `FK violations: 0`
5. Download the .db and open it in DB Browser

---

## Updating the page later

Just repeat Step 4 — it's one file. Or automate it: add this step to
`.github/workflows/` in the synthdata repo (uses the same VPS secrets as your
platform's deploy.yml):

```yaml
  - name: Deploy web app
    run: |
      scp -o StrictHostKeyChecking=no web/index.html \
        ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/var/www/synthdata/index.html
```

---

## Notes

- **No backend, no secrets on the server.** The page calls api.anthropic.com /
  api.openai.com directly from the visitor's browser (both providers allow CORS).
  Your server only serves static HTML — visitor schemas, keys, and data never touch it.
- CDN dependencies (js-yaml, sql.js WASM) load from cdnjs.cloudflare.com.
- If GoDaddy shows a "Parked" record or forwarding for the subdomain, remove it —
  only the A record should exist for `synthdata`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| nslookup returns nothing | Wait for propagation; confirm record Name is exactly `synthdata` (not `synthdata.testforge-ai.com`) |
| certbot fails "challenge failed" | DNS not propagated yet, or port 80 blocked — check `sudo ufw status` |
| Page loads but AI call fails 401 | Wrong/expired API key — the key is typed by the visitor, nothing to fix server-side |
| Page loads without styling | index.html upload truncated — re-run Step 4 and hard-refresh (Ctrl+F5) |
