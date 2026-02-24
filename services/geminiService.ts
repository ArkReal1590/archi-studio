/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import { TaskType, GeminiPart } from "../types";

// ---------------------------------------------------------------------------
// Image Utilities
// ---------------------------------------------------------------------------

/** Parse the MIME type from a data URL (e.g. "image/jpeg"). */
const getMimeTypeFromDataUrl = (dataUrl: string): string => {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 'image/png';
  const match = dataUrl.match(/^data:([a-zA-Z0-9/]+);/);
  return match ? match[1] : 'image/png';
};

/** Extract base64 payload from a data URL. */
const getBase64Data = (dataUrl: string): string => {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : '';
};

/**
 * Resize an image so its longest side is ≤ maxPx before sending to the API.
 * Reduces token cost and upload time without losing meaningful architectural detail.
 */
const resizeImageForApi = (dataUrl: string, maxPx = 2048): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = Math.max(img.width, img.height);
      if (maxDim <= maxPx) { resolve(dataUrl); return; }
      const scale = maxPx / maxDim;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

/** Convert raw API errors into user-friendly French messages. */
export const getHumanReadableError = (error: unknown): string => {
  if (!(error instanceof Error)) return "Erreur inconnue lors de la génération.";
  const msg = error.message || '';

  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('api_key')) {
    return "Clé API invalide. Vérifiez votre configuration Gemini.";
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate_limit') || msg.includes('429')) {
    return "Quota API dépassé ou trop de requêtes. Attendez 1 à 2 minutes puis réessayez.";
  }
  if (msg.includes('SAFETY') || msg.includes('safety') || msg.includes('blocked')) {
    return "L'image ou le prompt a été bloqué par les filtres de sécurité de Gemini. Essayez une formulation différente.";
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('Overloaded') || msg.includes('upstream')) {
    return "Le service Gemini est temporairement surchargé. Toutes les tentatives ont échoué. Réessayez dans quelques minutes.";
  }
  if (msg.includes('NOT_FOUND') || msg.includes('not found')) {
    return "Modèle Gemini introuvable. Ce modèle n'est peut-être pas disponible avec votre clé API.";
  }
  if (msg.includes('No image generated') || msg.includes('no image')) {
    return "Gemini n'a généré aucune image. Essayez de reformuler votre instruction ou d'ajouter une image de base.";
  }
  if (msg.includes('INVALID_ARGUMENT')) {
    return "Argument invalide envoyé à l'API. Vérifiez le format de vos images.";
  }
  return msg || "Erreur lors de la génération.";
};

/**
 * Checks if an error is transient and retryable (503, Deadline, Unavailable, RESOURCE_EXHAUSTED).
 */
const isRetryableError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;

  if (e['status'] === 503 || e['code'] === 503 || e['status'] === 'UNAVAILABLE') return true;
  if (e['status'] === 429 || e['code'] === 429 || e['status'] === 'RESOURCE_EXHAUSTED') return true;

  const inner = e['error'];
  if (inner && typeof inner === 'object') {
    const ie = inner as Record<string, unknown>;
    if (ie['code'] === 503 || ie['status'] === 'UNAVAILABLE') return true;
    if (ie['code'] === 429 || ie['status'] === 'RESOURCE_EXHAUSTED') return true;
    const innerMsg = ie['message'];
    if (typeof innerMsg === 'string' && (
      innerMsg.includes('Deadline expired') ||
      innerMsg.includes('503') ||
      innerMsg.includes('UNAVAILABLE') ||
      innerMsg.includes('Overloaded') ||
      innerMsg.includes('RESOURCE_EXHAUSTED')
    )) return true;
  }

  const msg = (e['message'] as string) || String(error);
  if (msg && (
    msg.includes('Deadline expired') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('Overloaded') ||
    msg.includes('upstream connect error') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('429')
  )) return true;

  return false;
};

/**
 * Retry with exponential backoff + jitter. Handles transient Gemini API errors.
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  retries: number = 5,
  initialDelay: number = 2000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;

      if (attempt < retries && isRetryableError(error)) {
        const delay = initialDelay * Math.pow(2, attempt) + (Math.random() * 1000);
        const msg = error instanceof Error ? error.message : '503/429';
        console.warn(`Attempt ${attempt + 1} failed (${msg}). Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Generates style/material reference images sequentially to avoid rate limits.
 */
export const generateStyleImages = async (description: string, count: number = 3): Promise<string[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-pro-image-preview';
  const prompt = `Architectural reference photography, professional quality, material and lighting focus.
Style: ${description}.
Show realistic textures, surfaces, and lighting as used in high-end architectural photography.`;

  const images: string[] = [];

  for (let i = 0; i < count; i++) {
    const response = await retryOperation<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
          imageConfig: { aspectRatio: "1:1" }
        }
      })
    );

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          images.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
      }
    }

    // Rate limit buffer between sequential requests
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return images;
};

