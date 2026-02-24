/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import { KeyRound } from 'lucide-react';

interface ApiKeyDialogProps {
  onContinue: () => void;
}

const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({ onContinue }) => {
  return (
    <div className="fixed inset-0 bg-zinc-100/50 backdrop-blur-md flex items-center justify-center z-[200] p-4 animate-fade-in">
      <div className="bg-white border border-zinc-200 rounded-3xl shadow-2xl max-w-lg w-full p-10 text-center flex flex-col items-center">
        <div className="bg-zinc-50 p-4 rounded-full mb-6 border border-zinc-100">
          <KeyRound className="w-8 h-8 text-zinc-900" strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-semibold text-zinc-900 mb-3 tracking-tight">Clé API Payante Requise</h2>
        <p className="text-zinc-500 mb-8 leading-relaxed">
          Cette application utilise des modèles d'IA premium.
          <br/>
          Vous devez sélectionner une clé API d'un <strong>Projet Google Cloud Payant</strong>.
        </p>
        
        <button
          onClick={onContinue}
          className="w-full px-6 py-4 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-xl transition-colors text-base shadow-lg shadow-zinc-200"
        >
          Sélectionner une Clé API
        </button>
        
        <div className="mt-6">
          <a
            href="https://ai.google.dev/gemini-api/docs/billing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-500 font-medium hover:underline"
          >
            Documentation de facturation
          </a>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyDialog;