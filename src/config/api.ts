// En desarrollo (npm run dev) el frontend y el backend viven en el mismo
// servidor Express, así que las rutas relativas ("/api/...") funcionan solas.
// En producción en GitHub Pages, el frontend se sirve como sitio estático y
// el backend (Playwright/proxy) vive en otro dominio (ej. Render), por lo que
// hace falta apuntar explícitamente a esa URL vía VITE_API_BASE_URL.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
