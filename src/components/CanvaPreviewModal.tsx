import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { 
  X, 
  Download, 
  CheckSquare, 
  Square, 
  FileArchive, 
  Layers, 
  ExternalLink, 
  Loader2,
  Image as ImageIcon,
  FolderPlus
} from 'lucide-react';
import { CanvaImage } from '../../services/canva/canvaTypes';
import { apiUrl } from '../config/api';

interface CanvaPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  canvaUrl: string;
  finalUrl?: string;
  title?: string;
  images: CanvaImage[];
  onImportToQueue?: (images: CanvaImage[], folderName: string) => void;
}

export function CanvaPreviewModal({
  isOpen,
  onClose,
  canvaUrl,
  finalUrl,
  title,
  images,
  onImportToQueue
}: CanvaPreviewModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(images.map(img => img.id))
  );
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [targetFolder, setTargetFolder] = useState('canva');

  if (!isOpen) return null;

  const allSelected = images.length > 0 && selectedIds.size === images.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < images.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  const toggleItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Descarga individual
  const downloadSingleImage = async (img: CanvaImage) => {
    try {
      const response = await fetch(apiUrl(`/api/proxy?url=${encodeURIComponent(img.url)}`));
      if (!response.ok) throw new Error('Error al descargar');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = img.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      alert(`No se pudo descargar la imagen ${img.filename}`);
    }
  };

  // Descarga múltiple en ZIP: canva-images.zip
  const downloadSelectedZip = async () => {
    const selectedImages = images.filter(img => selectedIds.has(img.id));
    if (selectedImages.length === 0) return;

    setIsZipping(true);
    setZipProgress(0);

    const zip = new JSZip();
    let completed = 0;

    try {
      for (const img of selectedImages) {
        try {
          const res = await fetch(apiUrl(`/api/proxy?url=${encodeURIComponent(img.url)}`));
          if (res.ok) {
            const blob = await res.blob();
            zip.file(img.filename, blob);
          }
        } catch {
          // Ignorar fallos individuales en el paquete
        }
        completed++;
        setZipProgress(Math.round((completed / selectedImages.length) * 50));
      }

      const content = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => {
          setZipProgress(50 + Math.round(meta.percent * 0.5));
        }
      );

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'canva-images.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Ocurrió un error al generar el ZIP de Canva');
    } finally {
      setIsZipping(false);
      setZipProgress(0);
    }
  };

  const handleImport = () => {
    const selected = images.filter(img => selectedIds.has(img.id));
    if (selected.length === 0) return;
    onImportToQueue?.(selected, targetFolder);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-[#151921] border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-[#12161f]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Imágenes Extraídas de Canva
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-teal-500/10 text-teal-400 border border-teal-500/20 font-semibold">
                  {images.length} encontradas
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-lg mt-0.5">
                {title || canvaUrl}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-[#171b24] flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors font-medium"
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-indigo-400" />
              ) : someSelected ? (
                <div className="w-4 h-4 rounded border border-indigo-400 bg-indigo-500/30 flex items-center justify-center">
                  <div className="w-2 h-0.5 bg-white rounded" />
                </div>
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>{allSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}</span>
            </button>

            <span className="text-slate-500 font-mono">
              ({selectedIds.size} de {images.length} seleccionadas)
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5">
            {onImportToQueue && (
              <div className="flex items-center gap-1.5 bg-[#0c0e12] px-2.5 py-1 rounded-md border border-slate-800">
                <span className="text-[11px] text-slate-400">Carpeta:</span>
                <input
                  type="text"
                  value={targetFolder}
                  onChange={(e) => setTargetFolder(e.target.value)}
                  className="bg-transparent text-indigo-300 font-mono text-xs w-24 outline-none"
                  placeholder="canva"
                />
                <button
                  onClick={handleImport}
                  disabled={selectedIds.size === 0}
                  className="ml-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium disabled:opacity-40 flex items-center gap-1"
                  title="Agregar estas imágenes a la lista principal de descargas"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Añadir a lista</span>
                </button>
              </div>
            )}

            <button
              onClick={downloadSelectedZip}
              disabled={selectedIds.size === 0 || isZipping}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium rounded-md transition-colors flex items-center gap-1.5 shadow-[0_2px_10px_rgba(20,184,166,0.3)]"
            >
              {isZipping ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Empaquetando ({zipProgress}%)</span>
                </>
              ) : (
                <>
                  <FileArchive className="w-3.5 h-3.5" />
                  <span>Descargar canva-images.zip ({selectedIds.size})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Image Grid */}
        <div className="p-6 overflow-y-auto flex-grow max-h-[60vh] bg-[#0f1116]">
          {images.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <ImageIcon className="w-12 h-12 mx-auto mb-2 text-slate-700" />
              <p className="text-sm">No se encontraron imágenes útiles en este diseño.</p>
              <p className="text-xs text-slate-600 mt-1">Verifica que el enlace sea público o contenga recursos gráficos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {images.map((img) => {
                const isSelected = selectedIds.has(img.id);
                const formatLabel = img.contentType.replace('image/', '').toUpperCase();

                return (
                  <div
                    key={img.id}
                    onClick={() => toggleItem(img.id)}
                    className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all cursor-pointer bg-[#151921] ${
                      isSelected 
                        ? 'border-teal-500 shadow-md shadow-teal-950/40 ring-1 ring-teal-500/50' 
                        : 'border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100'
                    }`}
                  >
                    {/* Checkbox badge */}
                    <div className="absolute top-2 left-2 z-10">
                      <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-teal-500 text-white' : 'bg-slate-900/80 border border-slate-700 text-transparent'
                      }`}>
                        <CheckSquare className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Image Preview Container */}
                    <div className="aspect-square bg-[#0a0c10] flex items-center justify-center p-2 relative overflow-hidden">
                      <img
                        src={apiUrl(`/api/proxy?url=${encodeURIComponent(img.url)}`)}
                        alt={img.filename}
                        className="max-h-full max-w-full object-contain rounded transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                      
                      {/* Quick Download Overlay */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingleImage(img);
                        }}
                        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-slate-900/90 text-slate-300 hover:text-white hover:bg-teal-600 transition-colors opacity-0 group-hover:opacity-100"
                        title="Descargar este archivo individualmente"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Meta info */}
                    <div className="p-2.5 flex flex-col gap-1 bg-[#151921] border-t border-slate-800/80 font-mono text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-teal-400 font-semibold">
                          {formatLabel}
                        </span>
                        <span className="text-slate-400">
                          {formatBytes(img.size)}
                        </span>
                      </div>
                      <div className="truncate text-slate-300 text-[11px]" title={img.filename}>
                        {img.filename}
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-[#12161f] flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2 truncate max-w-md">
            {finalUrl && (
              <a
                href={finalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-teal-400 flex items-center gap-1 transition-colors truncate"
              >
                <span>Ver en Canva</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Cerrar
          </button>
        </div>

      </motion.div>
    </div>
  );
}
