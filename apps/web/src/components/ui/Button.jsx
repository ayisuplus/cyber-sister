// 44px 触控高度 + 14px 控件圆角（V3.0 §3）；无 ghost 变体——没有调用方
const VARIANTS = {
  primary: 'bg-action-primary hover:bg-action-hover text-text-inverse shadow-button hover:shadow-md',
  secondary: 'border border-border-default bg-surface-card text-text-secondary hover:bg-surface-muted',
  danger: 'bg-danger text-text-inverse hover:opacity-90',
}
export default function Button(/** @type {{ variant?: 'primary'|'secondary'|'danger', className?: string, type?: 'button'|'submit'|'reset' } & Record<string, any>} */ { variant = 'primary', className = '', type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-300 ease-calm focus-visible:ring-2 focus-visible:ring-status-info active:scale-[0.98] disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}
