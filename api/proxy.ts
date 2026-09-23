import mime from "mime-types";
import { validateSafeUrl } from "../services/canva/canvaSecurity.js";

// Función serverless de Vercel: sube el límite de tiempo por si la URL de
// origen responde lento (el timeout interno de fetch es de 30s).
export const config = {
  maxDuration: 30
};

// Helper para limpiar nombres de archivos
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

export default async function handler(req: any, res: any) {
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    return res.status(400).json({ error: "URL is required" });
  }

  const safeCheck = validateSafeUrl(targetUrl);
  if (!safeCheck.valid) {
    return res.status(400).json({ error: safeCheck.error });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(response.status).json({ error: `HTTP Error: ${response.status} ${response.statusText}` });
    }

    // Paso 3: Verificar Content-Type. No guardar HTML como imagen.
    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      return res.status(400).json({
        error: `La URL no apunta directamente a una imagen. Content-Type: ${contentType || 'desconocido'}`
      });
    }

    let filename = "download";
    let extension = "";
    
    const contentDisposition = response.headers.get("content-disposition");
    if (contentDisposition && contentDisposition.includes("filename=")) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
      if (matches != null && matches[1]) {
        filename = matches[1].replace(/['"]/g, '');
      }
    } else {
      const parsedUrl = new URL(targetUrl);
      const pathname = parsedUrl.pathname;
      const lastPart = pathname.substring(pathname.lastIndexOf('/') + 1);
      if (lastPart) {
        filename = lastPart;
      } else {
        filename = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
      }
    }

    if (!filename.includes('.')) {
      if (contentType) {
        const derivedExt = mime.extension(contentType.split(';')[0]);
        if (derivedExt) {
          extension = `.${derivedExt}`;
        }
      }
      filename += extension;
    }
    
    filename = sanitizeFilename(filename);

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('X-Suggested-Filename', Buffer.from(filename).toString('base64'));

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
    
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: "Timeout: No se pudo conectar a la URL en menos de 30 segundos." });
    }
    res.status(500).json({ error: `Fetch falló: ${error.message}` });
  }
}
