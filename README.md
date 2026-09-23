<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/6c5e8ea6-951b-4beb-8ca5-f5302e003d3b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Desplegar: frontend en GitHub Pages + backend en Render

El frontend (React/Vite) puede servirse gratis desde **GitHub Pages**, pero
Pages solo sirve archivos estáticos: no puede ejecutar el servidor Node ni
Playwright que usan la extracción de Canva y el proxy de descarga directa.
Por eso el backend se despliega aparte, en un servicio que sí corre Node
(aquí, [Render](https://render.com), con plan gratuito).

### 1. Backend en Render

1. Sube este repo a GitHub (público).
2. En Render: **New > Blueprint**, conecta el repo. Render detecta
   [render.yaml](render.yaml) automáticamente y crea el servicio
   `descargar-imagenes-backend` (instala Playwright/Chromium en el build).
3. Cuando termine el primer deploy, copia la URL pública que te da Render
   (algo como `https://descargar-imagenes-backend.onrender.com`).

> Nota: el plan gratuito de Render "duerme" el servicio tras ~15 min sin
> tráfico; la primera petición después de eso tarda unos segundos más en
> responder mientras arranca.

### 2. Frontend en GitHub Pages

1. En GitHub: **Settings > Pages**, selecciona *Source: GitHub Actions*.
2. En **Settings > Secrets and variables > Actions > Variables**, crea la
   variable `VITE_API_BASE_URL` con la URL de Render del paso anterior (sin
   `/` al final).
3. Haz push a `main`. El workflow
   [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
   construye solo el frontend (`npm run build:client`) y lo publica en
   `https://tu-usuario.github.io/<nombre-del-repo>/`.

### 3. (Opcional) Restringir CORS

Por defecto el backend acepta peticiones de cualquier origen (`CORS_ORIGIN=*`
en [render.yaml](render.yaml)), suficiente porque solo hace de proxy de
imágenes públicas sin cookies ni datos sensibles. Si prefieres restringirlo,
cambia esa variable en Render a la URL exacta de tu GitHub Pages.
