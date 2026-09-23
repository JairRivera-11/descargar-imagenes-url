# Mass URL Downloader

Aplicación web propia para descargar imágenes en lote desde una lista de
URLs, con soporte especial para extraer automáticamente todas las imágenes
de un diseño de Canva a partir de su enlace público (`canva.link/...` o
`canva.com/design/...`).

## Funcionalidad

- Pega una lista de URLs (una por línea) y descárgalas todas organizadas en
  carpetas dentro de un único ZIP.
- Detecta automáticamente enlaces de Canva, navega el diseño con un
  Chromium headless (Playwright) y extrae cada imagen de sus páginas,
  nombrando la carpeta igual que el título del diseño.
- Permite personalizar la carpeta de destino por línea (`Carpeta | https://...`)
  o por distintos modos de organización automática (dominio, ruta, etc.).
- Descargas concurrentes configurables para procesar lotes grandes de URLs.

## Stack

- Frontend: React + Vite + Tailwind.
- Backend: Express (desarrollo local) / funciones serverless de Vercel
  (`api/canva.ts`, `api/proxy.ts`) en producción.
- Extracción de Canva: Playwright, con `@sparticuz/chromium` para correr en
  el entorno serverless de Vercel.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

La app queda disponible en `http://localhost:3000`.

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
