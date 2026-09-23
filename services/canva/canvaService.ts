import { isCanvaUrl } from '../../src/utils/canvaDetector.js';
import { PublicCanvaExtractor, resolveCanvaUrl } from './publicCanvaExtractor.js';
import { CanvaApiProvider } from './canvaApiProvider.js';
import { CanvaExtractOptions, CanvaExtractResult, CanvaImage, ICanvaExtractor } from './canvaTypes.js';

export class CanvaService {
  private extractor: ICanvaExtractor;

  constructor(customExtractor?: ICanvaExtractor) {
    // Por defecto usa el extractor basado en Playwright para contenido público
    this.extractor = customExtractor || new PublicCanvaExtractor();
  }

  isCanvaUrl(url: string): boolean {
    return isCanvaUrl(url);
  }

  async resolveCanvaUrl(url: string): Promise<string> {
    return resolveCanvaUrl(url);
  }

  async extractCanvaImages(url: string, options?: CanvaExtractOptions): Promise<CanvaExtractResult> {
    if (!this.isCanvaUrl(url)) {
      return {
        success: false,
        finalUrl: url,
        images: [],
        error: "La URL proporcionada no es una URL reconocida de Canva (ej: canva.link/* o canva.com/*)"
      };
    }
    return this.extractor.extract(url, options);
  }

  setExtractor(extractor: ICanvaExtractor): void {
    this.extractor = extractor;
  }
}

// Instancia singleton para el servidor
export const canvaService = new CanvaService();
export { isCanvaUrl, resolveCanvaUrl, PublicCanvaExtractor, CanvaApiProvider };
export * from './canvaTypes.js';
