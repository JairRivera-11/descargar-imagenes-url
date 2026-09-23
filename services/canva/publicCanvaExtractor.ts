import type { Browser, BrowserContext, Page } from 'playwright-core';
import crypto from 'crypto';
import mime from 'mime-types';
import { validateSafeUrl } from './canvaSecurity';
import { CanvaImage, CanvaExtractOptions, CanvaExtractResult, ICanvaExtractor } from './canvaTypes';

const LOCAL_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote'
];

/**
 * Lanza Chromium según el entorno de ejecución:
 * - En una función serverless de Vercel (VERCEL_ENV = "production"/"preview")
 *   usa @sparticuz/chromium, un binario recortado para ese entorno Linux,
 *   junto con playwright-core (sin el Chromium completo de Playwright, que
 *   pesa demasiado para el límite de tamaño de una función serverless).
 * - En local ("npm run dev", o "vercel dev" con VERCEL_ENV=development) usa
 *   el Playwright normal, con el Chromium ya instalado en la máquina.
 */
async function launchChromium(): Promise<Browser> {
  const isVercelCloud = !!process.env.VERCEL && process.env.VERCEL_ENV !== 'development';

  if (isVercelCloud) {
    const [{ default: sparticuzChromium }, { chromium: coreChromium }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('playwright-core')
    ]);

    return coreChromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true
    });
  }

  const { chromium: localChromium } = await import('playwright');
  return localChromium.launch({
    headless: true,
    args: LOCAL_CHROMIUM_ARGS
  });
}

// Constantes configurables según Paso 7 y 14
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_CANVA_IMAGE_SIZE = 20000; // 20 KB
const MAX_CANVA_IMAGES = 100;
const MAX_IMAGE_SIZE_MB = 30;

// Palabras clave de UI y recursos irrelevantes
const UI_EXCLUDE_PATTERNS = [
  'avatar',
  'favicon',
  'sprite',
  'emoji',
  'icon',
  'thumbnail',
  'thumb',
  'logo',
  'button',
  'cursor',
  'spinner',
  'static.canva.com/web/images',
  'badges',
  'placeholders'
];

/**
 * Normaliza la URL de una imagen para deduplicación inicial
 */
function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Eliminar parámetros volátiles o de tracking comunes
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('_t');
    parsed.searchParams.delete('v');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Determina si una URL parece ser un recurso de interfaz (UI)
 */
function isUiClutter(url: string): boolean {
  const lower = url.toLowerCase();
  return UI_EXCLUDE_PATTERNS.some(pat => lower.includes(pat));
}

/**
 * Resuelve redirecciones (ej. canva.link/...) hacia la URL final de Canva
 */
export async function resolveCanvaUrl(url: string): Promise<string> {
  const check = validateSafeUrl(url);
  if (!check.valid || !check.url) {
    throw new Error(check.error || 'URL inválida');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.url || url;
  } catch {
    return url;
  }
}

export class PublicCanvaExtractor implements ICanvaExtractor {
  async extract(rawUrl: string, options?: CanvaExtractOptions): Promise<CanvaExtractResult> {
    const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
    const minSize = options?.minImageSizeBytes || MIN_CANVA_IMAGE_SIZE;
    const maxImages = options?.maxImages || MAX_CANVA_IMAGES;

    // 1. Validar seguridad
    const safeCheck = validateSafeUrl(rawUrl);
    if (!safeCheck.valid || !safeCheck.url) {
      return {
        success: false,
        finalUrl: rawUrl,
        images: [],
        error: safeCheck.error || 'URL inválida o no permitida'
      };
    }

    // 2. Resolver redirecciones de canva.link
    let targetUrl = rawUrl;
    try {
      targetUrl = await resolveCanvaUrl(rawUrl);
    } catch (e: any) {
      return {
        success: false,
        finalUrl: rawUrl,
        images: [],
        error: `Error al resolver enlace: ${e.message}`
      };
    }

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    const collectedImages = new Map<string, CanvaImage>();
    const seenHashes = new Set<string>();

    try {
      // Lanzar Chromium (Playwright normal en local, @sparticuz/chromium en Vercel)
      browser = await launchChromium();

      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        deviceScaleFactor: 1,
        // Forzamos el idioma para que los controles de navegación (aria-label
        // "Next page", etc.) sean predecibles sin importar el locale del
        // servidor donde corra este proceso.
        locale: 'en-US'
      });

