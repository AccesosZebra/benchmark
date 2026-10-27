#!/bin/sh

# Script to inject runtime environment variables into the built JS files

set -e

echo "🔧 Injecting runtime environment variables..."

# Find all JS files in dist
JS_FILES=$(find /app/dist -type f -name "*.js")

# Las claves de Claude NO se inyectan al navegador: viven cifradas en Postgres y
# se usan desde el proxy del servidor (/api/anthropic). ANTHROPIC_API_KEY, si
# existe, solo se importa una vez como clave por defecto.

# Client ID de Google para el login restringido por dominio (público, no secreto).
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  echo "✅ Found GOOGLE_CLIENT_ID, injecting..."
  for file in $JS_FILES; do
    sed -i "s|__RUNTIME_GOOGLE_CLIENT_ID__|${GOOGLE_CLIENT_ID}|g" "$file"
  done
else
  echo "⚠️  No GOOGLE_CLIENT_ID found — login screen will ask to configure it"
fi

# GUEST_USERS ya no se inyecta al navegador: lo valida el servidor (server/index.mjs).

echo "🚀 Starting server..."

# Servidor Node: SPA + API (/api) con Postgres
exec node /app/server/index.mjs
