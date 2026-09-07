export default function EmptyState({ icon: Icon = null, title, description = '', action = null }) {
  return (
    <div className="py-12 text-center">
      {Icon ? <Icon size={44} className="mx-auto mb-3 text-text-muted" aria-hidden="true" /> : null}
      <p className="text-sm text-text-muted">{title}</p>
      {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
      {action}
    </div>
  )
}
