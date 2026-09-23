export interface CanvaImage {
  id: string;
  url: string;
  contentType: string;
  size?: number; // en bytes
  width?: number;
  height?: number;
  filename: string;
  sha256?: string;
  thumbnailUrl?: string;
}

export interface CanvaExtractOptions {
  timeoutMs?: number;
  minImageSizeBytes?: number;
  maxImages?: number;
}

export interface CanvaExtractResult {
  success: boolean;
  finalUrl: string;
  title?: string;
  images: CanvaImage[];
  error?: string;
  requiresAuth?: boolean;
}

export interface ICanvaExtractor {
  extract(url: string, options?: CanvaExtractOptions): Promise<CanvaExtractResult>;
}
