// Placeholder — full MediaPipe FaceLandmarker wiring lands in Task 5.
export type FaceLandmark = { x: number; y: number; z: number };

export const FACE_LANDMARK_COUNT = 478;

export function emptyLandmarks(): FaceLandmark[] {
  return new Array(FACE_LANDMARK_COUNT).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
}
