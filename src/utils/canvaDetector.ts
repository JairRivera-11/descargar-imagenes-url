/**
 * Detección de URLs de Canva
 * Soporta canva.link/*, www.canva.com/*, canva.com/design/*
 */
export function isCanvaUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    // canva.link/*
    if (host === 'canva.link' || host.endsWith('.canva.link')) {
      return true;
    }

    // canva.com, www.canva.com (páginas de diseño/share, NO subdominios de
    // recursos como media.canva.com o static.canva.com, que son las propias
    // imágenes ya extraídas y deben descargarse directo, no re-analizarse)
    if (host === 'canva.com' || host === 'www.canva.com') {
      return true;
    }

    return false;
  } catch {
    // Si no tiene protocolo, intentar anteponer https:// para validar
    if (trimmed.startsWith('canva.link/') || trimmed.startsWith('canva.com/') || trimmed.startsWith('www.canva.com/')) {
      return true;
    }
    return false;
  }
}

export function normalizeCanvaUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  return url;
}
