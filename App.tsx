/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef } from 'react';
import { Wand2, Plus, Trash2, Download, History, Sparkles, RotateCcw, Scan, Menu, X, Check, Home, Hammer, Palette, Building, Map, Cuboid, Lightbulb, Ruler, Link as LinkIcon, Settings2, Cloud, Laptop, ThumbsUp, ThumbsDown, ChevronDown, Grid, Moon, Copy, LogOut, Coins, Loader2 } from 'lucide-react';
import { Button } from './components/Button';
import { FileUploader } from './components/FileUploader';
import { CanvasEditor } from './components/CanvasEditor';
import { generateArchitecturalView, analyzeArchitecturalImage, generateStyleImages, upscaleArchitecturalImage, getHumanReadableError } from './services/geminiService';
import { AppView, LoadingState, TaskType, HistoryItem, HistoryResult } from './types';
import { useApiKey } from './hooks/useApiKey';
import ApiKeyDialog from './components/ApiKeyDialog';
import { useAuth } from './hooks/useAuth';
import LoginScreen from './components/LoginScreen';
import { CREDIT_COSTS, deductCredits, getCreditCost } from './services/credits';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './services/firebase';

// --- Helper: Aspect Ratio Calculator ---
const getClosestAspectRatio = (width: number, height: number): string => {
  if (!width || !height) return "1:1"; // Safety check
  const ratio = width / height;
  const ratios: {[key: string]: number} = {
    "16:9": 16/9,
    "4:3": 4/3,
    "1:1": 1,
    "3:4": 3/4,
    "9:16": 9/16
  };
  
  return Object.keys(ratios).reduce((prev, curr) => 
    Math.abs(ratios[curr] - ratio) < Math.abs(ratios[prev] - ratio) ? curr : prev
  );
};

const getImageDimensions = (src: string): Promise<{width: number, height: number}> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 1024, height: 1024 }); // Fallback
    img.src = src;
  });
};

