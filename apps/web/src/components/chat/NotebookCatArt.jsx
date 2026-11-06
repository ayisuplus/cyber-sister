import { useId } from 'react'
import { petImage } from '../../features/pets'

// 用原画的两层拼出身子和尾巴，绕尾根摆动；身体压住接缝，不改动素材。
const BODY_EDGE = 'H608 C610 270 587 307 551 328 C497 361 430 361 369 359 C351 357 335 360 326 376 L312 465'
const FRAMES = ['sleep', 'awake', 'happy', 'stretch']

export default function NotebookCatArt({ frame, onError }) {
  const id = useId()
  const body = `${id}-body`
  const tail = `${id}-tail`
  const eyes = `${id}-eyes`
  return (
    <svg className="notebook-cat__art" viewBox="0 0 640 465" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={body}><path d={`M0 0 H640 V226 ${BODY_EDGE} H0 Z`} /></clipPath>
        <clipPath id={tail}><path d={`M640 226 ${BODY_EDGE} H640 Z`} /></clipPath>
        <clipPath id={eyes}>
          <ellipse cx="136" cy="269" rx="39" ry="35" />
          <ellipse cx="245" cy="232" rx="36" ry="35" />
        </clipPath>
      </defs>
      {FRAMES.map((pose) => {
        const src = petImage('cat', pose, { small: true })
        return (
          <g key={pose} className="notebook-cat__pose" data-pose={pose} data-active={pose === frame} style={{ opacity: pose === frame ? 1 : 0 }}>
            <g className="notebook-cat__tail">
              <image href={src} width="640" height="465" clipPath={`url(#${tail})`} />
            </g>
            <image href={src} width="640" height="465" clipPath={`url(#${body})`} onError={onError} />
            {pose === 'awake' && (
              <image
                className="notebook-cat__blink"
                href={petImage('cat', 'sleep', { small: true })}
                width="640" height="465" clipPath={`url(#${eyes})`}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