      page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      // Interceptar respuestas de red para capturar imágenes
      page.on('response', async (response) => {
        try {
          if (collectedImages.size >= maxImages) return;

          const status = response.status();
          if (status < 200 || status >= 300) return;

          const headers = response.headers();
          const contentType = headers['content-type']?.toLowerCase() || '';

          // Filtrar por tipos de imagen admitidos
          if (
            !contentType.startsWith('image/jpeg') &&
            !contentType.startsWith('image/png') &&
            !contentType.startsWith('image/webp') &&
            !contentType.startsWith('image/avif')
          ) {
            return;
          }

          const responseUrl = response.url();
          if (isUiClutter(responseUrl)) return;

          // Verificar content-length si existe
          const contentLengthStr = headers['content-length'];
          if (contentLengthStr) {
            const contentLength = parseInt(contentLengthStr, 10);
            if (!isNaN(contentLength) && contentLength < minSize) {
              return;
            }
          }

          const normalized = normalizeImageUrl(responseUrl);
          if (collectedImages.has(normalized)) return;

          // Leer buffer para deduplicación por hash SHA-256 y tamaño real
          let buffer: Buffer;
          try {
            buffer = await response.body();
          } catch {
            return;
          }

          if (buffer.length < minSize) return;
          if (buffer.length > MAX_IMAGE_SIZE_MB * 1024 * 1024) return;

          const hash = crypto.createHash('sha256').update(buffer).digest('hex');
          if (seenHashes.has(hash)) return;
          seenHashes.add(hash);

          // Determinar extensión adecuada
          let ext = mime.extension(contentType.split(';')[0]) || 'jpg';
          if (ext === 'jpeg') ext = 'jpg';

          const id = `canva-img-${collectedImages.size + 1}`;
          const filename = `canva-image-${String(collectedImages.size + 1).padStart(3, '0')}.${ext}`;

          collectedImages.set(normalized, {
            id,
            url: responseUrl,
            contentType,
            size: buffer.length,
            filename,
            sha256: hash
          });

        } catch {
          // Ignorar fallos puntuales de respuesta individual
        }
      });

