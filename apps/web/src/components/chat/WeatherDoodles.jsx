// 天气小图标：和枝叶同一套线稿语言——细线、圆头、currentColor（跟着日夜配色走），全部为装饰（aria-hidden）。
// 文字本身已经写了天气，图标只是陪衬。

const CLOUD = 'M7 17.5 H17 a3.6 3.6 0 0 0 0.4 -7.2 A5 5 0 0 0 7.8 9.4 A4 4 0 0 0 7 17.5 Z'

function Sun({ cx = 12, cy = 12, r = 4, rays = true }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} />
      {rays && [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        const x1 = cx + Math.cos(rad) * (r + 2.2)
        const y1 = cy + Math.sin(rad) * (r + 2.2)
        const x2 = cx + Math.cos(rad) * (r + 4)
        const y2 = cy + Math.sin(rad) * (r + 4)
        return <path key={deg} d={`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`} />
      })}
    </>
  )
}

const SHAPES = {
  clear: <Sun />,
  partly: (
    <>
      <Sun cx={9} cy={8.5} r={3.2} />
      <path d={CLOUD} transform="translate(2 2.5) scale(0.9)" fill="var(--cs-surface-card)" />
    </>
  ),
  cloudy: <path d={CLOUD} transform="translate(0 -1)" />,
  fog: (
    <>
      <path d={CLOUD} transform="translate(0 -3.5)" />
      <path d="M5 18 H19 M7 21 H17" />
    </>
  ),
  rain: (
    <>
      <path d={CLOUD} transform="translate(0 -3.5)" />
      <path d="M8.5 17.5 L7.5 20.5 M12.5 17.5 L11.5 20.5 M16.5 17.5 L15.5 20.5" />
    </>
  ),
  snow: (
    <>
      <path d={CLOUD} transform="translate(0 -3.5)" />
      <path d="M8 18.5 v2.4 M6.8 19.7 h2.4 M12 18.5 v2.4 M10.8 19.7 h2.4 M16 18.5 v2.4 M14.8 19.7 h2.4" />
    </>
  ),
  thunder: (
    <>
      <path d={CLOUD} transform="translate(0 -3.5)" />
      <path d="M12.5 15.5 L10.5 19 H13 L11.5 22" />
    </>
  ),
}

export function WeatherIcon({ icon, size = 16, className = '' }) {
  const shape = SHAPES[icon] ?? SHAPES.cloudy
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      data-weather-icon={icon}
    >
      {shape}
    </svg>
  )
}
