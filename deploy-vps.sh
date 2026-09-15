#!/usr/bin/env bash
# Déploiement HEXARO sur VPS — clés déjà remplies depuis ton .env local
set -euo pipefail

cd ~/chabot   # adapte le chemin si besoin

# 1) deps
npm run install:all

# 2) .env prod
cat > backend/.env <<'EOF'
NODE_ENV=production
PORT=5010
FRONTEND_URL=https://chat.92-222-80-91.sslip.io

SUPABASE_PROJECT_ID=kiggmajeihmdkzdhjrwb
SUPABASE_URL=https://kiggmajeihmdkzdhjrwb.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZ2dtYWplaWhtZGt6ZGhqcndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTgyMTAsImV4cCI6MjA5OTMzNDIxMH0.Mw5QISGOiox9-qDdH9HicZEyHGFt6r5IVWWpKyNXJdI
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZ2dtYWplaWhtZGt6ZGhqcndiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc1ODIxMCwiZXhwIjoyMDk5MzM0MjEwfQ.9WtsV1DdOGtBVrnTpZsCjyro5PRt3QT3kTEaHbsxnmM

ADMIN_EMAIL=hexaro@gmail.com

COHERE_API_KEY=
WITAI_API_KEY=

DOWNLOADER_API_URL=https://hexaro.92-222-80-91.sslip.io
SITE_DOWNLOADER_LOCAL_FALLBACK=false
EOF

cat > frontend/.env <<'EOF'
VITE_API_URL=https://chat.92-222-80-91.sslip.io
VITE_SUPABASE_PROJECT_ID=kiggmajeihmdkzdhjrwb
VITE_SUPABASE_URL=https://kiggmajeihmdkzdhjrwb.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZ2dtYWplaWhtZGt6ZGhqcndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTgyMTAsImV4cCI6MjA5OTMzNDIxMH0.Mw5QISGOiox9-qDdH9HicZEyHGFt6r5IVWWpKyNXJdI
EOF

# 3) build front (VITE_* figés au build)
npm run build

# 4) PM2
command -v pm2 >/dev/null || sudo npm i -g pm2
pm2 delete hexaro-backend hexaro-frontend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 status

# 5) nginx (UI + API + websocket)
sudo tee /etc/nginx/sites-available/chabot >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name chat.92-222-80-91.sslip.io;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:5010/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:5010/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:5011/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sfn /etc/nginx/sites-available/chabot /etc/nginx/sites-enabled/chabot
sudo nginx -t && sudo systemctl reload nginx

# 6) HTTPS
sudo ufw allow 80 || true
sudo ufw allow 443 || true
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx --agree-tos --register-unsafely-without-email \
  -d chat.92-222-80-91.sslip.io --non-interactive --redirect

sudo nginx -t && sudo systemctl reload nginx

# 7) tests
curl -sS -o /dev/null -w "front:%{http_code}\n" https://chat.92-222-80-91.sslip.io/
curl -sS https://chat.92-222-80-91.sslip.io/api/health
echo
pm2 status

echo ""
echo "OK — pense à ajouter dans Supabase Auth → URL Configuration :"
echo "  Site URL : https://chat.92-222-80-91.sslip.io"
echo "  Redirect : https://chat.92-222-80-91.sslip.io/auth/callback"
