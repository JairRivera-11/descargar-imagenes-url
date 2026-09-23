/**
 * Validación de seguridad y prevención de SSRF
 */
export function validateSafeUrl(rawUrl: string): { valid: boolean; error?: string; url?: URL } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL requerida.' };
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Formato de URL inválido.' };
  }

  // Solo permitir HTTP y HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Protocolo no permitido: ${parsed.protocol}. Solo se permite http:// o https://` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Bloquear localhost e IPs privadas/internas para mitigar SSRF
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '169.254.169.254' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    return { valid: false, error: 'Acceso a direcciones locales o privadas restringido por seguridad.' };
  }

  return { valid: true, url: parsed };
}
