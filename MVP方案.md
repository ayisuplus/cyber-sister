# AI妆教 MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a first MVP for an AI makeup tutor that analyzes a user's selfie, recommends suitable makeup styles, and teaches step-by-step application on a face-map/2.5D canvas.

**Architecture:** Mobile-first web app. Browser-side face landmark detection (MediaPipe) → backend style recommendation (deterministic rules + optional LLM polish) → step-by-step makeup tutorial with face overlay canvas. Face mesh / 2.5D teaching canvas as the reliable core; image/video generation reserved for later.

**Tech Stack:**

| Layer | Choice | Why |
|-------|--------|-----|
| Build tool | **Vite 5** | Fast HMR, native TS, good WASM support |
| Frontend framework | **React 18 + TypeScript** | Ecosystem, hooks for state machine |
| CSS | **Tailwind CSS 4** + custom pink theme | Fast prototyping, consistent design tokens |
| Backend framework | **Express 5 + TypeScript** | Simple, well-known, sufficient for MVP |
| Face detection | **@mediapipe/tasks-vision 0.10** | Browser-side, 478 landmarks, free |
| Canvas rendering | **HTML5 Canvas API** | No extra deps, full control |
| LLM (optional) | **OpenAI-compatible API** | For explanation polish only |
| State management | **React Context + useReducer** | Simple state machine, no extra deps |
| Testing | **Vitest** | Vite-native, fast |
| Deploy | **Vercel** (frontend) | China-accessible via custom domain + CDN |
| Package manager | **pnpm** | Fast, strict, good monorepo support |

**Key Dependencies:**
```json
{
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.18",
    "react": "^18.3",
    "react-dom": "^18.3",
    "express": "^5.1",
    "cors": "^2.8"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "vite": "^6.0",
    "vitest": "^3.0",
    "tailwindcss": "^4.0",
    "@types/react": "^18.3",
    "@types/express": "^5.0"
  }
}
```

