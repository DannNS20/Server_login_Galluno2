#!/bin/bash

SERVER_IP="209.38.136.151"
SERVER_USER="root"
SERVER_PATH="/var/www/server_login"
NVM_DIR="/root/.nvm"
PM2_PATH="$NVM_DIR/versions/node/v20.12.0/bin/pm2"

ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << EOF
  echo "🔄 Entrando al proyecto..."
  cd $SERVER_PATH

  echo "📥 Haciendo git pull..."
  git pull origin main

  echo "🧪 Cargando entorno de Node y PM2..."
  export NVM_DIR="$NVM_DIR"
  [ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"
  [ -s "\$NVM_DIR/bash_completion" ] && \. "\$NVM_DIR/bash_completion"

  echo "🚀 Reiniciando PM2..."
  $PM2_PATH restart 0 || echo "⚠️ Error al reiniciar PM2"
EOF