// --- Intro Animation ---
const IntroSequence = ({ onComplete }: { onComplete: () => void }) => {
  const [phase, setPhase] = useState<'enter' | 'construct' | 'reveal' | 'exit'>('enter');

  useEffect(() => {
    const schedule = [
      { t: 100, fn: () => setPhase('enter') },     
      { t: 1500, fn: () => setPhase('construct') }, 
      { t: 3500, fn: () => setPhase('reveal') },    
      { t: 5500, fn: () => setPhase('exit') },     
      { t: 6300, fn: () => onComplete() }           
    ];
    const timers = schedule.map(s => setTimeout(s.fn, s.t));
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden font-sans select-none bg-zinc-950
      ${phase === 'exit' ? 'animate-[fadeOut_0.8s_ease-out_forwards] pointer-events-none' : ''}
    `}>
      {/* Subtle grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
      {/* Radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05)_0%,transparent_70%)]" />

      <div className="relative z-10 flex flex-col items-center">
         <div className="relative mb-10">
            <div className={`w-20 h-20 rounded-3xl bg-white/10 border border-white/10 flex items-center justify-center transition-all duration-1000 ${phase === 'enter' ? 'opacity-0 scale-75' : 'opacity-100 scale-100'} ${phase === 'reveal' || phase === 'exit' ? 'bg-white/15 shadow-[0_0_60px_rgba(255,255,255,0.1)]' : ''}`}>
              <Home size={36} className="text-white" strokeWidth={1.5} />
            </div>
            {phase === 'construct' && (
              <div className="absolute -top-3 -right-5 animate-bounce">
                <Hammer size={22} className="text-white/40" />
              </div>
            )}
         </div>
         <div className={`text-center transition-all duration-700 ${phase === 'reveal' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tighter mb-3">ARK REAL STUDIO</h1>
            <p className="text-xs text-white/40 font-semibold tracking-[0.5em] uppercase">Suite Architecte IA</p>
         </div>
      </div>
      <div className={`absolute bottom-8 left-0 right-0 text-center transition-opacity duration-1000 ${phase === 'reveal' ? 'opacity-100' : 'opacity-0'}`}>
         <p className="text-white/20 text-[10px] font-medium tracking-widest uppercase">&copy; Marc Antoine Lecomte</p>
      </div>
    </div>
  );
};

// --- Reusable Workspace Component ---

interface WorkspaceProps {
  taskType: TaskType;
  title: string;
  description: string;
  history: HistoryItem[];
  onGenerate: (baseImages: string[], prompt: string, imageSize: string) => Promise<void>;
  onUpscale: (baseImages: string[]) => Promise<void>;
  loading: LoadingState;
  // Global Project Props
  refImages: string[];
  setRefImages: React.Dispatch<React.SetStateAction<string[]>>;
  projectLink: string;
  setProjectLink: (link: string) => void;
  onClearHistory: () => void;
  onFeedback: (batchId: string, resultId: string, feedback: 'like' | 'dislike') => void;
  onDownload: (url: string, filename: string) => void;
  // Auth & Credits
  credits: number;
  isAdmin: boolean;
  uid: string | null;
  onCreditsUpdate: (delta: number) => void;
  // Liens de référence (chargés depuis Firestore)
  interiorLink: string;
  exteriorLink: string;
}

const PROMPT_PRESETS = [
  { label: 'Soleil couchant', value: 'Lumière dorée de fin de journée, ombres longues, ciel chaud orangé-rose' },
  { label: 'Béton brut', value: 'Matériau béton brut avec texture granuleuse, minimalisme brutaliste japonais' },
  { label: 'Nuit urbaine', value: 'Éclairage nocturne, lumières intérieures chaudes, reflets sur sols mouillés' },
  { label: 'Jour nordique', value: 'Lumière diffuse nordique, ciel nuageux uniforme, herbe verte, ambiance scandinave' },
  { label: 'Biophilie', value: 'Végétation luxuriante intégrée, plantes grimpantes, jardin vertical, architecture biophilique' },
];

const ArchitecturalWorkspace: React.FC<WorkspaceProps> = ({
  taskType, title, description, history, onGenerate, onUpscale, loading,
  refImages, setRefImages, projectLink, setProjectLink, onClearHistory, onFeedback, onDownload,
  credits, isAdmin, uid, onCreditsUpdate, interiorLink, exteriorLink
}) => {
  const [baseImages, setBaseImages] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [annotatedImages, setAnnotatedImages] = useState<{[key: number]: string}>({});

  const [prompt, setPrompt] = useState('');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [isDragOverEditor, setIsDragOverEditor] = useState(false);
  const [refMode, setRefMode] = useState<'upload' | 'generate'>('upload');
  const [stylePrompt, setStylePrompt] = useState('');
  const [isGeneratingRefs, setIsGeneratingRefs] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(100);
  const [projectMode, setProjectMode] = useState<'local' | 'online'>(projectLink ? 'online' : 'local');
  const [isNightMode, setIsNightMode] = useState(false);
  const [isUpscaleMode, setIsUpscaleMode] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const showWorkspaceError = (message: string) => {
    setWorkspaceError(message);
    setTimeout(() => setWorkspaceError(null), 6000);
  };

  // Sync mode with projectLink
  useEffect(() => {
    if (projectMode === 'local' && projectLink) {
        setProjectLink('');
    }
  }, [projectMode, projectLink, setProjectLink]);

  const activeBaseImage = baseImages[activeIndex];
  const activeAnnotatedImage = annotatedImages[activeIndex];

  // Auto-select newest history item when a new generation arrives
  useEffect(() => {
    if (history.length > 0) {
      setSelectedHistoryId(history[0].id);
    } else {
      setSelectedHistoryId(null);
    }
  }, [history[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeHistoryBatch = (selectedHistoryId ? history.find(h => h.id === selectedHistoryId) : null) ?? history[0];
  const activeHistoryResult = activeHistoryBatch?.results?.[activeIndex];

  const handleImageInput = (filesOrUrl: File[] | string, isBase: boolean) => {
    const processImage = (src: string) => {
        if (isBase) {
            // NO CROPPING. We use the original image directly.
            // The aspect ratio will be detected dynamically during generation.
            setBaseImages(prev => [...prev, src]);
            setAnalysisResult(null);
        } else {
            setRefImages(prev => [...prev, src].slice(0, 3));
        }
    };

    if (Array.isArray(filesOrUrl)) {
        filesOrUrl.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const res = e.target?.result as string;
                if(res) processImage(res);
            };
            reader.readAsDataURL(file);
        });
    } else if (typeof filesOrUrl === 'string') {
        processImage(filesOrUrl);
    }
  };

  const handleRun = () => {
    if (!prompt && baseImages.length === 0) {
        showWorkspaceError("Veuillez fournir au moins une image ou une instruction.");
        return;
    }
    const imagesToProcess = baseImages.map((img, idx) => annotatedImages[idx] || img);
    
    if (isUpscaleMode) {
        onUpscale(imagesToProcess);
        return;
    }

    let finalPrompt = prompt;
    if (isNightMode) {
        finalPrompt = (finalPrompt ? finalPrompt + " " : "") + "je veux que tu transforme juste la météo et l'éclairage de la scène : lumière d'aube très froide, tirant sur le bleu-gris avec lumière intérieure soft et chaleureuse.";
    }

    onGenerate(imagesToProcess, finalPrompt, imageSize);
  };

  const handleAnalyze = async () => {
    if (!activeBaseImage) return;
    const cost = getCreditCost('analysis');
    if (!isAdmin && credits < cost) {
      showWorkspaceError(`Crédits insuffisants. L'analyse coûte ${cost} crédits, il vous en reste ${credits}.`);
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      const result = await analyzeArchitecturalImage(activeBaseImage, prompt);
      if (!isAdmin && uid) {
        await deductCredits(uid, 'analysis');
        onCreditsUpdate(-cost);
      }
      setAnalysisResult(result);
    } catch (e) {
      console.error(e);
      setAnalysisResult(`Erreur lors de l'analyse : ${getHumanReadableError(e)}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateRefs = async () => {
    if (!stylePrompt) return;
    const cost = getCreditCost('styleGeneration', 3);
    if (!isAdmin && credits < cost) {
      showWorkspaceError(`Crédits insuffisants. Cette action coûte ${cost} crédits, il vous en reste ${credits}.`);
      return;
    }
    setIsGeneratingRefs(true);
    try {
        const images = await generateStyleImages(stylePrompt, 3);
        if (!isAdmin && uid) {
          await deductCredits(uid, 'styleGeneration', 3);
          onCreditsUpdate(-cost);
        }
        setRefImages(prev => [...prev, ...images].slice(0, 3));
        setRefMode('upload');
    } catch (e) {
        console.error(e);
        showWorkspaceError("Impossible de générer les images de référence. Vérifiez votre clé API.");
    } finally {
        setIsGeneratingRefs(false);
    }
  };

  const restoreItem = (item: HistoryItem) => {
    setPrompt(item.prompt);
    setSelectedHistoryId(item.id);
    if (item.results && item.results.length > 0) {
        const restoredBaseImages = item.results.map(r => r.baseImage);
        setBaseImages(restoredBaseImages);
        setAnnotatedImages({});
        setAnalysisResult(null);
        setActiveIndex(0);
    }
    setOverlayOpacity(100);
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverEditor(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImageInput(Array.from(e.dataTransfer.files), true);
        return;
    }

    const imageUrl = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('http'))) {
        handleImageInput(imageUrl, true);
    }
  };

  const removeBaseImage = (index: number) => {
      const newImages = baseImages.filter((_, i) => i !== index);
      const newAnnotated = { ...annotatedImages };
      delete newAnnotated[index];
      const reindexedAnnotated: {[key: number]: string} = {};
      
      Object.keys(annotatedImages).forEach(keyStr => {
          const key = Number(keyStr);
          if (key < index) {
              reindexedAnnotated[key] = annotatedImages[key];
          } else if (key > index) {
              reindexedAnnotated[key - 1] = annotatedImages[key];
          }
      });

      setBaseImages(newImages);
      setAnnotatedImages(reindexedAnnotated);
      if (activeIndex >= newImages.length) setActiveIndex(Math.max(0, newImages.length - 1));
  };

  const taskIcon = {
    material: <Palette size={16} strokeWidth={2} />,
    facade: <Building size={16} strokeWidth={2} />,
    masterplan: <Map size={16} strokeWidth={2} />,
    perspective: <Cuboid size={16} strokeWidth={2} />,
    technical_detail: <Ruler size={16} strokeWidth={2} />,
  }[taskType];

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden animate-fade-in">
      {/* LEFT: Inputs */}
      <div className="w-full lg:w-[480px] xl:w-[520px] bg-white border-r border-zinc-100 flex flex-col overflow-auto scrollbar-hide shadow-[1px_0_0_0_#f4f4f5]">

        {/* Panel Header */}
        <div className="px-7 pt-7 pb-5 border-b border-zinc-100">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="w-8 h-8 rounded-xl bg-zinc-950 flex items-center justify-center text-white flex-shrink-0">
              {taskIcon}
            </div>
            <h2 className="text-xl font-bold text-zinc-900 tracking-tight leading-tight">{title}</h2>
          </div>
          <p className="text-zinc-400 text-xs leading-relaxed pl-11">{description}</p>
        </div>

        <div className="p-7 space-y-5 flex-1">
            
          {/* Project Settings Block */}
          <div className="rounded-2xl border border-zinc-100 overflow-hidden">
             <div className="flex items-center justify-between px-4 py-3 cursor-pointer bg-zinc-50 hover:bg-zinc-100/80 transition-colors" onClick={() => setShowProjectSettings(!showProjectSettings)}>
                <h3 className="text-[11px] font-bold text-zinc-700 uppercase tracking-widest flex items-center gap-2">
                    <Settings2 size={12} className="text-zinc-400"/> Mode & Contexte
                </h3>
                <ChevronDown size={14} className={`text-zinc-400 transition-transform duration-200 ${showProjectSettings ? 'rotate-180' : ''}`} />
             </div>
             
             {showProjectSettings && (
                 <div className="space-y-4 animate-fade-in p-4 border-t border-zinc-100">
                    <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-xl w-full">
                        <button
                            onClick={() => setProjectMode('local')}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${projectMode === 'local' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-700'}`}
                        >
                            <Laptop size={13}/> Local
                        </button>
                        <button
                            onClick={() => setProjectMode('online')}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${projectMode === 'online' ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-400 hover:text-zinc-700'}`}
                        >
                            <Cloud size={13}/> En Ligne
                        </button>
                    </div>

                    {projectMode === 'online' && (
                        <div className="space-y-3 animate-fade-in">
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => { setProjectMode('online'); setProjectLink(interiorLink); }}
                                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${projectLink === interiorLink ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-inner' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <Home size={14} /> Intérieur 3D
                                </button>
                                <button 
                                    onClick={() => { setProjectMode('online'); setProjectLink(exteriorLink); }}
                                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${projectLink === exteriorLink ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-inner' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <Building size={14} /> Extérieur 3D
                                </button>
                            </div>

                            {projectLink !== interiorLink && projectLink !== exteriorLink ? (
                                <div className="flex gap-2 items-center bg-white border border-blue-200 rounded-xl px-3 py-2 shadow-sm">
                                    <LinkIcon size={14} className="text-blue-500 flex-shrink-0" />
                                    <input 
                                        type="text" 
                                        value={projectLink}
                                        onChange={(e) => setProjectLink(e.target.value)}
                                        className="flex-1 bg-transparent text-sm outline-none text-zinc-900 placeholder:text-zinc-400"
                                        placeholder="Ou lien personnalisé..."
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center justify-between bg-blue-50 border border-blue-100 px-3 py-2 rounded-xl">
                                    <span className="text-xs text-blue-700 font-medium flex items-center gap-2 truncate">
                                        <Check size={12}/> 
                                        Source: {projectLink === interiorLink ? 'Bibliothèque Intérieur' : 'Bibliothèque Extérieur'}
                                    </span>
                                    <button onClick={() => setProjectLink('')} className="text-blue-400 hover:text-blue-700 p-1">
                                        <X size={12}/>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2 pt-3 border-t border-zinc-100">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Références <span className="text-zinc-300 font-normal">({refImages.length}/3)</span></span>
                            <div className="flex items-center gap-1 p-0.5 bg-zinc-100 rounded-lg">
                                <button onClick={() => setRefMode('upload')} className={`px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all ${refMode === 'upload' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>Upload</button>
                                <button onClick={() => setRefMode('generate')} className={`px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all ${refMode === 'generate' ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'}`}>IA</button>
                            </div>
                        </div>

                        {refMode === 'generate' ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={stylePrompt}
                                    onChange={(e) => setStylePrompt(e.target.value)}
                                    placeholder="Décrire le style..."
                                    className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                                />
                                <Button size="sm" onClick={handleGenerateRefs} isLoading={isGeneratingRefs} disabled={!stylePrompt} className="px-4 h-auto text-xs">Générer</Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-4 gap-2">
                                {refImages.map((img, i) => (
                                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-100 group bg-white shadow-sm">
                                        <img src={img} className="w-full h-full object-cover" alt="ref" />
                                        <button onClick={() => setRefImages(prev => prev.filter((_, idx) => idx !== i))} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                                {refImages.length < 3 && (
                                    <label className="aspect-square rounded-xl border-2 border-dashed border-zinc-200 flex items-center justify-center hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer transition-all text-zinc-300 hover:text-zinc-500">
                                        <input type="file" className="hidden" onChange={(e) => e.target.files && handleImageInput(Array.from(e.target.files), false)} accept="image/*" />
                                        <Plus size={16} />
                                    </label>
                                )}
                            </div>
                        )}
                    </div>
                 </div>
             )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                Images <span className="text-zinc-300 font-normal">({baseImages.length})</span>
              </span>
              {baseImages.length > 0 && (
                <button onClick={() => { setBaseImages([]); setAnnotatedImages({}); setAnalysisResult(null); }} className="text-zinc-400 hover:text-red-500 text-[10px] flex items-center gap-1 transition-colors">
                  <Trash2 size={11}/> Tout effacer
                </button>
              )}
            </div>
            
            <div 
                onDragOver={(e) => { e.preventDefault(); setIsDragOverEditor(true); }}
                onDragLeave={() => setIsDragOverEditor(false)}
                onDrop={handleContainerDrop}
                className={`relative rounded-2xl transition-all ${isDragOverEditor ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
            >
                {activeBaseImage ? (
                    <>
                        {/* Editor for ACTIVE image */}
                        <CanvasEditor 
                            key={`${activeBaseImage}-${activeIndex}`} // Force remount on change
                            baseImage={activeBaseImage} 
                            onUpdate={(newImg) => setAnnotatedImages(prev => ({...prev, [activeIndex]: newImg}))} 
                        />
                        
                        {/* Thumbnails Strip with Better Deletion */}
                        <div className="flex gap-2 mt-3 overflow-x-auto pb-2 scrollbar-hide">
                            {baseImages.map((img, idx) => (
                                <div 
                                    key={idx}
                                    onClick={() => setActiveIndex(idx)}
                                    className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${activeIndex === idx ? 'border-zinc-900 shadow-md scale-105' : 'border-transparent opacity-80 hover:opacity-100'}`}
                                >
                                    <img src={annotatedImages[idx] || img} className="w-full h-full object-cover" alt={`Base ${idx}`} />
                                    {/* Always visible delete button on hover, or prominent if active */}
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); removeBaseImage(idx); }}
                                        className="absolute top-0 right-0 bg-red-600 text-white p-1 rounded-bl-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 shadow-md"
                                        title="Supprimer cette image"
                                    >
                                        <X size={12} strokeWidth={3} />
                                    </button>
                                </div>
                            ))}
                             <label className="flex-shrink-0 w-16 h-16 rounded-lg border-2 border-dashed border-zinc-200 flex items-center justify-center hover:bg-white hover:border-zinc-400 cursor-pointer transition-colors text-zinc-400 hover:text-zinc-600">
                                <input type="file" className="hidden" multiple onChange={(e) => e.target.files && handleImageInput(Array.from(e.target.files), true)} accept="image/*" />
                                <Plus size={20} />
                             </label>
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-zinc-400 font-mono mt-1">
                            <span>Image {activeIndex + 1}/{baseImages.length}</span>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={handleAnalyze} 
                              disabled={isAnalyzing}
                              className="text-zinc-500 hover:text-zinc-900"
                              icon={<Sparkles size={12} />}
                            >
                                {isAnalyzing ? 'Analyse...' : 'Analyser'}
                            </Button>
                        </div>
                        {analysisResult && (
                          <div className="mt-4 p-4 bg-zinc-50 border border-zinc-100 rounded-2xl text-xs text-zinc-700 shadow-sm animate-fade-in">
                            <h4 className="font-bold mb-2 flex items-center gap-2 text-zinc-900"><Lightbulb size={14} className="text-yellow-500"/> Conseils IA</h4>
                            <div className="whitespace-pre-wrap leading-relaxed">{analysisResult}</div>
                          </div>
                        )}
                    </>
                ) : (
                    <FileUploader 
                        label="Importer ou Glisser vos images ici" 
                        onFileSelect={(files) => handleImageInput(files, true)}
                        onUrlSelect={(url) => handleImageInput(url, true)}
                        multiple={true}
                    />
                )}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Résolution</span>
              <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full font-medium">Format Auto</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {(['1K', '2K', '4K'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setImageSize(size)}
                    className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      imageSize === size
                        ? 'bg-zinc-950 text-white shadow-md shadow-zinc-200'
                        : 'bg-zinc-50 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 border border-zinc-100'
                    }`}
                  >
                    {size}
                  </button>
                ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Instructions</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setIsNightMode(!isNightMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${isNightMode ? 'bg-indigo-950 text-indigo-300 shadow-md' : 'bg-zinc-100 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200'}`}
                >
                  <Moon size={11} className={isNightMode ? "fill-current" : ""}/> Nuit
                </button>
                <button
                  onClick={() => setIsUpscaleMode(!isUpscaleMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${isUpscaleMode ? 'bg-emerald-950 text-emerald-300 shadow-md' : 'bg-zinc-100 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200'}`}
                >
                  <Scan size={11} /> HD
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PROMPT_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setPrompt(p.value)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all ${
                    prompt === p.value
                      ? 'bg-zinc-900 border-zinc-900 text-white'
                      : 'bg-zinc-50 border-zinc-100 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-28 bg-zinc-50 border border-zinc-100 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-zinc-900 focus:bg-white transition-all outline-none text-zinc-900 placeholder:text-zinc-300 resize-none"
              placeholder="Ex: Villa contemporaine, béton blanc, crépuscule..."
            />
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <button
                onClick={handleRun}
                disabled={loading.isGenerating}
                className={`w-full py-4 rounded-2xl text-[15px] font-semibold text-white flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed shadow-xl ${
                  isUpscaleMode
                    ? 'bg-gradient-to-b from-emerald-700 to-emerald-900 shadow-emerald-200 hover:from-emerald-600 hover:to-emerald-800'
                    : 'bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-zinc-200 hover:from-zinc-700 hover:to-zinc-900'
                }`}
            >
                {loading.isGenerating ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-white/80">{loading.message}</span>
                    </>
                ) : (
                    <>
                      {isUpscaleMode ? <Scan size={18}/> : <Wand2 size={18}/>}
                      {isUpscaleMode
                        ? (baseImages.length > 1 ? `Upscale du Lot (${baseImages.length})` : 'Lancer l\'Upscale')
                        : (baseImages.length > 1 ? `Générer le Lot (${baseImages.length})` : 'Générer le Rendu')}
                    </>
                )}
            </button>
            {workspaceError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl px-4 py-3 animate-fade-in">
                <X size={13} className="mt-0.5 flex-shrink-0 cursor-pointer hover:text-red-800" onClick={() => setWorkspaceError(null)} />
                <span>{workspaceError}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MIDDLE: Preview Area */}
      <div className="flex-1 bg-zinc-50 relative flex items-center justify-center p-8 overflow-hidden">
         <div className="absolute inset-0 bg-[radial-gradient(#e4e4e7_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none"></div>

         {loading.isGenerating ? (
            <div className="flex flex-col items-center z-10">
               <div className="relative mb-7">
                 <div className="w-16 h-16 rounded-full border-[3px] border-zinc-200 border-t-zinc-900 animate-spin" />
                 <div className="absolute inset-0 flex items-center justify-center">
                   <Wand2 size={18} className="text-zinc-400 animate-pulse" />
                 </div>
               </div>
               <p className="text-zinc-800 font-semibold text-sm mb-1">{loading.message}</p>
               <p className="text-zinc-400 text-xs">Environ 30 à 60 secondes</p>
            </div>
         ) : history.length > 0 && activeHistoryResult ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center group/preview z-10">
               <div className="relative max-w-full max-h-[85vh] shadow-2xl rounded-xl overflow-hidden border border-zinc-200 bg-white">
                   {activeHistoryResult.baseImage && (
                        <img 
                          src={activeHistoryResult.baseImage} 
                          className="absolute inset-0 w-full h-full object-contain"
                          alt="Base"
                          style={{ opacity: 1 }}
                        />
                   )}
                   <img 
                     src={activeHistoryResult.resultImage} 
                     className="relative w-auto h-auto max-w-full max-h-[85vh] object-contain cursor-grab active:cursor-grabbing" 
                     alt="Result"
                     draggable="true"
                     style={{ opacity: activeHistoryResult.baseImage ? overlayOpacity / 100 : 1 }}
                     onDragStart={(e) => {
                         e.dataTransfer.setData('text/plain', activeHistoryResult.resultImage);
                     }}
                   />
                   
                   {activeHistoryResult.baseImage && (
                       <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/80 backdrop-blur-md px-6 py-3 rounded-full flex items-center gap-4 transition-all opacity-0 group-hover/preview:opacity-100 translate-y-2 group-hover/preview:translate-y-0 shadow-lg border border-white/10">
                           <div className="text-white/70 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">Original</div>
                           <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={overlayOpacity} 
                              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                              className="w-32 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white"
                           />
                           <div className="text-white text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">Rendu ({overlayOpacity}%)</div>
                       </div>
                   )}
               </div>

               <div className="absolute bottom-6 right-8 flex gap-2 opacity-0 group-hover/preview:opacity-100 transition-all transform translate-y-2 group-hover/preview:translate-y-0">
                 <Button
                    variant="secondary"
                    size="sm"
                    icon={copied ? <Check size={16} className="text-green-500"/> : <Copy size={16}/>}
                    className="bg-white/90 backdrop-blur shadow-lg border-transparent text-zinc-900 hover:bg-white"
                    onClick={async () => {
                      try {
                        const res = await fetch(activeHistoryResult.resultImage);
                        const blob = await res.blob();
                        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch (e) { console.error('Copy failed', e); }
                    }}
                 >
                    {copied ? 'Copié !' : 'Copier'}
                 </Button>
                 <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={16}/>}
                    className="bg-white/90 backdrop-blur shadow-lg border-transparent text-zinc-900 hover:bg-white"
                    onClick={() => onDownload(activeHistoryResult.resultImage, `archi-${taskType}`)}
                 >
                    Télécharger
                 </Button>
               </div>
               {/* Pagination for Batch View in Middle Screen if multiple images */}
               {activeHistoryBatch && activeHistoryBatch.results.length > 1 && (
                   <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full shadow-sm border border-zinc-200">
                        {activeHistoryBatch.results.map((_, idx) => (
                            <button 
                                key={idx} 
                                onClick={() => setActiveIndex(idx)}
                                className={`w-2 h-2 rounded-full transition-all ${idx === activeIndex ? 'bg-zinc-900 w-4' : 'bg-zinc-300 hover:bg-zinc-500'}`}
                            />
                        ))}
                   </div>
               )}
            </div>
         ) : (
            <div className="text-center z-10 select-none">
               <div className="relative mx-auto mb-7 w-fit">
                 <div className="w-28 h-28 bg-white rounded-3xl flex items-center justify-center shadow-sm border border-zinc-100">
                   {taskType === 'material' && <Palette size={44} className="text-zinc-200" strokeWidth={1}/>}
                   {taskType === 'facade' && <Building size={44} className="text-zinc-200" strokeWidth={1}/>}
                   {taskType === 'masterplan' && <Map size={44} className="text-zinc-200" strokeWidth={1}/>}
                   {taskType === 'perspective' && <Cuboid size={44} className="text-zinc-200" strokeWidth={1}/>}
                   {taskType === 'technical_detail' && <Ruler size={44} className="text-zinc-200" strokeWidth={1}/>}
                 </div>
                 <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-zinc-900 rounded-xl flex items-center justify-center shadow-md">
                   <Wand2 size={14} className="text-white" />
                 </div>
               </div>
               <p className="font-semibold text-zinc-400 mb-1.5">{title}</p>
               <p className="text-zinc-300 text-sm max-w-[260px] mx-auto leading-relaxed">{description}</p>
            </div>
         )}
      </div>

      {/* RIGHT: History Sidebar */}
      <div className="w-full lg:w-[300px] bg-white border-l border-zinc-100 flex flex-col z-20">
         <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
               <History size={13} className="text-zinc-400"/> Historique
               {history.length > 0 && <span className="text-zinc-300 font-normal">({history.length})</span>}
            </h3>
            {history.length > 0 && (
                <button
                    onClick={onClearHistory}
                    className="text-zinc-300 hover:text-red-400 transition-colors p-1.5 hover:bg-red-50 rounded-lg"
                    title="Tout effacer"
                >
                    <Trash2 size={13} />
                </button>
            )}
         </div>
         <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {history.map((batch) => (
               <div
                 key={batch.id}
                 className="bg-white rounded-2xl overflow-hidden border border-zinc-100 hover:border-zinc-200 hover:shadow-md transition-all"
               >
                   <div
                       className="px-3.5 py-3 flex items-start justify-between cursor-pointer hover:bg-zinc-50 transition-colors"
                       onClick={() => restoreItem(batch)}
                   >
                       <div className="min-w-0 flex-1 pr-2">
                           <div className="flex items-center gap-1.5 mb-1">
                             <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{batch.taskType.replace('_', ' ')} · {batch.results?.length || 0} img</span>
                           </div>
                           <p className="text-xs font-medium text-zinc-700 truncate">{batch.prompt || "Sans titre"}</p>
                           <p className="text-[10px] text-zinc-300 mt-1 font-mono">{new Date(batch.timestamp).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}</p>
                       </div>
                       <RotateCcw size={13} className="text-zinc-300 hover:text-zinc-700 transition-colors flex-shrink-0 mt-0.5" />
                   </div>

                   {/* Results grid */}
                   <div className={`grid gap-px bg-zinc-100 border-t border-zinc-100 ${batch.results && batch.results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                       {batch.results && batch.results.map((result) => (
                           <div key={result.id} className="relative aspect-square group/item bg-white overflow-hidden">
                                <img src={result.resultImage} className="w-full h-full object-cover transition-transform duration-300 group-hover/item:scale-105" alt="result"/>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity" />
                                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between opacity-0 group-hover/item:opacity-100 transition-opacity">
                                    <div className="flex gap-1">
                                      <button
                                          onClick={(e) => { e.stopPropagation(); onFeedback(batch.id, result.id, 'like'); }}
                                          className={`p-1.5 rounded-lg backdrop-blur transition-colors ${result.feedback === 'like' ? 'bg-green-500 text-white' : 'bg-white/90 text-zinc-500 hover:text-green-600'}`}
                                      >
                                          <ThumbsUp size={9} />
                                      </button>
                                      <button
                                          onClick={(e) => { e.stopPropagation(); onFeedback(batch.id, result.id, 'dislike'); }}
                                          className={`p-1.5 rounded-lg backdrop-blur transition-colors ${result.feedback === 'dislike' ? 'bg-red-500 text-white' : 'bg-white/90 text-zinc-500 hover:text-red-500'}`}
                                      >
                                          <ThumbsDown size={9} />
                                      </button>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onDownload(result.resultImage, `archi-render-${batch.taskType}`); }}
                                        className="p-1.5 rounded-lg bg-white/90 backdrop-blur text-zinc-500 hover:text-blue-600 transition-colors"
                                        title="Télécharger"
                                    >
                                        <Download size={9} />
                                    </button>
                                </div>
                           </div>
                       ))}
                   </div>
               </div>
            ))}
            {history.length === 0 && (
               <div className="flex flex-col items-center justify-center h-48 text-zinc-200">
                   <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-zinc-100 flex items-center justify-center mb-3">
                     <Grid size={20} strokeWidth={1.5} className="text-zinc-200"/>
                   </div>
                   <p className="text-xs text-zinc-300 font-medium">Aucune génération</p>
               </div>
            )}
         </div>
      </div>
    </div>
  );
};

const MAX_HISTORY = 20;

const App: React.FC = () => {
  const { user, credits, isAdmin, loading: authLoading, logout, setCredits } = useAuth();
  const [showIntro, setShowIntro] = useState(true);
  const [activeTask, setActiveTask] = useState<TaskType>('perspective');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState<LoadingState>({ isGenerating: false, message: '' });
  const [refImages, setRefImages] = useState<string[]>([]);
  const [projectLink, setProjectLink] = useState('');
  const [appError, setAppError] = useState<string | null>(null);
  const [referenceLinks, setReferenceLinks] = useState({ interior: '', exterior: '' });

  const { showApiKeyDialog, handleApiKeyDialogContinue } = useApiKey();

  // Charger les liens de référence depuis Firestore (protégés)
  useEffect(() => {
    if (!user) return;
    const fetchLinks = async () => {
      try {
        const snap = await getDoc(doc(db, 'config', 'references'));
        if (snap.exists()) {
          const data = snap.data();
          setReferenceLinks({
            interior: data.interiorLink || '',
            exterior: data.exteriorLink || '',
          });
        }
      } catch (e) {
        console.error('Error loading reference links:', e);
      }
    };
    fetchLinks();
  }, [user]);

  const showError = (message: string) => {
    setAppError(message);
    setTimeout(() => setAppError(null), 6000);
  };

  // Handle Generation
  const handleGenerate = async (baseImages: string[], prompt: string, imageSize: string) => {
      // Vérification des crédits
      const totalCost = getCreditCost('generation', baseImages.length);
      if (!isAdmin && credits < totalCost) {
          showError(`Crédits insuffisants. Cette action coûte ${totalCost} crédits, il vous en reste ${credits}.`);
          return;
      }

      setLoading({ isGenerating: true, message: 'Génération en cours...' });

      const batchId = Date.now().toString();
      const results: HistoryResult[] = [];

      try {
          // Process sequentially to avoid rate limits (optional: parallelize if confident)
          for(let i=0; i<baseImages.length; i++) {
              const baseImg = baseImages[i];
              setLoading({ isGenerating: true, message: `Génération image ${i+1}/${baseImages.length}...` });

              // 1. Detect dynamic ratio per image
              const dims = await getImageDimensions(baseImg);
              const dynamicRatio = getClosestAspectRatio(dims.width, dims.height);

              const resultImg = await generateArchitecturalView(
                  activeTask,
                  baseImg,
                  refImages,
                  prompt,
                  dynamicRatio,
                  imageSize,
                  projectLink
              );

              results.push({
                  id: `${batchId}-${i}`,
                  baseImage: baseImg,
                  resultImage: resultImg,
                  feedback: null
              });
          }

          // Déduire les crédits après succès
          if (!isAdmin && user) {
              await deductCredits(user.uid, 'generation', baseImages.length);
              setCredits(prev => prev - totalCost);
          }

          const newItem: HistoryItem = {
              id: batchId,
              taskType: activeTask,
              prompt: prompt,
              timestamp: Date.now(),
              results: results,
              referenceImages: [...refImages]
          };

          setHistory(prev => [newItem, ...prev].slice(0, MAX_HISTORY));

      } catch (error) {
          console.error("Generation error", error);
          showError(getHumanReadableError(error));
      } finally {
          setLoading({ isGenerating: false, message: '' });
      }
  };

  // Handle Upscale (BATCH SUPPORTED)
  const handleUpscale = async (baseImages: string[]) => {
      if(!baseImages || baseImages.length === 0) return;

      // Vérification des crédits
      const totalCost = getCreditCost('upscale', baseImages.length);
      if (!isAdmin && credits < totalCost) {
          showError(`Crédits insuffisants. Cette action coûte ${totalCost} crédits, il vous en reste ${credits}.`);
          return;
      }

      setLoading({ isGenerating: true, message: 'Upscaling Haute Définition...' });

      const batchId = Date.now().toString();
      const results: HistoryResult[] = [];

      try {
           for(let i=0; i<baseImages.length; i++) {
              const baseImg = baseImages[i];
              setLoading({ isGenerating: true, message: `Upscaling image ${i+1}/${baseImages.length}...` });

              // 1. Detect dynamic ratio per image
              const dims = await getImageDimensions(baseImg);
              const dynamicRatio = getClosestAspectRatio(dims.width, dims.height);

              const resultImg = await upscaleArchitecturalImage(baseImg, dynamicRatio);

              results.push({
                  id: `${batchId}-${i}`,
                  baseImage: baseImg,
                  resultImage: resultImg,
                  feedback: null
              });
           }

          // Déduire les crédits après succès
          if (!isAdmin && user) {
              await deductCredits(user.uid, 'upscale', baseImages.length);
              setCredits(prev => prev - totalCost);
          }

          const newItem: HistoryItem = {
              id: batchId,
              taskType: activeTask,
              prompt: "Upscale Photoréaliste",
              timestamp: Date.now(),
              results: results,
              referenceImages: []
          };
          setHistory(prev => [newItem, ...prev].slice(0, MAX_HISTORY));
      } catch (error) {
          console.error("Upscale error", error);
          showError(getHumanReadableError(error));
      } finally {
          setLoading({ isGenerating: false, message: '' });
      }
  };

  const handleDownload = (url: string, filename: string) => {
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}-${ts}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };
  
  const handleClearHistory = () => {
      setHistory([]);
  };

  const handleFeedback = (batchId: string, resultId: string, feedback: 'like' | 'dislike') => {
      setHistory(prev => prev.map(item => {
          if (item.id !== batchId) return item;
          return {
              ...item,
              results: item.results.map(res => res.id === resultId ? { ...res, feedback } : res)
          };
      }));
  };

  // Auth gate
  if (authLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950">
        <Loader2 size={32} className="text-white/40 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (showIntro) {
      return <IntroSequence onComplete={() => setShowIntro(false)} />;
  }

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden font-sans antialiased">
      {showApiKeyDialog && <ApiKeyDialog onContinue={handleApiKeyDialogContinue} />}

      {/* Global error toast */}
      {appError && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 bg-red-600 text-white text-sm px-5 py-3 rounded-2xl shadow-2xl animate-fade-in max-w-xl">
          <X size={16} className="flex-shrink-0 cursor-pointer opacity-80 hover:opacity-100" onClick={() => setAppError(null)} />
          <span>{appError}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-[72px] bg-zinc-950 flex flex-col items-center py-5 z-20 shadow-[2px_0_20px_rgba(0,0,0,0.15)]">
          <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white mb-5 border border-white/10">
            <Home size={16} strokeWidth={2} />
          </div>

          <div className="flex flex-col gap-1 w-full px-2 flex-1">
            <NavButton
              active={activeTask === 'perspective'}
              onClick={() => setActiveTask('perspective')}
              icon={<Cuboid size={18} />}
              label="Rendu"
            />
            <NavButton
              active={activeTask === 'facade'}
              onClick={() => setActiveTask('facade')}
              icon={<Building size={18} />}
              label="Façade"
            />
            <NavButton
              active={activeTask === 'masterplan'}
              onClick={() => setActiveTask('masterplan')}
              icon={<Map size={18} />}
              label="Masse"
            />
            <NavButton
              active={activeTask === 'material'}
              onClick={() => setActiveTask('material')}
              icon={<Palette size={18} />}
              label="Matériau"
            />
            <NavButton
              active={activeTask === 'technical_detail'}
              onClick={() => setActiveTask('technical_detail')}
              icon={<Ruler size={18} />}
              label="Détail"
            />
          </div>

          {/* Credits + Logout */}
          <div className="px-2 w-full space-y-1 mb-1">
            <div className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl bg-white/5 border border-white/5">
              <Coins size={14} className="text-amber-400/80" />
              <span className="text-[9px] font-bold text-white/70 tabular-nums">
                {isAdmin ? '∞' : credits.toLocaleString()}
              </span>
            </div>
            <button
              onClick={logout}
              title="Déconnexion"
              className="w-full flex items-center justify-center p-2.5 rounded-xl text-zinc-600 hover:text-red-400 hover:bg-white/5 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 relative">
          <ArchitecturalWorkspace
             key={activeTask}
             taskType={activeTask}
             title={getTaskTitle(activeTask)}
             description={getTaskDescription(activeTask)}
             history={history.filter(h => h.taskType === activeTask)}
             onGenerate={handleGenerate}
             onUpscale={handleUpscale}
             loading={loading}
             refImages={refImages}
             setRefImages={setRefImages}
             projectLink={projectLink}
             setProjectLink={setProjectLink}
             onClearHistory={handleClearHistory}
             onFeedback={handleFeedback}
             onDownload={handleDownload}
             credits={credits}
             isAdmin={isAdmin}
             uid={user.uid}
             onCreditsUpdate={(delta) => setCredits(prev => prev + delta)}
             interiorLink={referenceLinks.interior}
             exteriorLink={referenceLinks.exterior}
          />
      </main>
    </div>
  );
};