- Visual style: 闺蜜感粉色系 — 柔粉主色(#FFB6C1/#FFC0CB)、圆角卡片、手写体点缀、温暖不冷感
- Full-stack: TypeScript only (Node.js backend), unified type sharing
- Mobile-first: all UI tested on iOS Safari 17+ and Android Chrome 120+

---

## Current Context / Assumptions

- Product positioning: **AI makeup teaching**, not AI try-on or AI diagnosis.
- Target market: **Chinese female users** (18-35). All UI copy in Chinese.
- Core pain: users can watch beauty tutorials but cannot map generic blogger instructions onto their own face shape and features.
- MVP should prove: users will upload a selfie → accept face-feature analysis → follow personalized makeup steps → share the result.
- Face mesh / 2.5D canvas first for teachability; image/video generation added later for visual impact and marketing.
- Skin tone analysis is **critical**, not optional — it directly determines color recommendations.
- CPS (product recommendation) is a core monetization path, not a late addition.

## Proposed MVP Scope

### Included
- Selfie upload / camera capture (mobile-friendly).
- Face landmark extraction (browser-side, privacy-first).
- Feature analysis: face shape, eye type, lip ratio, brow position, **skin tone**, facial proportions.
- Makeup recommendation: 3 suitable looks with reasons.
- Step-by-step tutorial with face-map overlay: base, contour, highlight, brows, eyeshadow, eyeliner, blush, lip.
- Product shade/type recommendation per step (CPS-ready).
- Shareable result card (Xiaohongshu/WeChat style).
- Chinese UI throughout.

### Excluded From MVP
- Full photorealistic 3D face reconstruction.
- Training a custom foundation model.
- Real-time AR camera guidance.
- Video model generation.
- Medical / dermatological claims.
- Direct checkout integration (CPS links are placeholder).

## Technical Decision

Use **face mesh / 2.5D teaching canvas first**, not pure image/video generation.

- Face mesh provides controllable coordinates for teaching zones and brush directions.
- Image model can be added later for final visual preview / "种草图".
- Video model should wait until the app has usage data and validated tutorial scripts.
- All rendering must work on mobile browsers (iOS Safari + Android Chrome).

---

## App State Machine

The app has 5 core states. Every UI component reads from one state machine:

```
IDLE → LOADING_MODEL → READY
READY → ANALYZING → ANALYSIS_DONE
ANALYSIS_DONE → RECOMMENDING → LOOKS_READY
LOOKS_READY → TUTORIAL_STEP (0..N) → TUTORIAL_DONE
TUTORIAL_DONE → RESULT
```

```ts
type AppState =
  | { stage: 'idle' }                                          // landing page
  | { stage: 'loading_model'; progress: number }                // MediaPipe WASM loading
  | { stage: 'ready'; imageData: ImageData }                    // selfie uploaded, await analyze
  | { stage: 'analyzing' }                                      // extracting landmarks
  | { stage: 'analysis_done'; features: FaceFeatures }          // show analysis
  | { stage: 'recommending' }                                   // fetching recommendations
  | { stage: 'looks_ready'; looks: MakeupLook[]; selected: number }
  | { stage: 'tutorial_step'; look: MakeupLook; stepIndex: number }
  | { stage: 'tutorial_done'; look: MakeupLook }
  | { stage: 'result'; look: MakeupLook; features: FaceFeatures }
  | { stage: 'error'; message: string; recoverable: boolean };
```

This state machine is implemented via `useReducer` in `App.tsx`. Every UI component is a pure function of `AppState`.

### Loading UI Strategy

| Wait point | Duration (est.) | UI treatment |
|---|---|---|
| MediaPipe model load | 2-5s (mobile 4G) | Full-screen loader: pink gradient bg + animated brush icon + "正在准备化妆台..." text |
| Face landmark extraction | 0.3-1s | Overlay spinner on selfie preview + "正在分析你的五官..." |
| Recommendation API call | 0.2-0.5s | Skeleton cards (3 shimmer placeholders) |
| LLM explanation (optional) | 1-3s | Streaming text with blinking cursor; deterministic text shown immediately as fallback |
| Canvas rendering | <100ms | No loader needed |

### Onboarding / First-Time Experience

When `stage === 'idle'`, show not just an upload button, but:

1. **Hero copy**: "找到最适合你的妆容" (warm, inviting, not technical)
2. **3-step preview**: ① 拍一张正面照 → ② AI分析你的脸型 → ③ 手把手教你画
3. **Example result card** (static image mockup): shows what the final share card looks like, to set expectations and motivate upload
4. **Upload button**: large, pink gradient, with camera icon

No account, no email, no permissions — just one tap to camera or gallery.

---

## Step-by-Step Plan

### Task 1: Create MVP Product Spec

**Objective:** Write the product requirements as a stable implementation target.

**Files:**
- Create: `docs/mvp-spec.md`

**Content Requirements:**
- Target user: Chinese female, 18-35, beginner/intermediate makeup learner.
- Primary flow: upload selfie → analyze → recommend → teach → share.
- Acceptance criteria for MVP launch.
- Non-goals: no medical claims, no guaranteed beauty outcome, no celebrity face cloning.
- Success metrics: upload rate, analysis trust score, tutorial completion rate, share rate.

**Validation:**
- Spec answers: who, pain, core flow, output, success metrics.
- Reviewed by product owner.

**Commit:**
```bash
git add docs/mvp-spec.md
git commit -m "docs: define AI makeup tutor MVP spec"
```

---

### Task 2: Scaffold Project Structure

**Objective:** Create a minimal app structure without overbuilding.

**Files:**
- Create: `src/frontend/`
- Create: `src/backend/`
- Create: `src/shared/`
- Create: `data/makeup-rules/`
- Create: `tests/`

**Suggested Structure:**
```text
src/
  frontend/
    App.tsx
    face/landmarks.ts
    tutorial/MakeupCanvas.tsx
    tutorial/TutorialPanel.tsx
    tutorial/overlayZones.ts
    result/ResultCard.tsx
  backend/
    server.ts
    routes/analyze.ts
    routes/recommend.ts
    routes/explain.ts
  shared/
    types.ts
    faceFeatures.ts
data/
  makeup-rules/
    face-shapes.json
    eye-types.json
    skin-tone-guide.json
    looks.json
    tutorial-steps.json
    product-families.json
public/
  index.html
  mp-models/          # MediaPipe model files (local for China CDN)
```

**Validation:**
- `npm install && npm run dev` starts a blank upload page.
- No model logic yet.

**Commit:**
```bash
git add src data public tests package.json tsconfig.json
git commit -m "chore: scaffold AI makeup tutor MVP"
```

---

### Task 3: Define Shared Data Types

**Objective:** Create stable interfaces for face analysis, recommendations, and tutorial steps.

**Files:**
- Create: `src/shared/types.ts`

**Core Types:**
```ts
// Face analysis
export type FaceShape = 'oval' | 'round' | 'square' | 'heart' | 'long' | 'diamond' | 'unknown';
export type SkinTone = 'cool_fair' | 'cool_medium' | 'neutral_fair' | 'neutral_medium' | 'warm_fair' | 'warm_medium' | 'warm_deep' | 'warm_deep_dark' | 'unknown';
export type EyeType = 'almond' | 'round' | 'hooded' | 'monolid' | 'downturned' | 'upturned' | 'close_set' | 'wide_set' | 'unknown';
export type NoseType = 'straight' | 'wide_bridge' | 'narrow_bridge' | 'bulbous_tip' | 'upturned' | 'hooked' | 'unknown';

export interface FaceFeatures {
  // 三庭五眼 — standard Chinese face proportion analysis
  upperThirdRatio: number;     // hairline→brow / total face height (上庭)
  middleThirdRatio: number;    // brow→nose base / total face height (中庭)
  lowerThirdRatio: number;     // nose base→chin / total face height (下庭)
  fiveEyeFit: number;          // actual face width / 5×eye width; 1.0 = perfect五眼

  faceShape: FaceShape;
  skinTone: SkinTone;
  eyeType: EyeType;
  noseType: NoseType;
  eyeDistanceRatio: number;    // interpupillary distance / face width
  faceWidthHeightRatio: number;
  lipFullnessRatio: number;    // lip height / lip width
  browArchAngle: number;       // brow arch angle in degrees
  noseBridgeWidth: number;     // normalized 0-1, wide bridge needs contour
  confidence: number;          // 0-1, overall analysis confidence
}

// Overlay zones — these are the valid string values for overlayZones
export type OverlayZone =
  | 'forehead'  | 't_zone'     | 'u_zone'
  | 'left_cheek'| 'right_cheek'| 'chin'
  | 'left_eye'  | 'right_eye'  | 'left_eyelid' | 'right_eyelid'
  | 'inner_corner_l' | 'inner_corner_r' | 'outer_corner_l' | 'outer_corner_r'
  | 'crease_l'  | 'crease_r'
  | 'left_brow' | 'right_brow' | 'brow_tail_l' | 'brow_tail_r'
  | 'nose_bridge' | 'nose_tip' | 'nose_sides'
  | 'upper_lip' | 'lower_lip' | 'lip_line'
  | 'left_highlight' | 'right_highlight' | 'cupid_bow';

// Makeup areas for tutorial steps
export type MakeupArea = 'base' | 'concealer' | 'contour' | 'highlight' | 'brow' | 'eye' | 'eyeliner' | 'lash' | 'blush' | 'lip' | 'nose';

export interface MakeupStep {
  id: string;
  title: string;              // e.g. "底妆", "修容", "眼影"
  area: MakeupArea;
  instruction: string;        // detailed Chinese instruction
  overlayZones: OverlayZone[];
  brushDirection?: string;    // e.g. "从内向外晕染", "向上提拉"
  toolHint?: string;          // e.g. "美妆蛋", "斜角刷"
  colorFamily?: string;       // e.g. "大地色系", "蜜桃色系"
  warnings?: string[];        // e.g. ["肿泡眼避免珠光"]
  order: number;              // step sequence
}

export interface ProductHint {
  category: string;           // e.g. "粉底液", "眼影盘"
  shadeFamily: string;        // e.g. "黄调一白", "冷调二白"
  finishType?: string;        // e.g. "哑光", "缎面"
  priceRange?: string;        // e.g. "50-100元"
  cpsUrl?: string;            // placeholder for now
}

export interface MakeupLook {
  id: string;
  name: string;               // e.g. "清冷白开水妆"
  scenario: string;           // e.g. "日常通勤", "约会甜美"
  suitableFor: string[];      // face shape / eye type / skin tone tags
  avoidFor?: string[];
  reason: string;             // short Chinese explanation
  steps: MakeupStep[];
  productHints: ProductHint[];
}
```

**Validation:**
- TypeScript compiles with `tsc --noEmit`.
- Backend and frontend import from one shared file.

**Commit:**
```bash
git add src/shared/types.ts
git commit -m "feat: add shared makeup tutor types with overlay zones and product hints"
```

---

### Task 4: Implement Selfie Upload UI

**Objective:** Let users upload an image or capture from camera, with mobile-friendly preview.

**Files:**
- Modify: `src/frontend/App.tsx`

**Behavior:**
- Accept `.jpg`, `.jpeg`, `.png`, `.webp`.
- Support camera capture on mobile (`<input capture="user">`).
- Show preview cropped to face area if detected.
- Reject files over 10MB.
- Button: `开始分析`.
- All copy in Chinese.

**Validation:**
- Upload preview works on mobile browser.
- Camera capture works on iOS Safari and Android Chrome.
- Oversized file shows friendly Chinese error.
- No network request until user taps analyze.

**Commit:**
```bash
git add src/frontend/App.tsx
git commit -m "feat: add selfie upload flow with camera capture"
```

---

### Task 5: Add Face Landmark Extraction (with MediaPipe Loading Lifecycle)

**Objective:** Extract face landmarks in browser using MediaPipe Face Landmarker, with proper loading lifecycle and error handling.

**Files:**
- Create: `src/frontend/face/landmarks.ts`
- Create: `src/frontend/face/loader.ts`
- Modify: `src/frontend/App.tsx`

**MediaPipe Loading Lifecycle:**

The MediaPipe FaceLandmarker WASM model (~4MB) must be loaded before any analysis. Loading happens exactly once, triggered when the user first opens the app (not on page load — wait for first user interaction to avoid mobile data waste).

```
User opens app (idle state)
  ↓
User taps upload → triggers model preload
  ↓
State → 'loading_model', show "正在准备化妆台..."
  ↓
Create FaceLandmarker instance from local WASM files
  ↓
On success → State → 'ready', show upload area
On failure → State → 'error', show "网络不太稳定，请刷新重试" with retry button
```

**Implementation:**
```ts
// src/frontend/face/loader.ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker: FaceLandmarker | null = null;

export async function loadModel(onProgress: (pct: number) => void): Promise<FaceLandmarker> {
  if (landmarker) return landmarker;

  // Load from local public/mp-models/ to avoid Google CDN
  const vision = await FilesetResolver.forVisionTasks(
    '/mp-models/wasm'
  );
  onProgress(0.5);

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/mp-models/face_landmarker.task',
      delegate: 'GPU',  // fall back to CPU on unsupported devices
    },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFaceBlendshapes: false,  // not needed for MVP
    outputFacialTransformationMatrixes: false,
  });
  onProgress(1.0);
  return landmarker;
}
```

**Key design decisions:**
- Model files stored in `public/mp-models/` → Vite serves them at root path.
- `delegate: 'GPU'` with automatic CPU fallback for devices without WebGPU/WebGL.
- Singleton pattern — load once, reuse across multiple analyses.
- Progress callback so the UI can show "正在准备化妆台..."

**Validation:**
- Clear selfie returns 478 normalized landmarks.
- Model loading progress reaches 100% via callback.
- Loading failure (network error, WASM not supported) shows "网络不太稳定" error with retry.
- Second analysis reuses cached model (no re-load).

**Commit:**
```bash
git add src/frontend/face/loader.ts src/frontend/face/landmarks.ts src/frontend/App.tsx public/mp-models/
git commit -m "feat: extract face landmarks from selfie with MediaPipe loading lifecycle"

---

### Task 6: Implement Face Feature Analysis (with Skin Tone Algorithm)

**Objective:** Convert landmarks + pixel data into explainable facial features, including 三庭五眼, nose type, and robust skin tone classification.

**Files:**
- Create: `src/shared/faceFeatures.ts`
- Test: `tests/faceFeatures.test.ts`

**Feature Extraction Rules:**

| Feature | Method | Landmarks Used |
|---------|--------|---------------|
| Face shape | Width/height ratio + jaw/forehead comparison | 10 (jaw), 151 (forehead), 152 (chin) |
| 三庭 — 上庭 | Distance: hairline(10) → brow(105) / face height | 10, 105, 152 |
| 三庭 — 中庭 | Distance: brow(105) → nose base(2) / face height | 105, 2, 152 |
| 三庭 — 下庭 | Distance: nose base(2) → chin(152) / face height | 2, 152 |
| 五眼 | Face width / (5 × eye width from 33→133) | 33, 133, 234, 454 |
| Eye type | Eye aspect ratio + corner angles + crease visibility | 33, 133, 159, 386, 362, 263 |
| Nose type | Bridge width ratio + tip shape + nasolabial angle | 6, 168, 197, 2, 94 |
| Lip fullness | Lip height / lip width | 0, 17, 61, 291 |
| Brow arch | Angle from brow inner→arch→tail | 105, 66, 46 |

**Skin Tone Algorithm (the hardest part):**

Strategy: extract a clean patch of skin from cheek area, convert to perceptual color space, classify.

```
Step 1: Define sampling region
  → Use cheek landmarks (index 117, 123, 187, 207) to define a 30×30px ROI
  → Use forehead landmarks (index 10, 151) for a backup 20×20px ROI

Step 2: Filter out non-skin pixels within ROI
  → Convert to LAB color space
  → Reject pixels where L < 30 (shadow) or L > 95 (highlight/specular)
  → Reject pixels where |a| > 30 (too red — possible blush/makeup)  
  → Reject pixels where |b| > 25 (too yellow — possible lighting artifact)
  → If < 50% of pixels remain after filtering, expand ROI by 10px and retry

Step 3: Compute median LAB values from filtered pixels
  → Use median, not mean (robust to outliers)
  → medianL, medianA, medianB

Step 4: Classify tone
  → Warm/Cool: check medianB vs medianA
    - medianB > 0 AND medianB > |medianA| → warm (yellow undertone)
    - medianA > 0 AND |medianA| > |medianB| → cool (pink undertone)
    - Otherwise → neutral
  → Depth: based on medianL
    - L > 75 → fair
    - L 55-75 → medium
    - L 30-55 → deep
    - L < 30 → deep_dark (unlikely from selfie, but handled)

Step 5: Assemble SkinTone enum
  → Combine warm/cool × depth into one of 8 categories
  → Attach confidence based on % of valid pixels: >70% = high, 40-70% = medium, <40% = low
```

**Confidence Calculation:**
```ts
function computeConfidence(features: Partial<FaceFeatures>): number {
  let score = 0;
  let total = 0;

  // Landmark completeness: did we get all key points?
  const requiredLandmarks = [10, 105, 152, 2, 33, 133, 234, 454, 0, 17, 61, 291];
  const completeness = requiredLandmarks.filter(id => landmarks[id]).length / requiredLandmarks.length;
  score += completeness * 0.3; total += 0.3;

  // Lighting quality: histogram spread in cheek ROI
  const lightingScore = estimateLightingQuality(cheekPixels); // 0-1
  score += lightingScore * 0.3; total += 0.3;

  // Skin pixel validity: % of pixels that passed filtering
  score += skinPixelRatio * 0.4; total += 0.4;

  return total > 0 ? score / total : 0;
}
```

**Validation:**
- Unit tests cover all face shapes with mocked landmarks.
- Unit tests for 三庭五眼: known proportions → correct ratios.
- Skin tone: warm yellow RGB → 'warm_medium', cool pink RGB → 'cool_fair'.
- Confidence < 0.4 when landmarks are sparse or lighting is poor.
- Nose type: wide bridge → 'wide_bridge', narrow → 'narrow_bridge'.

**Commit:**
```bash
git add src/shared/faceFeatures.ts tests/faceFeatures.test.ts
git commit -m "feat: analyze facial features including 三庭五眼, nose type, and robust skin tone"
```

---

### Task 7: Edge Case Handling

**Objective:** Handle common real-world selfie scenarios gracefully instead of showing generic errors.

**Files:**
- Create: `src/frontend/face/edgeCases.ts`
- Modify: `src/frontend/App.tsx`
- Test: `tests/edgeCases.test.ts`

**Edge Case Matrix:**

| Scenario | Detection | UI Response | Confidence Impact |
|----------|-----------|-------------|-------------------|
| **No face** | landmarker returns 0 faces | "请上传清晰的正面照 📷" — prompt to retake | — |
| **Multiple faces** | landmarker returns >1 face | Use largest face, show toast "已自动选择画面中最大的人脸" | None |
| **Side face / tilted** | yaw/pitch angle > 30° from frontal | "请正视镜头，拍一张正面照哦～" | Low (0.3-0.5) |
| **Dark lighting** | median L in cheek ROI < 40 | "光线有点暗，建议在自然光下拍摄" + show example | Very Low (<0.3) |
| **Glasses** | bridge area has non-skin color with sharp edges | Accept, but note "眼镜可能影响眼妆分析" | Medium (0.5-0.7) |
| **Bangs covering forehead** | forehead ROI < 30% valid skin pixels | "刘海很好看，但分析前额需要更清楚哦～可以撩一下吗？" + skip forehead analysis | Low (0.4-0.6) |
| **Heavy existing makeup** | saturation in cheek/blush area above threshold | Accept, note "检测到你已有妆容，分析结果可能受当前妆容影响" | Medium (0.5-0.7) |
| **Blurry image** | Laplacian variance < threshold | "照片有点模糊，重新拍一张清晰的吧" | Very Low (<0.3) |
| **No landmarks for key features** | e.g. brow landmarks missing | Skip affected feature, mark as 'unknown', continue with remaining features | Per-feature low |
| **EXIF rotation** | Check image EXIF Orientation tag (1-8) | Rotate image to orientation=1 before extracting landmarks | Irrelevant if handled correctly |

**Design principles:**
- Every error message is warm, actionable, never shaming.
- When possible, proceed with degraded analysis rather than blocking entirely.
- Confidence score per feature, not just one global score.
- User can always tap "继续分析" even with low confidence — never force them.

**Implementation:**
```ts
// src/frontend/face/edgeCases.ts
export interface SelfieDiagnosis {
  canProceed: boolean;
  warnings: string[];
  blocked: boolean;        // true = cannot analyze at all
  blockedReason?: string;  // only when blocked
  adjustedConfidence: number;
  skippedFeatures: string[];
}

export function diagnoseSelfie(
  landmarks: NormalizedLandmark[],
  imageData: ImageData,
  exifOrientation: number
): SelfieDiagnosis { ... }
```

**Validation:**
- Dark image → warning about lighting, confidence reduced.
- Image with glasses → accepts, confidence reduces to 0.5-0.7 range.
- Side-profile image → asks for frontal, does not proceed.
- EXIF-rotated image → landmarks extracted on correct orientation.

**Commit:**
```bash
git add src/frontend/face/edgeCases.ts src/frontend/App.tsx tests/edgeCases.test.ts
git commit -m "feat: handle edge cases — dark, glasses, bangs, makeup, blur, EXIF"
```

---

### Task 8: Create Makeup Knowledge Base

**Objective:** Store makeup rules as structured data, not hardcoded logic.

**Files:**
- Create: `data/makeup-rules/face-shapes.json`
- Create: `data/makeup-rules/eye-types.json`
- Create: `data/makeup-rules/skin-tone-guide.json`
- Create: `data/makeup-rules/looks.json`
- Create: `data/makeup-rules/tutorial-steps.json`
- Create: `data/makeup-rules/product-families.json`

**Minimum Looks (3):**
1. 清冷白开水妆 — 日常通勤
2. 蜜桃约会妆 — 约会甜美
3. 气场御姐妆 — 职场/晚宴

**Minimum Rules:**
- Round face: contour sides, lift blush diagonally, avoid horizontal eyeliner.
- Long face: contour forehead and chin, horizontal blush, avoid vertical lines.
- Square face: soften jaw contour, round blush placement.
- Heart face: contour temples and chin, avoid heavy upper-face makeup.
- Hooded/monolid eye: matte shades, avoid thick eyeliner, tightline instead.
- Close-set eyes: highlight inner corner, extend outer V.
- Wide-set eyes: deepen inner crease, keep outer corner soft.
- Cool skin: pink/plum/berry tones, avoid orange.
- Warm skin: peach/coral/bronze tones, avoid cool pink.
- Deep skin: rich jewel tones, avoid pastel.

**Product Families (CPS-ready):**
- Foundation shade ranges mapped to skin tone categories.
- Eyeshadow palette families mapped to skin tone + eye type.
- Lip color families mapped to skin tone.

**Validation:**
- All JSON files parse without errors.
- Every look references valid step IDs and overlay zones.
- Skin tone guide covers all SkinTone enum values.

**Commit:**
```bash
git add data/makeup-rules
git commit -m "feat: add initial makeup rules dataset with skin tone and product hints"
```

---

### Task 9: Build Recommendation API

**Objective:** Recommend suitable looks from face features using deterministic scoring.

**Files:**
- Create: `src/backend/routes/recommend.ts`
- Modify: `src/backend/server.ts`
- Test: `tests/recommend.test.ts`

**Behavior:**
- Input: `FaceFeatures`.
- Score each look: +points for `suitableFor` match, −points for `avoidFor` match.
- Output: top 3 `MakeupLook` objects with reasons.
- Scoring is deterministic — same input always returns same results.
- LLM polish can enhance the `reason` text but cannot change the ranking.

**Validation:**
- Round face returns looks with contour guidance.
- Cool skin tone returns looks with berry/plum tones, not orange.
- Unknown features still return safe beginner looks.
- Deterministic: same input → same output across runs.

**Commit:**
```bash
git add src/backend/routes/recommend.ts src/backend/server.ts tests/recommend.test.ts
git commit -m "feat: recommend makeup looks from face features (deterministic scoring)"
```

---

### Task 10: Render Face-Map Tutorial Canvas (with Coordinate Mapping)

**Objective:** Show makeup zones and brush directions on the user's uploaded face, with precise MediaPipe-to-Canvas coordinate mapping.

**Files:**
- Create: `src/frontend/tutorial/MakeupCanvas.tsx`
- Create: `src/frontend/tutorial/overlayZones.ts`
- Create: `src/frontend/tutorial/coordinateMapper.ts`
- Modify: `src/frontend/App.tsx`

**Coordinate Mapping:**

MediaPipe returns normalized coordinates (0-1) in image space. The canvas displays a potentially scaled/cropped version. We need a reliable mapping function.

```
Image space (MediaPipe landmarks)
  (0,0) ────────────── (1,0)
  │                      │
  │    face landmarks    │
  │                      │
  (0,1) ────────────── (1,1)

          ↓ coordinateMapper ↓

Canvas space (display)
  (0,0) ────────────── (canvasWidth, 0)
  │                      │
  │    rendered face     │
  │    + overlay zones   │
  │                      │
  (0,canvasHeight) ──── (canvasWidth, canvasHeight)
```

```ts
// src/frontend/tutorial/coordinateMapper.ts
export interface CanvasLayout {
  imageX: number;       // image left edge on canvas
  imageY: number;       // image top edge on canvas
  imageWidth: number;   // displayed image width
  imageHeight: number;  // displayed image height
  canvasWidth: number;
  canvasHeight: number;
}

export function mapLandmarkToCanvas(
  lm: { x: number; y: number },  // MediaPipe normalized 0-1
  layout: CanvasLayout
): { x: number; y: number } {
  return {
    x: layout.imageX + lm.x * layout.imageWidth,
    y: layout.imageY + lm.y * layout.imageHeight,
  };
}

export function computeCanvasLayout(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): CanvasLayout {
  // Scale image to fit canvas while maintaining aspect ratio
  const scale = Math.min(
    canvasWidth / imageWidth,
    canvasHeight / imageHeight
  );
  const displayW = imageWidth * scale;
  const displayH = imageHeight * scale;
  return {
    imageX: (canvasWidth - displayW) / 2,
    imageY: (canvasHeight - displayH) / 2,
    imageWidth: displayW,
    imageHeight: displayH,
    canvasWidth,
    canvasHeight,
  };
}

// EXIF orientation must be resolved BEFORE passing image to MediaPipe.
// Use exif-js or a simple EXIF reader to detect orientation,
// then rotate/flip the image on a temp canvas before landmark extraction.
```

**MVP Rendering:**
- Draw uploaded face onto canvas (using computed layout).
- On top: draw semi-transparent colored regions for each `OverlayZone`.
- Regions use Bezier curves between landmark points for smooth shapes.
- Draw directional arrows for `brushDirection`.
- Zone positions derived from landmarks → adapt to each user's face.
- Current step's zones highlighted (opacity 0.4); other zones dimmed (opacity 0.05).
- Must work on mobile touch (pinch zoom, pan, double-tap reset).

**Zone Rendering:**
```ts
// Each overlay zone is defined by a set of landmark indices
const ZONE_DEFINITIONS: Record<OverlayZone, { landmarks: number[]; shape: 'polygon' | 'ellipse' }> = {
  left_cheek:  { landmarks: [117, 123, 187, 207, 216, 192], shape: 'polygon' },
  left_eyelid: { landmarks: [33, 159, 158, 133, 243, 249], shape: 'polygon' },
  nose_bridge: { landmarks: [6, 168, 197, 195, 2], shape: 'polygon' },
  // ... etc
};
```

**Validation:**
- Each step highlights correct zones.
- Overlay follows face position when image is resized or canvas scrolls.
- EXIF-rotated images display and analyze correctly.
- No overlay if landmarks are missing (graceful fallback).
- Touch interactions work on mobile.

**Commit:**
```bash
git add src/frontend/tutorial src/frontend/App.tsx
git commit -m "feat: render personalized makeup tutorial overlays with coordinate mapping"

---

### Task 11: Add Step-by-Step Tutorial UI

**Objective:** Walk users through the recommended look one step at a time.

**Files:**
- Create: `src/frontend/tutorial/TutorialPanel.tsx`
- Modify: `src/frontend/App.tsx`

**Behavior:**
- Show selected look name + reason (Chinese).
- Show one step at a time with: area, instruction, tool hint, color family, warnings.
- Buttons: 上一步 / 下一步 / 重新开始.
- Progress indicator (step 3/7).
- Each step updates the face overlay.
- Product hints shown at bottom of each step (CPS placeholder).

**Validation:**
- User can walk through all steps of a look.
- Cannot advance past last step or before first step.
- Warnings display when relevant (e.g. "肿泡眼避免珠光").

**Commit:**
```bash
git add src/frontend/tutorial/TutorialPanel.tsx src/frontend/App.tsx
git commit -m "feat: add step-by-step makeup tutorial UI in Chinese"
```

---

### Task 12: Add Optional LLM Explanation Layer

**Objective:** Make recommendation reasons warmer and more personalized without changing deterministic scoring.

**Files:**
- Create: `src/backend/routes/explain.ts`
- Modify: `src/frontend/App.tsx`

**Rules:**
- LLM receives face features + selected look metadata.
- LLM must not invent medical claims or guarantee attractiveness.
- Output is short, warm, tutorial-focused Chinese text.
- If LLM fails or is slow, deterministic reason is shown as fallback.

**Prompt Template (Chinese):**
```text
你是一位温柔的美妆老师。根据用户的脸型和肤质，用一句话解释为什么这款妆容适合她。
不要提及医疗诊断，不要保证变美，要具体说化妆技巧。不超过50个字。
脸型：{faceShape}，肤质：{skinTone}，妆容：{lookName}
```

**Validation:**
- If LLM fails, deterministic reason still displays.
- Output is under 50 Chinese characters.
- No medical or guarantee language in output.

**Commit:**
```bash
git add src/backend/routes/explain.ts src/frontend/App.tsx
git commit -m "feat: add optional LLM explanation layer with fallback"
```

---

### Task 13: Add Shareable Result Card

**Objective:** Produce a Xiaohongshu/WeChat-style shareable result to validate viral potential.

**Files:**
- Create: `src/frontend/result/ResultCard.tsx`
- Modify: `src/frontend/App.tsx`

**Behavior:**
- Shows: face analysis summary, top recommended look, 3 key tips.
- Styled for Xiaohongshu screenshot aesthetics (pink tones, clean typography).
- "保存图片" button (canvas-to-image export).
- "复制文案" button for WeChat text sharing.
- No private image uploaded without user explicit action.

**Validation:**
- Result card renders correctly on mobile.
- Image export works (canvas to PNG download).
- Text copy works (clipboard API).

**Commit:**
```bash
git add src/frontend/result/ResultCard.tsx src/frontend/App.tsx
git commit -m "feat: add Xiaohongshu-style shareable result card"
```

---

### Task 14: Add Analytics Event Tracking

**Objective:** Instrument all key events so MVP success metrics can be measured.

**Files:**
- Create: `src/shared/analytics.ts`
- Modify: `src/frontend/App.tsx`

**Implementation:**
```ts
// src/shared/analytics.ts — lightweight, zero-dependency
export function track(event: string, props?: Record<string, unknown>) {
  // MVP: log to console + POST to simple backend endpoint
  console.log('[analytics]', event, props);
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, props, timestamp: Date.now() }),
  }).catch(() => {}); // fire-and-forget
}
```

Call `track()` at each milestone defined in the analytics table above. No third-party SDK — just a custom endpoint that logs to a file or lightweight DB.

**Validation:**
- Each event fires at the right moment (verify via browser console in dev).
- Failed tracking calls do not break UI (catch all errors silently).

**Commit:**
```bash
git add src/shared/analytics.ts src/frontend/App.tsx
git commit -m "feat: add event tracking for MVP success metrics"
```

---

## Files Likely To Change

| File | Task |
|------|------|
| `docs/mvp-spec.md` | T1 |
| `src/frontend/App.tsx` | T2,4,5,7,10,11,13 |
| `src/frontend/face/loader.ts` | T5 |
| `src/frontend/face/landmarks.ts` | T5 |
| `src/frontend/face/edgeCases.ts` | T7 |
| `src/frontend/tutorial/MakeupCanvas.tsx` | T10 |
| `src/frontend/tutorial/TutorialPanel.tsx` | T11 |
| `src/frontend/tutorial/overlayZones.ts` | T10 |
| `src/frontend/tutorial/coordinateMapper.ts` | T10 |
| `src/frontend/result/ResultCard.tsx` | T13 |
| `src/backend/server.ts` | T2,9 |
| `src/backend/routes/recommend.ts` | T9 |
| `src/backend/routes/explain.ts` | T12 |
| `src/shared/types.ts` | T3 |
| `src/shared/faceFeatures.ts` | T6 |
| `src/shared/analytics.ts` | T14 |
| `data/makeup-rules/*.json` (6 files) | T8 |
| `tests/faceFeatures.test.ts` | T6 |
| `tests/edgeCases.test.ts` | T7 |
| `tests/recommend.test.ts` | T9 |

## Tests / Validation

### Unit Tests (Vitest)
- `faceFeatures` handles all face shapes, 三庭五眼 ratios, nose types, skin tones with mocked landmarks.
- `edgeCases` correctly diagnoses dark/glasses/bangs/blur/EXIF scenarios.
- Recommendation scoring is deterministic (same input → same output).
- Makeup rules JSON references valid step IDs and overlay zones.
- `coordinateMapper` returns correct canvas positions for known inputs and layouts.

### Integration Tests
- Upload valid image → preview → analyze → features returned with valid 三庭五眼 and skin tone.
- Upload non-face image → friendly Chinese error.
- Upload side-face image → warning, suggests frontal.
- Recommend 3 looks → step through tutorial → overlay zones update per step.
- EXIF-rotated image → correct orientation displayed.

### Manual Product Validation
- Recruit 5-10 target users (Chinese female 18-35).
- Measure: upload rate, analysis trust score (1-5), tutorial completion rate, share rate.

## Analytics / Event Tracking

All key events fire to a lightweight analytics endpoint (e.g., Plausible or custom):

| Event | When | Key property |
|-------|------|-------------|
| `app_open` | User lands on page | — |
| `model_load` | MediaPipe WASM loaded | `duration_ms` |
| `model_load_fail` | WASM load failed | `error` |
| `upload_start` | User taps upload | — |
| `upload_reject` | File too large / wrong type | `reason` |
| `selfie_diagnosis` | Edge case check done | `warnings[]`, `confidence` |
| `analysis_complete` | FaceFeatures ready | `confidence`, `duration_ms` |
| `recommend_view` | Looks displayed | `count` |
| `look_select` | User picks a look | `look_id` |
| `tutorial_step` | Each step viewed | `step_index`, `area` |
| `tutorial_complete` | All steps done | `look_id`, `total_duration_ms` |
| `tutorial_abandon` | User leaves mid-tutorial | `step_index` |
| `result_share` | User saves/copies result | `method` (image/copy) |

## Estimated Timeline

| Phase | Tasks | Est. effort | Output |
|-------|-------|-------------|--------|
| Foundation | T1–T3 | 1 day | Spec, scaffold, types |
| Core Analysis | T4–T7 | 3 days | Upload, landmarks, features, edge cases |
| Knowledge Base | T8–T9 | 2 days | Makeup rules, recommendation engine |
| Tutorial UI | T10–T11 | 2 days | Canvas overlay, step-by-step panel |
| Polish & Share | T12–T14 | 1.5 days | LLM polish, result card, analytics |
| Testing & QA | All | 1 day | Manual user testing |

**Total MVP: ~10 working days** (2 weeks) for a single developer.

## Risks / Tradeoffs

- **Face analysis accuracy:** MVP rules are approximate. Mitigate with confidence score and non-absolute language ("更适合" not "缺陷").
- **Skin tone estimation:** RGB-to-tone mapping is error-prone under bad lighting. Mitigated by the robust 5-step algorithm with pixel filtering and outlier rejection; still mark low-confidence results.
- **Beauty advice sensitivity:** Never say a face is flawed. Always frame as "enhancing" and "suiting". All copy reviewed before commit.
- **Privacy:** Prefer browser-side landmarks. Do not store selfies by default. Explicit consent for any cloud upload.
- **MediaPipe WASM size:** 4MB on first load is slow on Chinese mobile 4G (~2-5s). Mitigated by local hosting + loading state UI + singleton caching.
- **Makeup expertise:** Need human-reviewed makeup rules. Initial rules from systematic curation of verified Chinese beauty sources; plan for makeup artist review before scale.
- **Mobile browser compatibility:** Test on iOS Safari 17+ and Android Chrome 120+. Known issue: `delegate: 'GPU'` may not work on some Android devices — CPU fallback is automatic but slower.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Platform | Mobile-first web app（最快迭代，无需审核） |
| 2 | Visual style | **闺蜜感粉色系** — 柔粉主色、圆角卡片、手写体点缀、温暖不冷感 |
| 3 | Backend language | **纯 TypeScript 全栈** — 前后端类型共享，MVP 最快 |

## Remaining Open Questions

1. First audience: complete beginners, college students, office workers, or photo/video creators?
2. Product monetization: CPS first, subscription first, or paid report first?
3. Privacy stance: fully local analysis first, or allow cloud upload with consent?

## First Success Milestone

> A Chinese female user uploads one selfie, receives a believable face-feature analysis (including skin tone), chooses a recommended look, and completes a 7-step personalized makeup tutorial with face overlays — then shares the result card.
