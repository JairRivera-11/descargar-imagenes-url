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

## Desplegar en Vercel

Todo el proyecto (frontend + API) se despliega en un solo lugar: Vercel sirve
el build estático de Vite y detecta automáticamente los archivos en
[api/](api) (`canva.ts`, `proxy.ts`) como funciones serverless, sin
necesidad de CORS ni de un backend aparte (todo vive en el mismo dominio).

1. En [vercel.com](https://vercel.com), **Add New > Project** y conecta este
   repo de GitHub.
2. Vercel detecta el framework (Vite) y usa la configuración de
   [vercel.json](vercel.json) (`npm run build:client`, carpeta `dist`) sin
   que tengas que tocar nada.
3. Click **Deploy**. Cuando termine, tu app queda en
   `https://<nombre-del-proyecto>.vercel.app`.

### Sobre la extracción de Canva en Vercel

La extracción usa Playwright con un Chromium headless. En local
(`npm run dev`) usa el Playwright normal; en Vercel usa
[`@sparticuz/chromium`](https://github.com/Sparticuz/chromium), una versión
de Chromium recortada para funciones serverless (el Chromium completo pesa
demasiado para el límite de tamaño de una función). El cambio de uno a otro
es automático según el entorno (`services/canva/publicCanvaExtractor.ts`).

Las funciones serverless tienen límite de tiempo: `api/canva.ts` está
configurado a 60s (el máximo del plan Hobby gratuito), suficiente para
diseños de Canva de hasta ~15-20 páginas. Diseños mucho más grandes podrían
agotar ese límite; si eso pasa, el plan Pro de Vercel permite subirlo a 300s.

> No pude probar esta ruta serverless en este entorno (el binario de
> @sparticuz/chromium es para Linux, no corre en macOS), así que pruébala
> apenas despliegues y avísame si algo falla — lo más probable, si pasa, es
> un timeout o un error de memoria, y ambos se ajustan desde `api/canva.ts`.
