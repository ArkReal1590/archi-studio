/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {useCallback, useEffect, useState} from 'react';
import '../types'; // Ensure Window augmentation is loaded

export const useApiKey = () => {
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);

  const validateApiKey = useCallback(async (): Promise<boolean> => {
    const aistudio = window.aistudio;

    if (aistudio) {
      try {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setShowApiKeyDialog(true);
          return false;
        }
      } catch (error) {
        console.warn('API Key check failed', error);
        setShowApiKeyDialog(true);
        return false;
      }
    }
    return true;
  }, []);

  // Run check automatically on mount
  useEffect(() => {
    validateApiKey();
  }, [validateApiKey]);

  const handleApiKeyDialogContinue = useCallback(async () => {
    setShowApiKeyDialog(false);
    const aistudio = window.aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
    }
  }, []);

  return {
    showApiKeyDialog,
    setShowApiKeyDialog,
    validateApiKey,
    handleApiKeyDialogContinue,
  };
};