// Helper Components & Functions
const NavButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
    <button
        onClick={onClick}
        title={label}
        className={`relative flex flex-col items-center justify-center gap-1.5 w-full py-3 px-1 rounded-xl transition-all duration-200 ${
            active ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
        }`}
    >
        {active && <span className="absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-white rounded-l-full" />}
        {icon}
        <span className={`text-[8px] font-bold tracking-widest uppercase leading-none ${active ? 'text-zinc-300' : 'text-zinc-600'}`}>
            {label}
        </span>
    </button>
);

const getTaskTitle = (t: TaskType) => {
    switch(t) {
        case 'perspective': return "Perspective 3D";
        case 'facade': return "Façade & Élévation";
        case 'masterplan': return "Plan de Masse";
        case 'material': return "Matériaux";
        case 'technical_detail': return "Détail Technique";
        default: return "Espace de travail";
    }
};

const getTaskDescription = (t: TaskType) => {
     switch(t) {
        case 'perspective': return "Transformez des volumes blancs en images photoréalistes.";
        case 'facade': return "Appliquez des matériaux sur vos élévations 2D.";
        case 'masterplan': return "Illustrez vos plans de masse et paysages.";
        case 'material': return "Générez des textures et moodboards.";
        case 'technical_detail': return "Rendu graphique pour coupes et détails.";
        default: return "";
    }
};

export default App;