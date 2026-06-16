// MediaPipe 归一化坐标 (0..1) ↔ Canvas 像素坐标映射.
// Canvas 通常与图片宽高比不一致,需要等比缩放居中.

/**
 * 描述图片在 Canvas 上的显示布局.
 * imageX/Y 是图片左上角在 Canvas 里的像素偏移.
 * imageWidth/Height 是缩放后图片在 Canvas 上的实际像素尺寸.
 */
export interface CanvasLayout {
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * 等比缩放图片到 Canvas 中并居中.返回布局,后续用 layout 转换坐标.
 */
export function computeCanvasLayout(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): CanvasLayout {
  if (imageWidth <= 0 || imageHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      imageX: 0,
      imageY: 0,
      imageWidth: 0,
      imageHeight: 0,
      canvasWidth,
      canvasHeight,
    };
  }
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
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

/**
 * 将 MediaPipe 归一化坐标 (0..1) 映射到 Canvas 像素坐标.
 * 用 imageX/Y + imageWidth/Height 做仿射变换,不做旋转.
 */
export function mapLandmarkToCanvas(
  landmark: { x: number; y: number },
  layout: CanvasLayout
): { x: number; y: number } {
  return {
    x: layout.imageX + landmark.x * layout.imageWidth,
    y: layout.imageY + landmark.y * layout.imageHeight,
  };
}

/**
 * 批量映射.输入归一化坐标数组,返回 Canvas 像素坐标数组.
 */
export function mapLandmarksToCanvas(
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  layout: CanvasLayout
): Array<{ x: number; y: number }> {
  return landmarks.map((lm) => mapLandmarkToCanvas(lm, layout));
}
