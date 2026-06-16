// Placeholder — landmark → screen pixel mapping lands in Task 6.
import type { FaceLandmark } from '../face/landmarks';

export function mapToCanvas(
  landmark: FaceLandmark,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  return {
    x: landmark.x * imageWidth,
    y: landmark.y * imageHeight,
  };
}
