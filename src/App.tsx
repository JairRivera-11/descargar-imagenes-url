import { useState, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { 
  Play, 
  Download, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Clock, 
  AlertCircle,
  Folder,
  SlidersHorizontal,
  Search,
  RotateCw,
  Edit2,
  Check,
  FolderTree,
  FileArchive,
  Layers,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FolderExtractionMode, 
  parseUrlLine, 
  sanitizeFilename, 
  sanitizeFolderName 
} from './utils/urlParser';
import { isCanvaUrl } from './utils/canvaDetector';
import { CanvaPreviewModal } from './components/CanvaPreviewModal';
import { CanvaImage } from '../services/canva/canvaTypes';
import { apiUrl } from './config/api';

type ItemStatus = 'pending' | 'fetching' | 'done' | 'error';

interface DownloadItem {
  id: string;
  url: string;
  folder: string;
  status: ItemStatus;
  filename?: string;
  error?: string;
  blob?: Blob;
  sourceType: 'direct' | 'canva';
  canvaImages?: CanvaImage[];
  canvaTitle?: string;
  canvaFinalUrl?: string;
}

export default function App() {
  const [urlsInput, setUrlsInput] = useState('');
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<number>(0);
  
  // Configuraciones de descarga y organización
  const [folderMode, setFolderMode] = useState<FolderExtractionMode>('parent_dir');
  const [concurrency, setConcurrency] = useState<number>(4);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string>('ALL');
  const [showSettings, setShowSettings] = useState(false);

  // Edición rápida de carpeta para un ítem
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingFolderValue, setEditingFolderValue] = useState('');

  // Modal para vista previa y descarga de Canva
  const [activeCanvaItem, setActiveCanvaItem] = useState<DownloadItem | null>(null);

  // AbortController para cancelar descargas en marcha
  const abortControllerRef = useRef<AbortController | null>(null);

  // Detectar si el texto actual contiene enlaces de Canva
  const hasCanvaInInput = useMemo(() => {
    if (!urlsInput.trim()) return false;
    return urlsInput.split('\n').some(line => isCanvaUrl(line.trim()));
  }, [urlsInput]);

  // Parsear texto del textarea
  const handleLoadUrls = () => {
    if (!urlsInput.trim()) return;
    
    const lines = urlsInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    const newItems: DownloadItem[] = lines.map((line) => {
      const parsed = parseUrlLine(line, folderMode);
      return {
        id: Math.random().toString(36).substring(2, 9),
        url: parsed.url,
        folder: parsed.folder,
        sourceType: parsed.sourceType,
        status: parsed.error ? 'error' : 'pending',
        error: parsed.error
      };
    });

    setItems(newItems);
  };

  // Re-aplicar modo de carpetas a los ítems existentes
  const handleReapplyFolderMode = (newMode: FolderExtractionMode) => {
    setFolderMode(newMode);
    setItems(prevItems => prevItems.map(item => {
      if (item.sourceType === 'canva') return item;
      const parsed = parseUrlLine(item.url, newMode);
      return {
        ...item,
        folder: parsed.folder
      };
    }));
  };

  // Importar imágenes de Canva seleccionadas directamente a la cola principal
  const handleImportCanvaImagesToQueue = (canvaImages: CanvaImage[], targetFolder: string) => {
    const cleanFolder = sanitizeFolderName(targetFolder);
    const newItems: DownloadItem[] = canvaImages.map(img => ({
      id: Math.random().toString(36).substring(2, 9),
      url: img.url,
      folder: cleanFolder,
      sourceType: 'direct',
      status: 'pending',
      filename: img.filename
    }));

    setItems(prev => [...prev, ...newItems]);
  };

  // Procesamiento concurrente de descargas
  const processDownloads = async () => {
    if (items.length === 0) return;
    setIsProcessing(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Mapa local de ítems, indexado por id, para no depender del estado
    // `items` de React (que queda "congelado" dentro de este closure
    // mientras el procesamiento está en curso).
    const itemsById = new Map<string, DownloadItem>(items.map(item => [item.id, item]));

    // Obtener los IDs que deben procesarse (pendientes o con error que tengan URL válida)
    const queue = items
      .filter(item => (item.status === 'pending' || item.status === 'error') && item.url.startsWith('http'))
      .map(item => item.id);

    // Reiniciar estado visual a 'pending' para los seleccionados
    setItems(prev => prev.map(item => queue.includes(item.id) ? { ...item, status: 'pending', error: undefined } : item));

    let queueIndex = 0;

    // Función que descarga/procesa un ítem individual
    const downloadNext = async () => {
      while (queueIndex < queue.length) {
        if (signal.aborted) break;
        const currentId = queue[queueIndex++];
        if (!currentId) break;

        const currentItem = itemsById.get(currentId);
        if (!currentItem) continue;

        // Cambiar a fetching
        setItems(prev => prev.map(p => p.id === currentId ? { ...p, status: 'fetching', error: undefined } : p));

        // FLUJO CANVA
        if (currentItem.sourceType === 'canva' || isCanvaUrl(currentItem.url)) {
          try {
            const res = await fetch(apiUrl('/api/canva'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: currentItem.url }),
              signal
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
              throw new Error(data.error || 'Error al analizar el enlace de Canva');
            }

            const canvaImages: CanvaImage[] = data.images || [];

            // Nombrar la carpeta del ZIP igual que el diseño de Canva (ej.
            // "CC-9011299-WW"), en vez del genérico "canva", salvo que el
            // usuario ya haya definido una carpeta personalizada con el
            // prefijo "Carpeta | url".
            const folder = data.title && currentItem.folder === 'canva'
              ? sanitizeFolderName(data.title)
              : currentItem.folder;

            setItems(prev => prev.map(p => p.id === currentId ? {
              ...p,
              status: 'done',
              folder,
              canvaImages,
              canvaTitle: data.title || 'Diseño de Canva',
              canvaFinalUrl: data.finalUrl || currentItem.url,
              filename: `${canvaImages.length} imágenes extraídas`
            } : p));

            // Si es la única URL pegada, abrir modal para facilitar la revisión/selección
            if (queue.length === 1 && canvaImages.length > 0) {
              setActiveCanvaItem({
                ...currentItem,
                folder,
                canvaImages,
                canvaTitle: data.title,
                canvaFinalUrl: data.finalUrl
              });
            }

          } catch (error: any) {
            if (error.name === 'AbortError') break;
            setItems(prev => prev.map(p => p.id === currentId ? {
              ...p,
              status: 'error',
              error: error.message || 'Error al procesar Canva'
            } : p));
          }
          continue;
        }

        // FLUJO DIRECTO EXISTENTE (con validación de Content-Type)
        try {
          const res = await fetch(apiUrl(`/api/proxy?url=${encodeURIComponent(currentItem.url)}`), { signal });

          if (!res.ok) {
            let errorMsg = `Error HTTP ${res.status}`;
            try {
              const errorData = await res.json();
              if (errorData.error) errorMsg = errorData.error;
            } catch {
              // Ignore json error
            }
            throw new Error(errorMsg);
          }

          const blob = await res.blob();
          // Si el ítem ya trae un nombre conocido (p.ej. imágenes extraídas
          // de Canva, con su propio filename descriptivo), respetarlo en vez
          // de usar el que el proxy deriva de la URL de origen.
          let filename = currentItem.filename;

          if (!filename) {
            const encodedFilename = res.headers.get('X-Suggested-Filename');
            if (encodedFilename) {
              try {
                filename = atob(encodedFilename);
              } catch {
                // fallback
              }
            }
          }

          filename = filename || 'downloaded_file';

          setItems(prev => prev.map(p => p.id === currentId ? {
            ...p,
            status: 'done',
            blob,
            filename: sanitizeFilename(filename)
          } : p));

        } catch (error: any) {
          if (error.name === 'AbortError') break;
          setItems(prev => prev.map(p => p.id === currentId ? {
            ...p,
            status: 'error',
            error: error.message || 'Error de descarga'
          } : p));
        }
      }
    };

    // Lanzar n workers concurrentes
    const workersCount = Math.min(concurrency, queue.length);
    const workers = Array.from({ length: workersCount }, () => downloadNext());
    await Promise.all(workers);

    setIsProcessing(false);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);
  };

  const clearAll = () => {
    setItems([]);
    setUrlsInput('');
    setSearchFilter('');
    setSelectedFolderFilter('ALL');
  };

  const downloadSingleFile = (item: DownloadItem) => {
    if (!item.blob || !item.filename) return;
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Guardar cambio manual de carpeta
  const handleSaveItemFolder = (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, folder: sanitizeFolderName(editingFolderValue) } : item));
    setEditingItemId(null);
  };

  // Agrega un archivo al ZIP dentro de su carpeta, evitando colisiones de nombre
  const addFileToZip = (zip: JSZip, pathCounts: Record<string, number>, folder: string, filename: string, blob: Blob) => {
    const folderPrefix = folder ? `${sanitizeFolderName(folder)}/` : '';
    const fullPath = `${folderPrefix}${filename}`;

    if (pathCounts[fullPath]) {
      const extMatch = filename.match(/\.[0-9a-z]+$/i);
      const ext = extMatch ? extMatch[0] : '';
      const base = extMatch ? filename.slice(0, -ext.length) : filename;
      const uniqueFilename = `${base} (${pathCounts[fullPath]})${ext}`;
      pathCounts[fullPath]++;
      zip.file(`${folderPrefix}${uniqueFilename}`, blob);
    } else {
      pathCounts[fullPath] = 1;
      zip.file(fullPath, blob);
    }
  };

  // Descargar ZIP completo organizado en carpetas (imágenes directas + Canva)
  const triggerDownloadZip = async () => {
    const doneDirectItems = items.filter(item => item.status === 'done' && item.sourceType === 'direct' && item.blob);
    const doneCanvaItems = items.filter(item => item.status === 'done' && item.sourceType === 'canva' && item.canvaImages && item.canvaImages.length > 0);
    const totalCanvaImages = doneCanvaItems.reduce((acc, item) => acc + (item.canvaImages?.length || 0), 0);

    if (doneDirectItems.length === 0 && totalCanvaImages === 0) return;

    setIsZipping(true);
    setZipProgress(0);

    const zip = new JSZip();
    const pathCounts: Record<string, number> = {};

    doneDirectItems.forEach(item => {
      addFileToZip(zip, pathCounts, item.folder, item.filename || 'image', item.blob!);
    });

    // Las imágenes de Canva no se descargan al analizarlas, solo se detectan.
    // Se obtienen aquí, al generar el ZIP, para no requerir que el usuario
    // abra el modal de vista previa y las importe manualmente.
    let fetchedCanvaImages = 0;
    for (const item of doneCanvaItems) {
      for (const img of item.canvaImages!) {
        try {
          const res = await fetch(apiUrl(`/api/proxy?url=${encodeURIComponent(img.url)}`));
          if (res.ok) {
            const blob = await res.blob();
            addFileToZip(zip, pathCounts, item.folder, img.filename, blob);
          }
        } catch {
          // Ignorar fallos individuales para no abortar el ZIP completo
        }
        fetchedCanvaImages++;
        if (totalCanvaImages > 0) {
          setZipProgress(Math.round((fetchedCanvaImages / totalCanvaImages) * 50));
        }
      }
    }

    try {
      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, (metadata) => {
        const base = totalCanvaImages > 0 ? 50 : 0;
        const scale = totalCanvaImages > 0 ? 0.5 : 1;
        setZipProgress(base + Math.round(metadata.percent * scale));
      });

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `descargas_organizadas_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error generando ZIP", e);
      alert("Ocurrió un error al generar el archivo ZIP.");
    } finally {
      setIsZipping(false);
      setZipProgress(0);
    }
  };

  // Carpetas únicas detectadas y estadísticas
  const uniqueFolders = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      if (i.folder) set.add(i.folder);
    });
    return Array.from(set).sort();
  }, [items]);

  // Filtrado de la tabla
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = searchFilter === '' || 
        item.url.toLowerCase().includes(searchFilter.toLowerCase()) || 
        (item.filename && item.filename.toLowerCase().includes(searchFilter.toLowerCase())) ||
        item.folder.toLowerCase().includes(searchFilter.toLowerCase());

      const matchesFolder = selectedFolderFilter === 'ALL' || item.folder === selectedFolderFilter;

      return matchesSearch && matchesFolder;
    });
  }, [items, searchFilter, selectedFolderFilter]);

  // Cálculos de progreso
  const totalItems = items.length;
  const processedItems = items.filter(i => i.status === 'done' || i.status === 'error').length;
  const successItems = items.filter(i => i.status === 'done').length;
  const errorItems = items.filter(i => i.status === 'error').length;
  const directDoneItems = items.filter(i => i.status === 'done' && i.blob).length;
  const canvaDoneImagesCount = items
    .filter(i => i.status === 'done' && i.sourceType === 'canva')
    .reduce((acc, i) => acc + (i.canvaImages?.length || 0), 0);
  const zippableCount = directDoneItems + canvaDoneImagesCount;
  const progressPercent = totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0;

  return (
    <div className="min-h-screen h-screen bg-[#0c0e12] text-slate-300 font-sans flex flex-col overflow-hidden">
      
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 sm:px-8 border-b border-slate-800 bg-[#0f1116] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-900/30">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Mass URL Downloader</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-semibold">
                Multi-Folder & Canva Support
              </span>
            </div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
              Bulk Direct Images & Canva Resource Extractor (~300+ URLs)
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border ${
              showSettings 
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Configurar Carpetas & Concurrencia</span>
          </button>
        </div>
      </header>

      {/* Settings Drawer / Panel opcional */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-slate-800 bg-[#12161f] px-6 py-4 overflow-hidden shrink-0"
          >
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-xs">
              
              {/* Opción de extracción de carpetas */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <FolderTree className="w-4 h-4 text-indigo-400" />
                  Método para obtener el nombre de la carpeta:
                </label>
                <select
                  value={folderMode}
                  onChange={(e) => handleReapplyFolderMode(e.target.value as FolderExtractionMode)}
                  className="w-full bg-[#0c0e12] border border-slate-700 text-slate-200 rounded-md p-2 outline-none focus:border-indigo-500 font-mono"
                >
                  <option value="parent_dir">Directorio padre en URL (ej: /categoria/foto.jpg ➔ categoria)</option>
                  <option value="full_path">Ruta completa de carpetas (ej: /galeria/categoria/foto.jpg)</option>
                  <option value="line_prefix">Prefijo en la línea (Formato: MiCarpeta | https://url)</option>
                  <option value="domain">Por Dominio / Host (ej: cdn.sitio.com)</option>
                  <option value="none">Sin carpetas (Guardar todos en la raíz)</option>
                </select>
                <p className="text-[11px] text-slate-500">
                  Detecta automáticamente la subcarpeta para estructurar el archivo ZIP. Las URLs de Canva se organizan en /canva por defecto.
                </p>
              </div>

              {/* Descargas concurrentes */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <RotateCw className="w-4 h-4 text-indigo-400" />
                  Descargas concurrentes (Velocidad para ~300 URLs):
                </label>
                <div className="flex items-center gap-2">
                  {[1, 3, 5, 8].map(num => (
                    <button
                      key={num}
                      onClick={() => setConcurrency(num)}
                      className={`flex-1 py-1.5 rounded-md font-mono text-xs border transition-colors ${
                        concurrency === num 
                          ? 'bg-indigo-600 text-white border-indigo-500 font-bold' 
                          : 'bg-[#0c0e12] text-slate-400 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {num} {num === 1 ? 'paralela' : 'paralelas'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  Recomendado 4 o 5 descargas simultáneas para procesar lotes rápidamente.
                </p>
              </div>

              {/* Tips de formato */}
              <div className="space-y-1.5 bg-[#0c0e12] p-3 rounded-md border border-slate-800">
                <span className="font-semibold text-indigo-300">Formatos admitidos en la lista:</span>
                <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                  • Imagen directa: <code className="text-slate-300">https://sitio.com/zapatos/01.jpg</code><br/>
                  • Enlace Canva: <code className="text-teal-300">https://canva.link/gl4b49vlgkaa21h</code><br/>
                  • Con carpeta: <code className="text-slate-300">Zapatos | https://sitio.com/img.jpg</code>
                </p>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-grow flex flex-col lg:flex-row p-6 gap-6 overflow-hidden">
        
        {/* Left Column: Input */}
        <section className="w-full lg:w-1/3 flex flex-col gap-4 h-full shrink-0">
          <div className="flex flex-col h-full bg-[#151921] rounded-xl border border-slate-800 p-5 shadow-2xl overflow-hidden">
            
            <div className="flex items-center justify-between mb-3 shrink-0">
              <label className="text-sm font-semibold text-slate-400 flex items-center gap-2">
                <span>Lista de URLs (Una por línea)</span>
              </label>
              <div className="flex items-center gap-2">
                {hasCanvaInInput && (
                  <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Canva detectado
                  </span>
                )}
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-indigo-400 font-mono font-semibold">
                  {urlsInput.trim() ? urlsInput.split('\n').filter(l => l.trim()).length : 0} detectadas
                </span>
              </div>
            </div>

            <textarea 
              className="flex-grow bg-[#0c0e12] border border-slate-800 rounded-lg p-4 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500/50 resize-none leading-relaxed"
              placeholder={`Pega aquí tus URLs directas o enlaces de Canva:\n\nhttps://tienda.com/productos/zapatos/nike-air.jpg\nhttps://canva.link/gl4b49vlgkaa21h\nhttps://www.canva.com/design/DAF...\n\nOpcional con carpeta personalizada:\nCalzado | https://cdn.com/foto.jpg`}
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              disabled={isProcessing}
            />

            {/* Aviso inteligente de Canva */}
            {hasCanvaInInput && (
              <div className="mt-2 p-2.5 bg-teal-950/20 border border-teal-800/30 rounded-lg text-[11px] text-teal-300 flex items-start gap-2">
                <Layers className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Módulo Canva activo:</strong> Se detectaron enlaces de Canva. El sistema extraerá automáticamente las imágenes útiles mediante Playwright sin descargar páginas HTML.
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 shrink-0">
              <button 
                onClick={handleLoadUrls}
                disabled={isProcessing || urlsInput.trim().length === 0}
                className={`px-4 py-2 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
                  hasCanvaInInput 
                    ? 'bg-teal-600 hover:bg-teal-500 shadow-[0_4px_14px_0_rgba(20,184,166,0.35)]' 
                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_4px_14px_0_rgba(99,102,241,0.39)]'
                }`}
              >
                {hasCanvaInInput ? 'Cargar URLs & Analizar Canva' : 'Cargar URLs & Organizar'}
              </button>

              {items.length > 0 && (
                <button 
                  onClick={clearAll}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-medium rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 border border-rose-500/20"
                >
                  <Trash2 className="w-4 h-4" />
                  Limpiar
                </button>
              )}
            </div>

            <div className="mt-3 p-3 bg-indigo-950/20 border border-indigo-900/30 rounded-lg shrink-0">
              <p className="text-[11px] text-indigo-300 leading-normal flex items-start gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Descarga Organizada:</strong> Las imágenes directas y las extraídas de Canva se empaquetan en sus respectivas carpetas dentro del ZIP.
                </span>
              </p>
            </div>

          </div>
        </section>

        {/* Right Column: Progress, Filter & Table */}
        <section className="w-full lg:w-2/3 flex flex-col gap-4 overflow-hidden h-full">
          {items.length > 0 ? (
            <>
              {/* Progress & Controls Card */}
              <div className="bg-[#151921] rounded-xl border border-slate-800 p-5 shadow-lg shrink-0">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">
                      Progreso de Descarga / Extracción
                    </p>
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-2xl font-mono text-white leading-none">
                        {progressPercent}%
                      </h2>
                      <span className="text-xs font-mono text-slate-400">
                        ({processedItems} de {totalItems} procesadas)
                      </span>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {!isProcessing ? (
                      <button 
                        onClick={processDownloads}
                        disabled={processedItems === totalItems && errorItems === 0}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md shadow-[0_4px_14px_0_rgba(99,102,241,0.39)] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Play className="w-4 h-4" />
                        {processedItems > 0 && errorItems > 0 
                          ? 'Reintentar errores' 
                          : processedItems > 0 
                            ? 'Continuar' 
                            : 'Iniciar Descargas & Extracción'}
                      </button>
                    ) : (
                      <button 
                        onClick={handleStop}
                        className="px-4 py-2 bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
                      >
                        <XCircle className="w-4 h-4" />
                        Detener ({processedItems}/{totalItems})
                      </button>
                    )}

                    <button
                      onClick={triggerDownloadZip}
                      disabled={zippableCount === 0 || isProcessing || isZipping}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-400 text-sm font-medium rounded-md border border-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Descargar todas las imágenes listas (directas y de Canva) organizadas en carpetas dentro del ZIP"
                    >
                      {isZipping ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Comprimiendo ({zipProgress}%)</span>
                        </>
                      ) : (
                        <>
                          <FileArchive className="w-4 h-4" />
                          <span>Descargar ZIP con Carpetas ({zippableCount})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-900 rounded-full h-2.5 mb-2 overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    className="h-full bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                  />
                </div>

                {/* Metrics */}
                <div className="flex flex-wrap justify-between text-[11px] text-slate-500 font-mono uppercase pt-1 gap-2">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {successItems} Listas
                  </span>
                  <span className="text-rose-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {errorItems} Errores
                  </span>
                  <span>{totalItems - processedItems} Pendientes</span>
                  <span className="text-indigo-400 font-semibold flex items-center gap-1">
                    <Folder className="w-3.5 h-3.5" /> {uniqueFolders.length} Carpetas
                  </span>
                </div>
              </div>

              {/* Filter bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
                
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Buscar por URL, archivo o carpeta..."
                    className="w-full bg-[#151921] border border-slate-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Folder filter dropdown */}
                {uniqueFolders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <select
                      value={selectedFolderFilter}
                      onChange={(e) => setSelectedFolderFilter(e.target.value)}
                      className="bg-[#151921] border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ALL">Todas las carpetas ({uniqueFolders.length})</option>
                      {uniqueFolders.map(folder => (
                        <option key={folder} value={folder}>
                          📁 {folder} ({items.filter(i => i.folder === folder).length})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Table */}
              <div className="bg-[#151921] rounded-xl border border-slate-800 flex-grow overflow-auto flex flex-col shadow-lg relative">
                <table className="w-full text-left border-collapse shrink-0">
                  <thead className="bg-[#1c222d] text-[10px] uppercase text-slate-400 tracking-widest sticky top-0 z-10 shadow-sm border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold w-28">Status</th>
                      <th className="px-4 py-3 font-semibold w-40">Carpeta en ZIP</th>
                      <th className="px-4 py-3 font-semibold">Tipo & Source URL</th>
                      <th className="px-4 py-3 font-semibold w-48">Resultado / Archivo</th>
                      <th className="px-4 py-3 font-semibold text-right w-28">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-slate-800 font-mono text-slate-300">
                    <AnimatePresence>
                      {filteredItems.map((item) => (
                        <motion.tr 
                          key={item.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className={`hover:bg-slate-800/30 transition-colors ${item.status === 'fetching' ? 'bg-indigo-500/5' : ''}`}
                        >
                          {/* Status */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {item.status === 'pending' && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-slate-500 bg-slate-800/50">
                                <Clock className="w-3 h-3" /> PENDIENTE
                              </span>
                            )}
                            {item.status === 'fetching' && (
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border ${
                                item.sourceType === 'canva'
                                  ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
                                  : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                                  item.sourceType === 'canva' ? 'bg-teal-400' : 'bg-indigo-500'
                                }`}></span>
                                {item.sourceType === 'canva' ? 'ANALIZANDO CANVA...' : 'DESCARGANDO'}
                              </span>
                            )}
                            {item.status === 'done' && (
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border ${
                                item.sourceType === 'canva'
                                  ? 'bg-teal-500/10 text-teal-400 border-teal-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              }`}>
                                <CheckCircle2 className="w-3 h-3" /> {item.sourceType === 'canva' ? 'EXTRAÍDO' : 'DESCARGADO'}
                              </span>
                            )}
                            {item.status === 'error' && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                <XCircle className="w-3 h-3" /> ERROR
                              </span>
                            )}
                          </td>

                          {/* Folder Name (Editable in-place) */}
                          <td className="px-4 py-3">
                            {editingItemId === item.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editingFolderValue}
                                  onChange={(e) => setEditingFolderValue(e.target.value)}
                                  className="bg-[#0c0e12] border border-indigo-500 text-xs text-indigo-300 rounded px-1.5 py-0.5 font-mono w-28 outline-none"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveItemFolder(item.id);
                                    if (e.key === 'Escape') setEditingItemId(null);
                                  }}
                                />
                                <button
                                  onClick={() => handleSaveItemFolder(item.id)}
                                  className="p-1 hover:text-emerald-400 text-slate-400"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div 
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingFolderValue(item.folder);
                                }}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800/80 text-indigo-300 hover:border-indigo-500 border border-slate-700 cursor-pointer max-w-[150px] group transition-colors"
                                title="Clic para renombrar carpeta"
                              >
                                <Folder className="w-3 h-3 text-indigo-400 shrink-0" />
                                <span className="truncate text-[11px]">{item.folder || 'general'}</span>
                                <Edit2 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-slate-400 shrink-0" />
                              </div>
                            )}
                          </td>

                          {/* Source URL & Type */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5 max-w-[12rem] sm:max-w-xs md:max-w-md lg:max-w-xs xl:max-w-sm">
                              <div className="flex items-center gap-1.5">
                                {item.sourceType === 'canva' ? (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-teal-500/20 text-teal-300 border border-teal-500/30 font-bold shrink-0">
                                    CANVA
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-800 text-slate-400 font-bold shrink-0">
                                    DIRECT
                                  </span>
                                )}
                                <a 
                                  href={item.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="hover:text-indigo-400 transition-colors truncate text-slate-300" 
                                  title={item.url}
                                >
                                  {item.url}
                                </a>
                              </div>
                              {item.error && (
                                <p className="text-[10px] text-rose-400 mt-0.5 truncate" title={item.error}>
                                  {item.error}
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Target File / Result */}
                          <td className="px-4 py-3 text-slate-400">
                            {item.sourceType === 'canva' && item.canvaImages ? (
                              <div className="text-teal-400 flex items-center gap-1 font-semibold text-xs">
                                <Layers className="w-3.5 h-3.5" />
                                <span>{item.canvaImages.length} imágenes</span>
                              </div>
                            ) : (
                              <div className="max-w-[10rem] truncate" title={item.filename}>
                                {item.filename || '-'}
                              </div>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            {item.sourceType === 'canva' ? (
                              item.status === 'done' && item.canvaImages ? (
                                <button 
                                  onClick={() => setActiveCanvaItem(item)}
                                  className="text-xs text-teal-400 hover:text-teal-300 font-medium hover:underline flex items-center gap-1 ml-auto transition-colors"
                                  title="Abrir vista previa de imágenes de Canva"
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                  <span>Ver ({item.canvaImages.length})</span>
                                </button>
                              ) : item.status === 'fetching' ? (
                                <span className="text-teal-500 text-[10px] uppercase font-semibold">
                                  Extrayendo...
                                </span>
                              ) : (
                                <span className="text-slate-600 text-[10px] uppercase font-semibold">-</span>
                              )
                            ) : item.status === 'done' ? (
                              <button 
                                onClick={() => downloadSingleFile(item)}
                                className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
                                title="Descargar este archivo individualmente"
                              >
                                Guardar
                              </button>
                            ) : item.status === 'fetching' ? (
                              <span className="text-slate-600 text-[10px] cursor-not-allowed uppercase font-semibold tracking-wider">
                                Espere
                              </span>
                            ) : (
                              <span className="text-slate-600 text-[10px] uppercase font-semibold tracking-wider">
                                -
                              </span>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
                <div className="flex-grow bg-[#151921]"></div>
              </div>
            </>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center border border-slate-800 rounded-xl bg-[#151921] border-dashed p-8 text-center">
              <FolderTree className="w-12 h-12 text-slate-700 mb-3" />
              <p className="text-slate-400 text-sm font-medium mb-1">No hay URLs cargadas en la tabla</p>
              <p className="text-slate-600 text-xs max-w-sm">
                Pega tus URLs de imágenes directas o enlaces de Canva en el panel izquierdo y haz clic en cargar para procesarlas.
              </p>
            </div>
          )}
        </section>

      </main>

      {/* Canva Preview & Selection Modal */}
      {activeCanvaItem && (
        <CanvaPreviewModal
          isOpen={!!activeCanvaItem}
          onClose={() => setActiveCanvaItem(null)}
          canvaUrl={activeCanvaItem.url}
          finalUrl={activeCanvaItem.canvaFinalUrl}
          title={activeCanvaItem.canvaTitle}
          images={activeCanvaItem.canvaImages || []}
          onImportToQueue={handleImportCanvaImagesToQueue}
        />
      )}

      {/* Footer Status Bar */}
      <footer className="px-6 py-2.5 sm:px-8 shrink-0 bg-[#0c0e12] border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-500">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Proxy & Canva Extractor Activos
          </span>
          <span className="hidden sm:inline">Concurrencia: {concurrency} workers</span>
          <span className="hidden sm:inline">Modo Carpetas: {folderMode}</span>
        </div>
        <div>
          <span>{totalItems} URLs en lista</span>
        </div>
      </footer>

    </div>
  );
}
