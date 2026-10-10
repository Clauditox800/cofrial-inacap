#!/usr/bin/env bash
# Instala Docker y levanta los camiones simulados en la EC2 IoT (Ubuntu 24.04).
# Ejecutar como usuario ubuntu:  bash infra/scripts/setup-iot.sh
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

if ! command -v docker >/dev/null; then
  echo "==> Docker"
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
fi

cd "$RAIZ/iot"
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Se creó iot/.env. Revisa API_URL (IP privada de la EC2 App) e IOT_SECRET con:  nano $RAIZ/iot/.env"
  echo "Luego vuelve a ejecutar este script."
  exit 0
fi

echo "==> Construyendo y levantando los contenedores (se reinician solos con la EC2)"
sudo docker compose up -d --build
sudo docker compose ps
echo
echo "Ver la telemetría en vivo:  sudo docker compose -f $RAIZ/iot/docker-compose.yml logs -f"
