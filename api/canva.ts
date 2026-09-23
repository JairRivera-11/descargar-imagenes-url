import { validateSafeUrl } from '../services/canva/canvaSecurity.js';
import { canvaService } from '../services/canva/canvaService.js';

// Función serverless de Vercel: la extracción con Playwright puede tardar
// 20-30s+ en diseños con varias páginas, así que se sube el límite de tiempo
// por encima del default (plan Hobby permite hasta 60s).
export const config = {
  maxDuration: 60
};

export default async function handler(req: any, res: any) {
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
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Error al procesar la URL de Canva"
    });
  }
}
