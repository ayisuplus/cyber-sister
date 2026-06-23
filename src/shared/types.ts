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
}
