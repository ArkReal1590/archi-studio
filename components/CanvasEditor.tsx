/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser, RotateCcw, Pencil, Hand, Search, ZoomIn, Trash2, Highlighter, Undo2, Redo2 } from 'lucide-react';

interface CanvasEditorProps {
  baseImage: string;
  onUpdate: (newImageData: string) => void;
}

type Tool = 'pencil' | 'marker' | 'eraser' | 'pan';

const MAX_UNDO_STEPS = 20;

export const CanvasEditor: React.FC<CanvasEditorProps> = ({ baseImage, onUpdate }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>('marker'); // Default to marker for "Rough" workflow
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  // Undo/Redo stacks stored in refs to avoid stale closures
  const undoStackRef = useRef<ImageData[]>([]);
  const redoStackRef = useRef<ImageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // RAF ref for drawing debounce
  const rafRef = useRef<number | null>(null);
  const pendingPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!baseImage) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = baseImage;
    img.onload = () => {
      setImgElement(img);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      // Reset undo/redo on new image
      undoStackRef.current = [];
      redoStackRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
      if (canvasRef.current) {
        canvasRef.current.width = img.width;
        canvasRef.current.height = img.height;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
        onUpdate(baseImage);
      }
    };
    img.onerror = () => {
      console.error("Failed to load base image in editor");
    };
  }, [baseImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_UNDO_STEPS) undoStackRef.current.shift();
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || undoStackRef.current.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Save current state to redo stack
    redoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    // Restore previous state
    const snapshot = undoStackRef.current.pop()!;
    ctx.putImageData(snapshot, 0, 0);
    triggerUpdate();
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const redo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Save current state to undo stack
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    // Restore redo state
    const snapshot = redoStackRef.current.pop()!;
    ctx.putImageData(snapshot, 0, 0);
    triggerUpdate();
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
      // Ctrl+Z = undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      // Ctrl+Y or Ctrl+Shift+Z = redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); redo(); }
    };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control') setIsCtrlPressed(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [undo, redo]);

  const triggerUpdate = () => {
    if (!canvasRef.current || !imgElement || !imgElement.complete || imgElement.naturalWidth === 0) return;
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgElement.width;
      tempCanvas.height = imgElement.height;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(imgElement, 0, 0);
        tCtx.drawImage(canvasRef.current, 0, 0);
        onUpdate(tempCanvas.toDataURL());
      }
    } catch (e) {
      console.error("Canvas update failed (likely tainted canvas)", e);
    }
  };

  const getClientCoordinates = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if ('touches' in e && e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    if ('clientX' in e) {
      return { clientX: e.clientX, clientY: e.clientY };
    }
    return { clientX: 0, clientY: 0 };
  };

  const getLocalCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const { clientX, clientY } = getClientCoordinates(e);
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = (clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (clientY - rect.top) * (canvasRef.current.height / rect.height);
    return { x, y };
  };

  const safePreventDefault = (e: React.SyntheticEvent | Event) => {
    if (e.cancelable && !e.defaultPrevented) {
      e.preventDefault();
    }
  };

  const startAction = (e: React.MouseEvent | React.TouchEvent) => {
    try {
      const isMiddleClick = 'button' in e && e.button === 1;
      const isHandActive = tool === 'pan' || isMiddleClick || ('altKey' in e && e.altKey) || ('ctrlKey' in e && e.ctrlKey) || isCtrlPressed;

      if (isHandActive) {
        safePreventDefault(e);
        setIsPanning(true);
        const { clientX, clientY } = getClientCoordinates(e);
        setStartPan({ x: clientX - offset.x, y: clientY - offset.y });
        return;
      }

      if (tool === 'pencil' || tool === 'eraser' || tool === 'marker') {
        // Save snapshot for undo before starting a new stroke
        saveSnapshot();
        setIsDrawing(true);
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !imgElement) return;
        const { x, y } = getLocalCoordinates(e);
        ctx.beginPath();
        ctx.moveTo(x, y);

        if (tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 1;
          ctx.lineWidth = Math.max(10, imgElement.width / 50);
        } else if (tool === 'marker') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = '#ef4444'; // Red-500
          ctx.globalAlpha = 0.5;
          const baseUnit = Math.max(1, imgElement.width / 2000);
          ctx.lineWidth = baseUnit * strokeWidth * 4;
        } else {
          // Pencil
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = '#dc2626'; // Red-600
          ctx.globalAlpha = 1;
          const baseUnit = Math.max(1, imgElement.width / 2000);
          ctx.lineWidth = baseUnit * strokeWidth;
        }
      }
    } catch (err) {
      console.error("Error in startAction", err);
    }
  };

  const moveAction = (e: React.MouseEvent | React.TouchEvent) => {
    try {
      if (isPanning) {
        safePreventDefault(e);
        const { clientX, clientY } = getClientCoordinates(e);
        setOffset({ x: clientX - startPan.x, y: clientY - startPan.y });
        return;
      }
      if (isDrawing && canvasRef.current) {
        safePreventDefault(e);
        const { x, y } = getLocalCoordinates(e);
        pendingPoint.current = { x, y };

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (!pendingPoint.current || !canvasRef.current) return;
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) return;
            ctx.lineTo(pendingPoint.current.x, pendingPoint.current.y);
            ctx.stroke();
            pendingPoint.current = null;
          });
        }
      }
    } catch {
      // Suppress logs for move events to avoid spam
    }
  };

  const stopAction = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (isDrawing) { setIsDrawing(false); triggerUpdate(); }
    setIsPanning(false);
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    try {
      if (e.altKey) {
        safePreventDefault(e);
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.min(Math.max(0.1, scale + scale * delta * 5), 10);
        setScale(newScale);
      }
    } catch (err) {
      console.error("Error in handleWheel", err);
    }
  }, [scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) container.addEventListener('wheel', handleWheel, { passive: false });
    return () => { if (container) container.removeEventListener('wheel', handleWheel); };
  }, [handleWheel]);

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    saveSnapshot();
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); triggerUpdate(); }
  };

  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const isHandCursor = tool === 'pan' || isPanning || isCtrlPressed;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 bg-white p-1 rounded-full border border-zinc-200 w-fit mx-auto mb-1 overflow-x-auto max-w-full shadow-sm">
        <button onClick={() => setTool('marker')} className={`p-2 rounded-full transition-colors ${tool === 'marker' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`} title="Feutre / Marker (Zone Rouge)">
          <Highlighter size={16} />
        </button>
        <button onClick={() => setTool('pencil')} className={`p-2 rounded-full transition-colors ${tool === 'pencil' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`} title="Crayon (Détail)">
          <Pencil size={16} />
        </button>
        <button onClick={() => setTool('eraser')} className={`p-2 rounded-full transition-colors ${tool === 'eraser' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`} title="Gomme">
          <Eraser size={16} />
        </button>
        <div className="w-px h-5 bg-zinc-200 mx-1"></div>
        {(tool === 'pencil' || tool === 'marker') && (
          <div className="flex items-center gap-2 px-2">
            <span className="text-[10px] text-zinc-400 font-medium whitespace-nowrap">Taille</span>
            <input type="range" min="1" max="20" step="1" value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="w-20 h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900" />
          </div>
        )}
        <div className="w-px h-5 bg-zinc-200 mx-1"></div>
        <button
          onClick={undo}
          disabled={!canUndo}
          className={`p-2 rounded-full transition-colors ${canUndo ? 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100' : 'text-zinc-200 cursor-not-allowed'}`}
          title="Annuler (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={`p-2 rounded-full transition-colors ${canRedo ? 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100' : 'text-zinc-200 cursor-not-allowed'}`}
          title="Rétablir (Ctrl+Y)"
        >
          <Redo2 size={16} />
        </button>
        <div className="w-px h-5 bg-zinc-200 mx-1"></div>
        <button onClick={() => setTool('pan')} className={`p-2 rounded-full transition-colors ${tool === 'pan' || isCtrlPressed ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}`} title="Déplacer (Ou Maintenir Ctrl)">
          <Hand size={16} />
        </button>
        <button onClick={resetView} className="p-2 rounded-full transition-colors text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100" title="Réinitialiser la vue">
          <Search size={16} />
        </button>
        <button onClick={clearCanvas} className="p-2 rounded-full transition-colors text-red-500 hover:text-red-600 hover:bg-red-50" title="Tout effacer">
          <Trash2 size={16} />
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative w-full h-[500px] bg-zinc-50 rounded-2xl overflow-hidden cursor-crosshair select-none touch-none shadow-inner"
        onMouseDown={startAction} onMouseMove={moveAction} onMouseUp={stopAction} onMouseLeave={stopAction} onTouchStart={startAction} onTouchMove={moveAction} onTouchEnd={stopAction}
        style={{ cursor: isHandCursor ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair' }}
      >
        <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="transition-transform duration-75 ease-linear will-change-transform">
          {imgElement && (
            <div style={{ width: imgElement.width, height: imgElement.height, position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
              <img src={baseImage} className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" alt="Base" />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            </div>
          )}
          {!imgElement && <div className="text-zinc-400 flex items-center gap-2"><ZoomIn className="animate-pulse" /> Chargement...</div>}
        </div>
        <div className="absolute bottom-3 right-3 px-3 py-1.5 bg-white/80 backdrop-blur rounded-full text-[10px] text-zinc-500 font-medium pointer-events-none border border-zinc-200 shadow-sm">
          Zoom: Alt+Molette | Pan: Ctrl+Clic
        </div>
        <div className="absolute top-3 right-3 px-3 py-1.5 bg-white/80 backdrop-blur rounded-lg text-xs font-semibold text-red-500 pointer-events-none border border-red-100 shadow-sm flex items-center gap-2">
          <Highlighter size={12} /> Zone Rouge = Retouche
        </div>
      </div>
    </div>
  );
};
