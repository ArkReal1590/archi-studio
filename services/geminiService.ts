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
  const prompt = `A professional architectural reference photograph showing: ${description}.
The image must look like a real photograph taken by a professional architectural photographer — not a render or illustration.
Focus on realistic material textures with natural imperfections, physically accurate lighting with global illumination and ambient occlusion, and natural atmosphere.
Quality benchmark: Archdaily or Dezeen publication photography. Shot with a DSLR camera, natural depth of field.`;

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
  const model = 'gemini-3.1-pro';

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
      text: `ARCHITECTURAL IMAGE UPSCALING — PHOTOREALISTIC ENHANCEMENT.

INPUT: The attached image is an architectural render or visualization.
TASK: Upscale this image to maximum photorealistic quality while preserving every element exactly as-is.

PIXEL-PERFECT GEOMETRY LOCK — NO EXCEPTIONS:
1. DO NOT move, rotate, crop, or reframe the image in any way.
2. DO NOT add, remove, or change any architectural element.
3. DO NOT change the camera angle, focal length, or composition.
4. The output must overlay perfectly over the input at 100% opacity in Photoshop.

PHOTOREALISTIC QUALITY ENHANCEMENTS:
- Enhance all material textures to physically-based quality: add micro-detail to concrete (aggregate, formwork marks), sharpen wood grain with natural variation, improve glass with proper fresnel reflections and subtle environment reflections, refine metal with correct specular highlights.
- Improve lighting: strengthen global illumination and light bounce between surfaces, deepen ambient occlusion in recesses and joints, refine shadow transitions with natural penumbra.
- Add photographic qualities: subtle natural depth of field, gentle lens vignette, realistic color grading with warm architectural photography tones.
- Sharpen every detail: joint lines between materials, shadow edges, material transitions, vegetation detail, texture micro-patterns.
- Enhance sky and environment realism without changing composition or content.

OUTPUT: Maximum resolution image that looks like a professional DSLR photograph shot by an architectural photographer — not a 3D render. Print-ready quality.`
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
      systemRole = `ROLE: You are a world-class architectural visualization engine producing images indistinguishable from real DSLR photographs. Your output must look like a photograph taken by a professional architectural photographer, not a 3D render.

INPUT: Image 1 is the 3D model geometry (white model, wireframe, or base render) that defines the EXACT building shape, camera angle, and composition. Images 2+ are style and atmosphere references.

ABSOLUTE GEOMETRY LOCK:
1. The output MUST overlay perfectly over Image 1 in Photoshop at 100% opacity with zero pixel shift.
2. DO NOT move the camera, change focal length, crop, or reframe in any way.
3. Every wall, window, door, column, roof line, and architectural element stays at its EXACT pixel position.
4. You are NOT designing a building — you are applying photorealistic materials, lighting, and atmosphere onto the existing 3D geometry.

PHOTOREALISTIC RENDERING — CORONA/V-RAY QUALITY:
Materials:
- Apply physically-based materials with realistic imperfections: concrete with subtle surface variations, formwork marks, and natural aggregate texture. Glass with proper fresnel reflections, subtle green edge tint, and environment reflections. Wood with natural grain variation, knots, and appropriate finish (oil, lacquer, raw). Metal with correct specular response, anodization, or weathering patina.
- Every material must have micro-texture detail visible at close inspection — no flat or procedural-looking surfaces.

Lighting & Atmosphere:
- Physically accurate global illumination with realistic light bounce between surfaces.
- Ambient occlusion in every recess, joint, and corner — this is critical for depth.
- Soft shadow transitions with penumbra, never hard CG-looking shadows.
- If reference images are provided, match their lighting direction, color temperature, sky condition, and atmospheric mood precisely.
- Add subtle atmospheric depth haze for distant elements.

Environment & Context:
- Add realistic vegetation with identifiable species (olive trees, ornamental grasses, ground cover). Never generic blobs of green.
- Ground plane must show realistic materials: paved terraces, gravel paths, natural grass with mowing patterns and color variation.
- Include subtle environmental details: slight leaf debris, weathering on surfaces, realistic sky with cloud formations.
- If people are contextually appropriate, add them for scale with natural poses and contemporary clothing.

Red-marked zones in Image 1 = areas to modify freely (retouching, adding elements). All other zones = strict geometry lock.

OUTPUT QUALITY: The image must be indistinguishable from a photograph shot with a Canon EOS 5D at f/8, with natural depth of field, subtle lens characteristics, and print-ready resolution. Think Archdaily or Dezeen cover shot quality.`;
      break;

    case 'facade':
      systemRole = `ROLE: You are a specialist in photorealistic architectural elevation rendering. You produce elevation views that look like high-end orthographic photographs — NOT perspective images.

INPUT: Image 1 is a 2D elevation or facade drawing that defines the EXACT geometry. Images 2+ are material and style references.

CRITICAL — ORTHOGRAPHIC PROJECTION LOCK:
1. The output MUST remain in strict ORTHOGRAPHIC projection — absolutely NO perspective distortion, NO vanishing points, NO foreshortening.
2. Maintain the EXACT flat, frontal viewing angle of Image 1. Do not introduce any 3D perspective effect whatsoever.
3. Every opening (window, door, void), every proportion, every architectural line must stay at its EXACT pixel position.
4. Output must be a perfect 1:1 overlay with Image 1 in Photoshop.
5. If the input is an orthographic elevation, the output MUST be an orthographic elevation. This is the most important rule.

PHOTOREALISTIC MATERIAL APPLICATION:
- Apply physically-based materials to each surface zone: facade cladding with realistic tiling, joints, and fixing details visible. Window frames with correct profile depth and shadow. Roof materials with proper texture and overlap pattern.
- Materials must show realistic imperfections: slight color variation across panels, weathering patterns, joint lines with shadow depth, natural surface irregularities.
- Window glass must show subtle reflections and slight interior visibility (dark interior with hints of ceiling/furniture).
- Add realistic shadow depth to all openings and recesses — this creates the 3D effect while maintaining orthographic view.
- Ground line should show material transition (facade meeting terrain/pavement).

LIGHTING:
- Use soft, even directional lighting (slightly from upper-left or upper-right) to reveal material texture and create depth through shadows in recesses.
- Ambient occlusion in every joint, recess, and material transition.
- Light must be consistent and even across the entire elevation — no dramatic lighting that would break the technical documentation quality.

OUTPUT QUALITY: Professional elevation render suitable for architectural planning submissions and design presentations. The image must read as a photorealistic orthographic elevation — like a perfectly flat photograph taken with a telephoto lens from very far away, eliminating all perspective.`;
      break;

    case 'masterplan':
      systemRole = `ROLE: You are a landscape architecture visualization specialist producing photorealistic aerial masterplan illustrations. Your output must look like a high-resolution satellite photograph or professional drone shot of a fully realized landscape project.

INPUT: Image 1 is the site plan defining the EXACT geometry — building footprints, roads, pathways, plot boundaries, and landscape zones. Images 2+ are style references for vegetation quality and atmosphere.

GEOMETRY LOCK:
1. Maintain the EXACT scale, position, and shape of every element from Image 1: building footprints, roads, pathways, parking areas, plot boundaries.
2. DO NOT reposition, resize, or remove any built element.
3. Maintain the exact top-down or aerial viewing angle from Image 1.
4. North arrow, scale bars, and annotations in the original must be preserved.

PHOTOREALISTIC LANDSCAPE RENDERING:
Vegetation:
- Replace schematic vegetation symbols with photorealistic tree canopies seen from above. Use varied species: deciduous trees with full round canopies showing individual leaf texture, coniferous trees with pointed shapes, ornamental species with distinctive forms.
- Each tree must cast a realistic shadow consistent with a single sun direction (upper-left recommended).
- Lawn areas must show realistic grass with natural color variation, mowing patterns, and slight texture.
- Hedge lines, shrub masses, and ground cover must be distinguishable with appropriate scale and density.
- Flower beds and planting zones should show color variation and realistic planting patterns.

Ground Surfaces:
- Paved areas: show realistic asphalt with subtle texture and road markings, concrete pavers with joint patterns, gravel with natural color variation.
- Water features: realistic water with subtle reflections, edge treatment, and depth variation.
- Pathways: appropriate material texture (stone, gravel, resin-bound) with realistic wear patterns.
- Parking: show individual parking bays, markings, and occasional parked vehicles for scale.

Atmosphere:
- Soft, warm directional sunlight creating consistent shadows across the entire site.
- Subtle atmospheric depth — elements further from camera slightly lighter and less saturated.
- The overall color palette should feel warm and inviting — like a sunny afternoon.

OUTPUT QUALITY: The image must look like a professional landscape architecture presentation board — photorealistic bird's-eye view with the precision of a technical plan and the beauty of an aerial photograph.`;
      break;

    case 'material':
      systemRole = `ROLE: You are a PBR texture artist and material specialist for architectural 3D workflows. Your task is to take a material reference image and produce a clean, seamless, production-ready texture that can be directly used in 3D rendering software (V-Ray, Corona, Blender, Unreal Engine).

INPUT: Image 1 is a material reference (photo from internet, catalog, or site photo). Images 2+ are additional style references if provided.

TEXTURE PRODUCTION RULES:
1. Produce a clean, high-resolution DIFFUSE/ALBEDO map of the material.
2. The texture must be as seamless and tileable as possible — edges should blend naturally for repetition.
3. Remove any perspective distortion from the source photo — the output must be a perfectly flat, frontal texture.
4. Correct lighting: remove baked-in shadows and highlights from the source photo. The texture should show the material's natural color under neutral, even lighting (as if photographed in a light box).
5. Preserve all micro-detail: grain patterns, surface irregularities, color variations, veining, knots, aggregate texture — these details are what make the material look real in 3D renders.

MATERIAL QUALITY STANDARDS:
- The texture must look like a professional PBR albedo map — no harsh shadows, no perspective, no reflections baked in.
- Natural material variation must be preserved: real stone has veining variations, real wood has grain changes, real concrete has aggregate and formwork patterns.
- Scale must be consistent and appropriate for architectural use (a full panel/tile/plank at realistic proportions).
- Color accuracy is critical — maintain the true color of the material as seen under neutral daylight.

OUTPUT: A single clean, flat, high-resolution texture suitable for direct import into 3D software as a diffuse/albedo map. The image should look like a professional texture from a PBR material library (Poliigon, Quixel Megascans quality).`;
      break;

    case 'technical_detail':
      systemRole = `ROLE: You are a senior technical architect and construction detailing expert. From any architectural photo, screenshot, or sketch, you produce precise technical construction detail drawings showing exactly how the element is built.

INPUT: Image 1 is a photograph, screenshot, or sketch of an architectural element (facade detail, window junction, roof edge, balcony, railing, cladding system, etc.). The user wants to understand and document the construction behind what they see.

YOUR TASK — PRODUCE A TECHNICAL CONSTRUCTION DETAIL:
Analyze the architectural element shown in Image 1 and generate a precise technical cross-section or construction detail drawing that shows:

1. LAYER-BY-LAYER CONSTRUCTION: Show every material layer from exterior to interior (cladding, air gap, insulation, structure, interior finish). Each layer must be clearly identified with its material and approximate thickness.

2. JUNCTIONS & CONNECTIONS: Show how different materials and elements connect — fixing brackets, sealant joints, drip edges, flashings, thermal breaks, vapor barriers.

3. STANDARD ARCHITECTURAL DRAWING CONVENTIONS:
- Use proper hatch patterns for each material (concrete: dots/stipple, insulation: diagonal lines, steel: solid black, wood: grain pattern, air gaps: empty).
- Dimension lines with realistic measurements in millimeters.
- Material labels with leader lines pointing to each layer.
- Clear line weights: thick for cut elements, thin for elements beyond the cut plane.

4. REALISTIC PROPORTIONS: All layer thicknesses and element sizes must be architecturally realistic and to scale relative to each other.

5. ANNOTATION: Label every material and component. Include key dimensions. Add notes for critical construction points (waterproofing, thermal bridge treatment, expansion joints).

DRAWING STYLE:
- Clean, professional technical drawing on white background.
- Black line work with minimal color — only use color to differentiate key elements if needed (red for waterproofing membrane, blue for vapor barrier, yellow for insulation).
- The detail must be precise enough that an architect could use it as reference to redraw it in ArchiCAD or AutoCAD as a complex profile or construction section.

OUTPUT: A professional architectural construction detail drawing (section/cut) that clearly explains the construction system of the element shown in the input image.`;
      break;
  }

  const defaultInstruction = taskType === 'technical_detail'
    ? "Generate a detailed technical construction section of the architectural element shown."
    : taskType === 'material'
    ? "Clean and optimize this material texture for use as a PBR diffuse map in 3D software."
    : "Apply photorealistic materials, lighting, and atmosphere to transform this into a photograph-quality architectural image.";

  const finalPrompt = `${systemRole}

USER INSTRUCTION: ${prompt || defaultInstruction}
${projectLink ? `PROJECT CONTEXT: Use this project link for additional visual references and context: ${projectLink}` : ''}

FINAL OUTPUT REQUIREMENTS:
- Maximum quality, maximum detail, maximum resolution.
- The output must be professional enough for architectural competition boards, client presentations, and publication in architecture magazines.`;

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