/**
 * Analyzes the architectural image and returns improvement suggestions.
 */
export const analyzeArchitecturalImage = async (
  baseImage: string,
  promptContext: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-2.5-flash';

  const processedImage = await resizeImageForApi(baseImage, 1536);
  const mimeType = getMimeTypeFromDataUrl(processedImage);

  const response = await retryOperation<GenerateContentResponse>(() =>
    ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: getBase64Data(processedImage),
            },
          },
          {
            text: `Tu es un consultant en architecture senior spécialisé dans la post-production de rendus 3D.
Analyse cette image en tenant compte de l'intention suivante : "${promptContext || 'rendu photoréaliste'}".

Fournis une critique concise et 3 suggestions concrètes pour améliorer le réalisme ou la présentation architecturale.
Structure ta réponse ainsi :
• **Critique** : [analyse globale en 1-2 phrases]
• **Géométrie & Perspective** : [suggestion spécifique]
• **Éclairage & Ombres** : [suggestion spécifique]
• **Matériaux & Textures** : [suggestion spécifique]

Réponds en français, de manière précise et actionnable.`
          }
        ]
      }
    })
  );

  return response.text || "Impossible d'analyser l'image.";
};

/**
 * Upscales a render to photorealistic DSLR quality with maximum texture detail.
 */
export const upscaleArchitecturalImage = async (
  baseImage: string,
  aspectRatio: string = "1:1"
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-pro-image-preview';

  // Resize to 1536px max before sending (upscale will enlarge from there)
  const processedImage = await resizeImageForApi(baseImage, 1536);
  const mimeType = getMimeTypeFromDataUrl(processedImage);

  const parts: GeminiPart[] = [
    {
      inlineData: {
        mimeType,
        data: getBase64Data(processedImage),
      },
    },
    {
      text: `ARCHITECTURAL RENDER UPSCALING — PIXEL-PERFECT GEOMETRY LOCK.

INPUT: The attached image is a 3D architectural render.
TASK: Upscale to photorealistic quality while preserving every geometric element.

STRICT RULES — NO EXCEPTIONS:
1. DO NOT move, rotate, crop, or reframe the image.
2. DO NOT add, remove, or change any architectural element (walls, windows, doors, columns).
3. DO NOT change the camera angle or focal length.
4. The output must overlay perfectly over the input at 100% in Photoshop.

QUALITY ENHANCEMENTS ALLOWED:
- Convert flat textures to physically-based materials (concrete roughness, glass reflection, wood grain).
- Improve lighting realism: add global illumination, ambient occlusion, correct specular highlights.
- Add photographic grain and depth-of-field subtlety.
- Sharpen details: joint lines, material edges, shadow transitions.
- Enhance sky/environment if visible, without changing composition.

OUTPUT: Maximum resolution, photorealistic architectural photography quality.`
    }
  ];

  const response = await retryOperation<GenerateContentResponse>(() =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
        imageConfig: {
          aspectRatio,
          imageSize: "2K"
        }
      },
    })
  );

  const candidates = response.candidates;
  if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData?.data) {
        const respMime = part.inlineData.mimeType || 'image/png';
        return `data:${respMime};base64,${part.inlineData.data}`;
      }
    }
  }
  throw new Error("No image generated");
};

/**
 * Generates an architectural render based on a specific task type.
 * Processes base image + style references with task-specific system instructions.
 */
