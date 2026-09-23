import { isCanvaUrl } from './canvaDetector';

// Helper para sanitizar nombres de carpetas y archivos
export function sanitizeFolderName(name: string): string {
  // Limpiar caracteres no válidos para carpetas en Windows/Linux/macOS
  const cleaned = name
    .replace(/[?%*:|"<>]/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  return cleaned || 'general';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

export type FolderExtractionMode = 'parent_dir' | 'full_path' | 'line_prefix' | 'domain' | 'none';

export interface ParsedUrlEntry {
  url: string;
  folder: string;
  sourceType: 'direct' | 'canva';
  error?: string;
}

export function parseUrlLine(line: string, mode: FolderExtractionMode): ParsedUrlEntry {
  const trimmed = line.trim();
  if (!trimmed) {
    return { url: '', folder: '', sourceType: 'direct', error: 'Línea vacía' };
  }

  let folder = '';
  let url = trimmed;

  // 1. Detectar si viene con separador de carpeta tipo "Mi Carpeta | https://..." o "Mi Carpeta, https://..." o "Mi Carpeta \t https://..."
  const separatorMatch = trimmed.match(/^([^|\t,;]+?)\s*([|\t]|,|;)\s*(https?:\/\/.+)$/i);
  if (separatorMatch) {
    folder = sanitizeFolderName(separatorMatch[1]);
    url = separatorMatch[3].trim();
  }

  // Detectar si es Canva
  const isCanva = isCanvaUrl(url);

  // Validar URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      url,
      folder: folder || (isCanva ? 'canva' : 'general'),
      sourceType: isCanva ? 'canva' : 'direct',
      error: 'Formato de URL inválido. Usa http:// o https://'
    };
  }

  // 2. Si no se especificó carpeta explícita por prefijo, extraerla según el modo elegido
  if (!folder) {
    if (isCanva) {
      folder = 'canva';
    } else {
      switch (mode) {
        case 'parent_dir': {
          const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
          if (pathSegments.length > 1) {
            folder = sanitizeFolderName(decodeURIComponent(pathSegments[pathSegments.length - 2]));
          } else {
            folder = sanitizeFolderName(parsedUrl.hostname.replace(/^www\./, ''));
          }
          break;
        }

        case 'full_path': {
          const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
          if (pathSegments.length > 1) {
            const folderParts = pathSegments.slice(0, -1).map(p => sanitizeFolderName(decodeURIComponent(p)));
            folder = folderParts.join('/');
          } else {
            folder = sanitizeFolderName(parsedUrl.hostname.replace(/^www\./, ''));
          }
          break;
        }

        case 'domain': {
          folder = sanitizeFolderName(parsedUrl.hostname.replace(/^www\./, ''));
          break;
        }

        case 'none': {
          folder = '';
          break;
        }

        case 'line_prefix': {
          folder = 'general';
          break;
        }

        default:
          folder = 'general';
      }
    }
  }

  return {
    url,
    folder: folder || (isCanva ? 'canva' : 'general'),
    sourceType: isCanva ? 'canva' : 'direct'
  };
}
