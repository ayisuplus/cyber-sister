// 天气页那一大幅简笔画：本机 ComfyUI 画的七张（来源见 design-assets/weather/weather-assets.json），
// 加上一层很轻的动画——太阳慢慢晃、云慢慢飘、雨点和雪花往下落、雾丝左右漂。不闪、不吓人；
// 减少动态效果时只留静止的画（画上本来就有雨点和雪花）。全部是装饰，文字另外写。

export const WEATHER_KINDS = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'thunder']

const DROPS = [
  { left: '28%', delay: '0s' }, { left: '40%', delay: '.45s' }, { left: '52%', delay: '.9s' },
  { left: '64%', delay: '.2s' }, { left: '34%', delay: '1.1s' }, { left: '58%', delay: '.65s' },
]
const FLAKES = [
  { left: '22%', delay: '0s', dur: '4.2s' }, { left: '38%', delay: '1.4s', dur: '5s' }, { left: '54%', delay: '.6s', dur: '4.6s' },
  { left: '70%', delay: '2.1s', dur: '5.4s' }, { left: '46%', delay: '3s', dur: '4.8s' },
]

function Drop() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
      <path d="M4 1 C6 4.5 7 6.5 7 8 A3 3 0 0 1 1 8 C1 6.5 2 4.5 4 1 Z" fill="#9CC3E6" stroke="#2F3A5A" strokeWidth="1" />
    </svg>
  )
}

function Flake() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 V11 M1.7 3.5 L10.3 8.5 M1.7 8.5 L10.3 3.5" stroke="#8FA8C8" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function Mist() {
  return (
    <svg width="120" height="16" viewBox="0 0 120 16" aria-hidden="true">
      <path d="M2 8 C18 2 30 14 46 8 S74 2 90 8 S110 14 118 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export default function WeatherScene({ icon, className = '' }) {
  const kind = WEATHER_KINDS.includes(icon) ? icon : 'cloudy'
  return (
    <div className={`weather-scene weather-scene--${kind} ${className}`} data-kind={kind} aria-hidden="true">
      <div className="weather-scene__halo" />
      <img src={`/design-assets/weather/${kind}.webp`} alt="" draggable={false} className="weather-scene__art" />
      {(kind === 'rain' || kind === 'thunder') && DROPS.map((drop, index) => (
        <span key={index} className="weather-scene__drop" style={{ left: drop.left, animationDelay: drop.delay }}><Drop /></span>
      ))}
      {kind === 'snow' && FLAKES.map((flake, index) => (
        <span key={index} className="weather-scene__flake" style={{ left: flake.left, animationDelay: flake.delay, animationDuration: flake.dur }}><Flake /></span>
      ))}
      {kind === 'fog' && [0, 1].map((index) => (
        <span key={index} className={`weather-scene__mist weather-scene__mist--${index}`}><Mist /></span>
      ))}
    </div>
  )
}
