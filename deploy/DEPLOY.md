# Deploying synthdata.testforge-ai.com

The web app is one static file (`web/index.html`). It deploys to your existing
Kamatera VPS alongside testforge-ai.com — same nginx, same certbot.

## One-time setup (~10 minutes)

### 1. DNS
At your DNS provider, add an A record:

```
synthdata.testforge-ai.com  →  <same VPS IP as testforge-ai.com>
```

### 2. On the VPS

```bash
sudo mkdir -p /var/www/synthdata
sudo cp nginx-synthdata.conf /etc/nginx/sites-available/synthdata
sudo ln -s /etc/nginx/sites-available/synthdata /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL (certbot + nginx plugin already installed by scripts/setup-vps.sh)
sudo certbot --nginx -d synthdata.testforge-ai.com
```

### 3. Upload the page

```bash
scp web/index.html <user>@<vps>:/var/www/synthdata/index.html
```

Done — https://synthdata.testforge-ai.com is live.

## Automating updates (optional)

Add a step to your existing `.github/workflows/deploy.yml` (or the synthdata repo's own
workflow) so every push updates the page:

```yaml
  - name: Deploy synthdata web
    run: |
      scp -o StrictHostKeyChecking=no web/index.html \
        ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/var/www/synthdata/index.html
```

## npm publish

```bash
cd testforge   # this folder
npm publish --access public     # publishes @vijaypjavvadi/synthdata
```

(You're already logged in as vijaypjavvadi; scoped packages need `--access public`
on first publish.)

## Post-deploy smoke test

1. Open https://synthdata.testforge-ai.com → click "Load sample (e-commerce)"
2. Paste a real Anthropic or OpenAI key → "Author plan with AI" → plan YAML appears
3. "Generate data" → preview tables render, FK violations: 0
4. Download the .db and open it in DB Browser for SQLite

Notes:
- The page calls api.anthropic.com / api.openai.com directly from the visitor's
  browser (CORS-enabled by both providers). Your server only serves static HTML —
  no keys, schemas, or data ever reach it, which is worth stating on the page (it does).
- CDN dependencies (js-yaml, sql.js WASM) load from cdnjs.cloudflare.com.
