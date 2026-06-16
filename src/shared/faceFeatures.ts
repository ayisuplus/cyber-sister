// Shared face-feature analysis entry point.
// Skeleton only — full geometric + skin-tone logic lands in Task 6.

import type {
  EyeType,
  FaceFeatures,
  FaceShape,
  NoseType,
  SkinTone,
} from './types';

/**
 * Minimal landmark shape expected from the face-detection layer.
 * Coordinates are normalized [0..1] in the image plane.
 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/**
 * Raw pixel data block, used for skin-tone estimation in Task 6.
 * Optional in the skeleton so unit tests can call without an image.
 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const UNKNOWN_FEATURES: FaceFeatures = {
  upperThirdRatio: 0,
  middleThirdRatio: 0,
  lowerThirdRatio: 0,
  fiveEyeFit: 0,
  faceShape: 'unknown',
  skinTone: 'unknown',
  eyeType: 'unknown',
  noseType: 'unknown',
  eyeDistanceRatio: 0,
  faceWidthHeightRatio: 0,
  lipFullnessRatio: 0,
  browArchAngle: 0,
  noseBridgeWidth: 0,
  confidence: 0,
};

/**
 * Analyze MediaPipe-style face landmarks + image pixels into a FaceFeatures
 * summary. Skeleton returns `unknown` for all categorical fields and 0 for
 * numeric ratios. Task 6 fills in the real geometric and color math.
 */
export function analyzeFeatures(
  landmarks: Landmark[],
  pixels?: PixelBuffer
): FaceFeatures {
  if (!landmarks || landmarks.length === 0) {
    return { ...UNKNOWN_FEATURES };
  }
  // Task 6 will compute:
  //   - three-fifths ratios from key landmark indices
  //   - eye distance ratio, face width/height ratio
  //   - lip fullness, brow arch angle, nose bridge width
  //   - face shape classifier from ratios
  //   - eye type heuristics from eyelid landmarks
  //   - nose type from bridge/tip landmarks
  //   - skin tone from sampled pixels in cheek/forehead patches
  void pixels;
  return { ...UNKNOWN_FEATURES };
}

/**
 * Helper used by the recommender and explainer to compare against the
 * catalog rules without having to special-case 'unknown' everywhere.
 */
export function isUnknownFeature(features: FaceFeatures): boolean {
  return (
    features.faceShape === 'unknown' &&
    features.eyeType === 'unknown' &&
    features.noseType === 'unknown' &&
    features.skinTone === 'unknown' &&
    features.confidence === 0
  );
}

/**
 * Convenience type-guards for narrowing `unknown` enums.
 */
export function isKnownShape(value: FaceShape): value is Exclude<FaceShape, 'unknown'> {
  return value !== 'unknown';
}

export function isKnownEyeType(value: EyeType): value is Exclude<EyeType, 'unknown'> {
  return value !== 'unknown';
}

export function isKnownNoseType(value: NoseType): value is Exclude<NoseType, 'unknown'> {
  return value !== 'unknown';
}

export function isKnownSkinTone(value: SkinTone): value is Exclude<SkinTone, 'unknown'> {
  return value !== 'unknown';
}
