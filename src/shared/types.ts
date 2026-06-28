// Shared domain types used by both frontend and backend.
// Keep this file dependency-free — no React, no Node-only modules.

export type FaceShape = 'oval' | 'round' | 'square' | 'heart' | 'long' | 'diamond' | 'unknown';

export type SkinTone =
  | 'cool_fair'
  | 'cool_medium'
  | 'neutral_fair'
  | 'neutral_medium'
  | 'warm_fair'
  | 'warm_medium'
  | 'warm_deep'
  | 'warm_deep_dark'
  | 'unknown';

export type EyeType =
  | 'almond'
  | 'round'
  | 'hooded'
  | 'monolid'
  | 'downturned'
  | 'upturned'
  | 'close_set'
  | 'wide_set'
  | 'unknown';

export type NoseType =
  | 'straight'
  | 'wide_bridge'
  | 'narrow_bridge'
  | 'bulbus_tip'
  | 'upturned'
  | 'hooked'
  | 'unknown';

export interface FaceFeatures {
  upperThirdRatio: number;
  middleThirdRatio: number;
  lowerThirdRatio: number;
  fiveEyeFit: number;
  faceShape: FaceShape;
  skinTone: SkinTone;
  eyeType: EyeType;
  noseType: NoseType;
  eyeDistanceRatio: number;
  faceWidthHeightRatio: number;
  lipFullnessRatio: number;
  browArchAngle: number;
  noseBridgeWidth: number;
  confidence: number;
}

export type OverlayZone =
  | 'forehead'
  | 't_zone'
  | 'u_zone'
  | 'left_cheek'
  | 'right_cheek'
  | 'chin'
  | 'left_eye'
  | 'right_eye'
  | 'left_eyelid'
  | 'right_eyelid'
  | 'inner_corner_l'
  | 'inner_corner_r'
  | 'outer_corner_l'
  | 'outer_corner_r'
  | 'crease_l'
  | 'crease_r'
  | 'left_brow'
  | 'right_brow'
  | 'brow_tail_l'
  | 'brow_tail_r'
  | 'nose_bridge'
  | 'nose_tip'
  | 'nose_sides'
  | 'upper_lip'
  | 'lower_lip'
  | 'lip_line'
  | 'left_highlight'
  | 'right_highlight'
  | 'cupid_bow';

export type MakeupArea =
  | 'base'
  | 'concealer'
  | 'contour'
  | 'highlight'
  | 'brow'
  | 'eye'
  | 'eyeliner'
  | 'lash'
  | 'blush'
  | 'lip'
  | 'nose';

export interface MakeupStep {
  id: string;
  title: string;
  area: MakeupArea;
  instruction: string;
  overlayZones: OverlayZone[];
  brushDirection?: string;
  toolHint?: string;
  colorFamily?: string;
  warnings?: string[];
  order: number;
}

export interface ProductHint {
  category: string;
  shadeFamily: string;
  finishType?: string;
  priceRange?: string;
  cpsUrl?: string;
}

export interface MakeupLook {
  id: string;
  name: string;
  scenario: string;
  suitableFor: string[];
  avoidFor?: string[];
  reason: string;
  steps: MakeupStep[];
  productHints: ProductHint[];
  /** Optional LoRA / diffusion prompt trigger keywords. */
  trigger?: string;
}

// =========================================================================
// Image Generation (large-model integration)
// =========================================================================

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface UploadResponse {
  imageId: string;
  url: string;
  size: number;
}

export interface GenerationRequest {
  imageId: string;
  style: string;
  features?: FaceFeatures;
}

export interface GenerationResponse {
  jobId: string;
  status: JobStatus;
}

export interface GenerationStatusResponse {
  jobId: string;
  status: JobStatus;
  resultUrl?: string;
  error?: string;
  tookMs?: number;
  /** 0..1, optional provider-reported progress. */
  progress?: number;
}

/** Internal job record kept on the server. */
export interface GenerationJob {
  id: string;
  status: JobStatus;
  imageId: string;
  style: string;
  sessionId: string | null;
  /** Provider name used (e.g. "mock", "replicate"). */
  provider: string;
  prompt: string;
  resultUrl?: string;
  error?: string;
  /** Optional progress 0..1 for providers that report it. */
  progress?: number;
  createdAt: number;
  updatedAt: number;
}

// =========================================================================
// 教学资源 (post-tutorial navigation)
// =========================================================================

export type TeachingResourceKind = 'article' | 'video';

export interface TeachingResource {
  id: string;
  /** 关联的妆容 id (来自 MakeupLook.id); 空字符串 = 全局. */
  lookId: string;
  /** 'article' = 图文; 'video' = 视频. */
  kind: TeachingResourceKind;
  title: string;
  /** 简短描述 (1-2 行). */
  summary: string;
  /** 图文资源: Markdown/纯文本 body. 视频资源: 可以为空 (用 videoUrl). */
  body?: string;
  /** 文章封面图 (可选). */
  coverImage?: string;
  /** 视频 URL (文章资源可空). */
  videoUrl?: string;
  /** 视频时长 (秒), 仅 kind=video. */
  durationSec?: number;
  /** 作者/来源. */
  author?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
