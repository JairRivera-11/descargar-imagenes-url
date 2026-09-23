import { CanvaExtractOptions, CanvaExtractResult, ICanvaExtractor } from './canvaTypes';

/**
 * Proveedor preparado para integración futura con Canva Connect API (OAuth 2.0).
 * Permite alternar entre PublicCanvaExtractor y CanvaApiProvider sin alterar el resto del sistema.
 */
export class CanvaApiProvider implements ICanvaExtractor {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async extract(url: string, _options?: CanvaExtractOptions): Promise<CanvaExtractResult> {
    if (!this.apiKey) {
      throw new Error('Canva API Key no configurada. Utiliza el extractor público.');
    }

    // Estructura preparada para el endpoint oficial de Canva Connect API
    return {
      success: false,
      finalUrl: url,
      images: [],
      error: 'Canva API Provider: Pendiente de credenciales OAuth de usuario.'
    };
  }
}
