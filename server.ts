import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import mime from "mime-types";
import { canvaService } from "./services/canva/canvaService";
import { validateSafeUrl } from "./services/canva/canvaSecurity";

// Helper para limpiar nombres de archivos
function sanitizeFilename(name: string): string {
  // Remueve caracteres inválidos para nombres de archivo en Windows/Linux/Mac
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

async function startServer() {
  const app = express();
  // Los hosts (Render, Fly.io, etc.) asignan el puerto dinámicamente vía env var.
  const PORT = Number(process.env.PORT) || 3000;

  // Habilita llamadas cross-origin: cuando el frontend se sirve estático desde
  // GitHub Pages, vive en un dominio distinto al de este backend. No hay
  // cookies ni datos sensibles de por medio (solo proxy de imágenes públicas),
  // así que un origen abierto es seguro aquí.
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    exposedHeaders: ['X-Suggested-Filename']
  }));

  app.use(express.json({ limit: '10mb' }));

  // Endpoint para analizar URLs de Canva y extraer sus recursos de imagen
  app.all(["/api/canva/extract", "/api/canva"], async (req, res) => {
    const rawUrl = (req.method === 'POST' ? req.body?.url : req.query.url) as string;

    if (!rawUrl) {
      return res.status(400).json({ error: "Parámetro 'url' es requerido" });
    }

    const safeCheck = validateSafeUrl(rawUrl);
    if (!safeCheck.valid) {
      return res.status(400).json({ error: safeCheck.error });
    }

    try {
      const result = await canvaService.extractCanvaImages(rawUrl);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || "Error al procesar la URL de Canva"
      });
    }
  });

  // Endpoint proxy para evitar problemas de CORS
  app.get("/api/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
      return res.status(400).json({ error: "URL is required" });
    }

    const safeCheck = validateSafeUrl(targetUrl);
    if (!safeCheck.valid) {
      return res.status(400).json({ error: safeCheck.error });
    }

    try {
      // Abort controller para timeout de 30 segundos
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

      // Intentar obtener el nombre del archivo desde Content-Disposition
      let filename = "download";
      let extension = "";
      
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition && contentDisposition.includes("filename=")) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches != null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      } else {
        // Derivar desde la URL
        const parsedUrl = new URL(targetUrl);
        const pathname = parsedUrl.pathname;
        const lastPart = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (lastPart) {
          filename = lastPart;
        } else {
          filename = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        }
      }

      // Asegurarnos que tenga la extensión correcta si falta
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

      // Pasar los headers relevantes hacia el frontend
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader('X-Suggested-Filename', Buffer.from(filename).toString('base64')); // Codificado para evitar problemas de charsets en cabeceras custom

      // Stream the response a express
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return res.status(504).json({ error: "Timeout: No se pudo conectar a la URL en menos de 30 segundos." });
      }
      res.status(500).json({ error: `Fetch falló: ${error.message}` });
    }
  });

  // Middleware de Vite para desarrollo
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