export const generateArchitecturalView = async (
  taskType: TaskType,
  baseImage: string | undefined,
  referenceImages: string[],
  prompt: string,
  aspectRatio: string = "1:1",
  imageSize: string = "1K",
  projectLink?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-pro-image-preview';
  const parts: GeminiPart[] = [];

  // 1. Base image — resize to 2048px max before sending
  if (baseImage) {
    const processedBase = await resizeImageForApi(baseImage, 2048);
    parts.push({
      inlineData: {
        mimeType: getMimeTypeFromDataUrl(processedBase),
        data: getBase64Data(processedBase),
      },
    });
  }

  // 2. Style reference images — resize to 1024px (style context only, detail less critical)
  for (const ref of referenceImages) {
    const processedRef = await resizeImageForApi(ref, 1024);
    parts.push({
      inlineData: {
        mimeType: getMimeTypeFromDataUrl(processedRef),
        data: getBase64Data(processedRef),
      },
    });
  }

  // 3. Task-specific system prompt
  let systemRole = "";
  switch (taskType) {
    case 'perspective':
      systemRole = `ROLE: Photorealistic 3D Architectural Rendering Engine.
INPUT: Image 1 = IMMUTABLE 3D wireframe or white model. Images 2+ = lighting/style references.

GEOMETRY LOCK — ABSOLUTE RULES:
1. The output must overlay perfectly over Image 1 in Photoshop at 100% opacity. Zero pixel shift.
2. DO NOT move the camera. DO NOT change focal length. DO NOT crop or reframe.
3. PRESERVE ALL OUTLINES exactly. Every wall, window, column stays at its exact pixel position.
4. DO NOT design a new building. Only "skin" the existing geometry with photorealistic materials.

RENDERING DIRECTIVES:
- Apply PBR materials (concrete roughness, glass fresnel, wood anisotropy, metal specular).
- Lighting: physically accurate, global illumination, ambient occlusion in recesses.
- Use atmosphere style from reference images (lighting angle, sky, atmosphere).
- Add contextual vegetation only if it doesn't obscure architectural geometry.
- Red-marked zones in Image 1 = areas to modify freely. All other zones = geometry locked.`;
      break;

    case 'facade':
      systemRole = `ROLE: Architectural Elevation Rendering Specialist.
INPUT: Image 1 = EXACT 2D elevation drawing to preserve. Images 2+ = material/style references.

STRICT GEOMETRY PRESERVATION:
1. Maintain EXACT positions of all openings (windows, doors, voids). No additions or removals.
2. Preserve all proportions, scale markers, and architectural lines.
3. Output must be a perfect 1:1 overlay with Image 1.
4. DO NOT change the viewing angle or projection type (orthographic stays orthographic).

MATERIAL APPLICATION:
- Apply specified materials only to existing surfaces — texture swap, not design change.
- Ensure material tiling looks realistic at architectural scale.
- Add shadow depth to openings for 3D realism without shifting geometry.`;
      break;

    case 'masterplan':
      systemRole = `ROLE: Landscape Architect — Aerial Masterplan Illustrator.
INPUT: Image 1 = EXACT site plan geometry (preserve all boundaries, roads, building footprints).

RULES:
1. Maintain exact scale and all geometric elements from Image 1.
2. DO NOT reposition buildings, roads, or site boundaries.
3. Use reference images for vegetation quality, ground texture style, and color palette.

ENHANCEMENTS:
- Apply realistic top-down textures: grass, pavement, water, gravel.
- Add tree canopy shadows cast correctly from sun direction.
- Show parking spaces, pathways, and landscape features with high detail.
- North arrow and scale bar if present in original must remain.`;
      break;

    case 'material':
      systemRole = `ROLE: Architectural Materials Specialist.
TASK: Generate a high-quality material board or texture visualization.

GUIDELINES:
- Show materials in realistic architectural context (wall panel, floor swatch, or close-up).
- Apply accurate PBR characteristics: roughness, reflection, bump, and color variation.
- Reference images define the visual style and quality benchmark.
- Include material name and finish type if contextually appropriate.
- Lighting should reveal texture character (raking light for texture, diffuse for color accuracy).`;
      break;

    case 'technical_detail':
      systemRole = `ROLE: Senior Technical Architect — Construction Detail Renderer.
INPUT: Image 1 = EXACT geometric trace to preserve down to the line.

STRICT RULES:
1. Every line, dimension, hatch pattern and annotation in Image 1 must be preserved exactly.
2. Output is a 1:1 overlay — zero geometric deviation allowed.
3. DO NOT simplify or redesign any constructive element.

RENDERING:
- Clarify material differentiation with appropriate hatch patterns and line weights.
- Add realistic material textures in cross-section cuts (concrete aggregate, insulation, wood grain).
- Enhance line clarity and shadow depth for readability.
- Maintain architectural drawing conventions (section cuts, north arrows, dimension lines).`;
      break;
  }

  const finalPrompt = `${systemRole}

USER INSTRUCTION: ${prompt || "Apply photorealistic materials and lighting to the provided architectural geometry."}
${projectLink ? `PROJECT CONTEXT: ${projectLink}` : ''}

RENDERING CONTROL:
- [IMAGE 1] = GEOMETRY LOCKED. Do not alter shape, perspective, or framing.
- [REF IMAGES] = STYLE & QUALITY BENCHMARK only.
- Final output must be compositable over the original as a Photoshop layer.
- RED MARKINGS in Image 1 (if any) = zones to modify freely. All other areas = geometry locked.
- Image quality: professional architectural visualization, print-ready.`;

  parts.push({ text: finalPrompt });

  const tools = projectLink ? [{ googleSearch: {} }] : undefined;

  const response = await retryOperation<GenerateContentResponse>(() =>
    ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        tools,
        responseModalities: [Modality.IMAGE, Modality.TEXT],
        imageConfig: {
          aspectRatio,
          imageSize
        }
      },
    })
  );

  const candidates = response.candidates;
  if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData?.data) {
        const respMime = part.inlineData.mimeType || 'image/png';
        return `data:${respMime};base64,${part.inlineData.data}`;
      }
    }
  }
  throw new Error("No image generated");
};
