import { forwardRef, useImperativeHandle, useRef } from 'react'

// 美颜相机的结果画布：父组件通过 ref.draw(frameCanvas) 把处理后的帧画进来。
// jsdom 等没有 2D 上下文的环境里静默跳过绘制，保证页面逻辑可测。
const BeautyCanvas = forwardRef(function BeautyCanvas(
  /** @type {{ label: string }} */ { label },
  /** @type {import('react').ForwardedRef<{ draw(frame: HTMLCanvasElement | null | undefined): void }>} */ ref,
) {
  const canvasRef = useRef(null)

  useImperativeHandle(ref, () => ({
    draw(frame) {
      const canvas = canvasRef.current
      if (!canvas || !frame) return
      if (frame.width > 0 && canvas.width !== frame.width) canvas.width = frame.width
      if (frame.height > 0 && canvas.height !== frame.height) canvas.height = frame.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(frame, 0, 0)
    },
  }), [])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="max-h-[55vh] w-full rounded-2xl bg-black object-contain"
    />
  )
})

export default BeautyCanvas