      // Navegación con manejo de timeout
      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs
        });
      } catch (err: any) {
        if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
          return {
            success: false,
            finalUrl: targetUrl,
            images: [],
            error: 'Canva tardó demasiado en responder.'
          };
        }
        throw err;
      }

      // Esperar brevemente para permitir carga de recursos dinámicos
      await page.waitForTimeout(4000);

      // Los diseños de Canva en modo "view" suelen mostrarse como un visor
      // paginado (indicador "1/N" con botones "Previous page"/"Next page"),
      // no como un documento con scroll continuo: la altura de la página no
      // crece al hacer scroll porque solo se muestra una página/slide a la
      // vez. Detectamos ese botón y avanzamos página por página para que el
      // listener de red capture la imagen de cada una.
      const nextPageButton = page.getByRole('button', { name: 'Next page' });
      const hasPagination = await nextPageButton.count().then(c => c > 0).catch(() => false);

      if (hasPagination) {
        const maxPageClicks = Math.min(maxImages, 200);
        for (let i = 0; i < maxPageClicks; i++) {
          if (collectedImages.size >= maxImages) break;

          const disabled = await nextPageButton.first().isDisabled().catch(() => true);
          if (disabled) break;

          await nextPageButton.first().click().catch(() => {});
          // Esperar a que la imagen de la nueva página termine de solicitarse
          await page.waitForTimeout(1200);
        }
        // Espera final por si la última página aún está cargando su imagen
        await page.waitForTimeout(1500);
      } else {
        // Fallback: scroll progresivo hasta el final del documento para
        // diseños tipo "documento" con contenido continuo y lazy-loading.
        const maxScrollIterations = 40;
        let stableRounds = 0;
        for (let i = 0; i < maxScrollIterations; i++) {
          if (collectedImages.size >= maxImages) break;

          const { scrollY, innerHeight, scrollHeight } = await page.evaluate(() => ({
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            scrollHeight: document.body.scrollHeight
          }));

          const atBottom = scrollY + innerHeight >= scrollHeight - 5;

          if (atBottom) {
            // Esperar por si el documento crece (nuevas páginas virtualizadas)
            await page.waitForTimeout(1000);
            stableRounds++;
            if (stableRounds >= 3) break;
            continue;
          }

          stableRounds = 0;
          await page.evaluate((h) => window.scrollBy(0, h), innerHeight);
          await page.waitForTimeout(800);
        }

        // Espera final para que terminen de llegar las últimas imágenes en curso
        await page.waitForTimeout(2000);
      }

      // Verificar si requiere autenticación
      const pageTitle = await page.title().catch(() => '');
      const currentUrl = page.url();

      const requiresAuth = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const isLoginUrl = window.location.href.includes('/login') || window.location.href.includes('/signin');
        const authKeywords = [
          'inicia sesión para ver',
          'este diseño es privado',
          'log in to view',
          'you need to log in',
          'solicitar acceso',
          'request access'
        ];
        return isLoginUrl || authKeywords.some(kw => bodyText.includes(kw));
      }).catch(() => false);

      if (requiresAuth || currentUrl.includes('/login') || currentUrl.includes('/signin')) {
        return {
          success: false,
          finalUrl: currentUrl,
          title: pageTitle,
          images: [],
          requiresAuth: true,
          error: 'Este contenido de Canva requiere autenticación o no está disponible públicamente.'
        };
      }

      // Inspeccionar el DOM para imágenes que no hayan pasado por la red durante la escucha
      const domImages = await page.evaluate(() => {
        const results: string[] = [];
        const imgs = Array.from(document.querySelectorAll('img'));
        for (const img of imgs) {
          const src = img.currentSrc || img.src;
          if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
            // Filtrar dimensiones mínimas si están disponibles en el DOM
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (width >= 250 || height >= 250 || (width === 0 && height === 0)) {
              results.push(src);
            }
          }
        }
        return results;
      }).catch(() => []);

      for (const domSrc of domImages) {
        if (collectedImages.size >= maxImages) break;
        if (isUiClutter(domSrc)) continue;

        const normalized = normalizeImageUrl(domSrc);
        if (collectedImages.has(normalized)) continue;

        try {
          const headRes = await fetch(domSrc, { method: 'GET' });
          if (!headRes.ok) continue;

          const ct = headRes.headers.get('content-type') || '';
          if (
            !ct.startsWith('image/jpeg') &&
            !ct.startsWith('image/png') &&
            !ct.startsWith('image/webp') &&
            !ct.startsWith('image/avif')
          ) {
            continue;
          }

          const buf = await headRes.arrayBuffer();
          if (buf.byteLength < minSize) continue;

          const hash = crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
          if (seenHashes.has(hash)) continue;
          seenHashes.add(hash);

          let ext = mime.extension(ct.split(';')[0]) || 'jpg';
          if (ext === 'jpeg') ext = 'jpg';

          const id = `canva-img-${collectedImages.size + 1}`;
          const filename = `canva-image-${String(collectedImages.size + 1).padStart(3, '0')}.${ext}`;

          collectedImages.set(normalized, {
            id,
            url: domSrc,
            contentType: ct,
            size: buf.byteLength,
            filename,
            sha256: hash
          });
        } catch {
          // Ignorar
        }
      }

      const images = Array.from(collectedImages.values());

      return {
        success: true,
        finalUrl: currentUrl,
        title: pageTitle,
        images
      };

    } catch (err: any) {
      return {
        success: false,
        finalUrl: targetUrl,
        images: [],
        error: err.message || 'Error inesperado al analizar el diseño de Canva'
      };
    } finally {
      // Paso 15: Playwright debe cerrarse siempre
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }
}
