// onDark 用于深色（品牌色）按钮内，与登录页提交态一致
export default function Spinner({ onDark = false }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 ${onDark ? 'border-pastel-blush border-t-surface-card' : 'border-border-subtle border-t-action-primary'}`}
    />
  )
}
