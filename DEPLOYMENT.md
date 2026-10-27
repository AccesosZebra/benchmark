# Deployment Guide

## Docker Deployment

### Building the Image

```bash
docker build -t zebra-benchmarking .
```

### Running the Container

**Option 1: With environment variable (Recommended)**

```bash
docker run -d -p 80:80 \
  -e API_KEY=your_gemini_api_key_here \
  --name zebra-benchmarking \
  zebra-benchmarking
```

Or using GEMINI_API_KEY:

```bash
docker run -d -p 80:80 \
  -e GEMINI_API_KEY=your_gemini_api_key_here \
  --name zebra-benchmarking \
  zebra-benchmarking
```

**Option 2: Without environment variable**

```bash
docker run -d -p 80:80 --name zebra-benchmarking zebra-benchmarking
```

Then configure via localStorage (see below).

### Accessing the Application

Open http://localhost in your browser.

## API Key Configuration

The application supports **three ways** to configure the API key:

### 1. Environment Variable (Recommended for Docker)

Pass the API key when running the container:

```bash
docker run -d -p 80:80 -e API_KEY=your_key_here --name zebra-benchmarking zebra-benchmarking
```

The container will automatically inject the API key into the application at startup. ✅

### 2. LocalStorage (Fallback)

If no environment variable is provided, configure via browser:

1. Open the application in your browser
2. Open the browser console (F12)
3. Set the API key:
   ```javascript
   localStorage.setItem('GEMINI_API_KEY', 'your_actual_api_key_here')
   ```
4. Reload the page

### 3. Build-time (Local Development)

When running locally with npm:

1. Create `.env.local`:
   ```env
   API_KEY=your_gemini_api_key_here
   ```
2. Run `npm run dev`

**Get your API key:** https://ai.google.dev/gemini-api/docs/api-key

## Easypanel Deployment

For Easypanel deployments:

1. The system will automatically detect the `Dockerfile` and build the image
2. **Configure environment variables** in the "Entorno" (Environment) section:
   - Variable name: `API_KEY` (or `GEMINI_API_KEY`)
   - Value: Your Gemini API key
3. The application will automatically use the environment variable at runtime
4. No need to configure localStorage - it just works! ✅

**Note:** Both `API_KEY` and `GEMINI_API_KEY` variable names are supported.

## Base de datos global (Postgres)

El contenedor corre un servidor Node (`server/index.mjs`) que sirve la SPA y la API
`/api/benchmarks`. El historial se guarda en Postgres y es compartido entre dispositivos:
los usuarios internos (`@zebradigital.marketing`) ven todos los benchmarks; los invitados
solo los suyos. Borrar: el dueño o cualquier usuario interno.

Variables de entorno requeridas:

- `DATABASE_URL`: `postgres://usuario:clave@host:5432/base` (la tabla se crea sola al arrancar).
- `SESSION_SECRET`: cadena aleatoria larga para firmar las sesiones.
- `ENCRYPTION_KEY`: cadena aleatoria larga para cifrar las claves de Claude en la base (AES-256-GCM).
  **No la cambies**: si se pierde, las claves guardadas dejan de poder leerse y hay que volver a cargarlas.
- `GOOGLE_CLIENT_ID`: se valida también en el servidor (audiencia del ID token).

En el primer acceso, cada navegador sube automáticamente su historial previo de `localStorage`.

## Claves de Claude e invitados (panel Admin)

El navegador nunca recibe una clave de Claude: las llamadas pasan por `/api/anthropic`, que usa
la clave asignada al invitado (si está activa) o la **predeterminada**. Cualquier usuario
`@zebradigital.marketing` ve el botón **Admin** para:

- Agregar claves (se verifican contra Anthropic y se guardan cifradas; solo se muestra `sk-ant-…a1b2`),
  marcar la predeterminada, desactivarlas o borrarlas reasignando sus invitados a otra clave.
- Crear invitados (contraseña con hash scrypt), asignarles o reasignarles clave, cambiar su
  contraseña, desactivarlos (corta el acceso al instante) o eliminarlos.

Importación única al arrancar con la base vacía: `GUEST_USERS` (`correo:clave,...`) → invitados, y
`ANTHROPIC_API_KEY` → clave predeterminada. Después de eso, ambas variables pueden quitarse.

Desarrollo local: `npm run server` (API en `:8080`, con `PORT=8080 DATABASE_URL=... SESSION_SECRET=...`)
y `npm run dev` en paralelo (Vite hace proxy de `/api`).

## Nginx Configuration

> Ya no se usa en la imagen de Docker (la sirve el servidor Node); se conserva como referencia.

The included `nginx.conf` provides:
- SPA routing (all routes redirect to index.html)
- Gzip compression
- Security headers
- Static asset caching
- Health check endpoint at `/health`

## Health Checks

The container includes a health check that verifies nginx is responding:
- Endpoint: `http://localhost/health`
- Interval: 30 seconds
- Timeout: 3 seconds

## Troubleshooting

### Build Fails with npm Error

If the Docker build fails during `npm install`, check:
1. Docker daemon has internet access
2. No firewall blocking npm registry
3. Try using a different npm registry:
   ```dockerfile
   RUN npm config set registry https://registry.npmmirror.com/
   RUN npm install
   ```

### Application Loads but Shows API Key Error

Configure the API key in localStorage as described above.

### Nginx Returns 404 for Routes

This is expected behavior - the nginx.conf handles this by redirecting to index.html.
If you're still seeing 404s, verify:
1. `nginx.conf` was copied correctly
2. The default nginx config was replaced

## Production Recommendations

1. **API Key Management**: Use localStorage or implement a backend proxy
2. **HTTPS**: Use a reverse proxy (e.g., Caddy, Traefik) in front of nginx
3. **Monitoring**: Set up health check monitoring
4. **Logging**: Configure nginx access logs for monitoring
5. **Rate Limiting**: Implement rate limiting for API calls
