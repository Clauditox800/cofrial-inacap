#!/usr/bin/env bash
# Instala y deja corriendo la aplicación en la EC2 de aplicación (Ubuntu 24.04).
# Ejecutar como usuario ubuntu desde la carpeta del proyecto:  bash infra/scripts/setup-app.sh
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

echo "==> Paquetes del sistema (Nginx, cliente MySQL)"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl nginx mysql-client

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v pm2 >/dev/null || sudo npm install -g pm2@5

echo "==> Dependencias de la aplicación"
cd "$RAIZ/app"
npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo
  echo "Se creó app/.env. Complétalo (endpoint de RDS, claves) con:  nano $RAIZ/app/.env"
  echo "Luego carga la base con:  cd $RAIZ/app && npm run db:init"
  echo "Y vuelve a ejecutar este script."
  exit 0
fi

echo "==> Backend persistente con PM2 (se levanta solo al reiniciar la EC2)"
pm2 delete cofrial >/dev/null 2>&1 || true
pm2 start src/server.js --name cofrial --time
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "==> Nginx como proxy inverso en el puerto 80"
sudo cp "$RAIZ/infra/scripts/nginx-cofrial.conf" /etc/nginx/sites-available/cofrial
sudo ln -sf /etc/nginx/sites-available/cofrial /etc/nginx/sites-enabled/cofrial
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

sleep 2
curl -fsS http://localhost/api/salud && echo && echo "Aplicación en línea."
