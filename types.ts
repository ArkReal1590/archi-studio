/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export type TaskType = 'material' | 'facade' | 'masterplan' | 'perspective' | 'technical_detail';

export interface HistoryResult {
  id: string; // Unique ID for the specific image within the batch
  baseImage: string;
  resultImage: string;
  feedback?: 'like' | 'dislike' | null;
}

export interface HistoryItem {
  id: string; // Batch ID
  taskType: TaskType;
  prompt: string;
  timestamp: number;
  results: HistoryResult[]; // Array of results (Grouping)
  referenceImages?: string[];
}

export type AppView = 'dashboard' | TaskType;

export interface LoadingState {
  isGenerating: boolean;
  message: string;
}

// Anciens types conservés pour compatibilité si besoin, ou simplifiés
export interface Asset {
  id: string;
  data: string;
  mimeType: string;
}

// Type for Gemini API content parts
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

// Global window augmentation for AI Studio and Node.js compat
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}