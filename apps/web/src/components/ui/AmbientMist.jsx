// 静谧层环境光：三团缓慢漂移的晨雾（夜间为月下森林的微光）+ 极淡纸张颗粒。
// 纯装饰：不进无障碍树、不接收指针；只动 transform，reduced-motion 下静止（样式见 globals.css）。
export default function AmbientMist() {
  return (
    <div className="ambient-mist" aria-hidden="true">
      <span className="ambient-mist__orb" />
      <span className="ambient-mist__orb" />
      <span className="ambient-mist__orb" />
    </div>
  )
}
