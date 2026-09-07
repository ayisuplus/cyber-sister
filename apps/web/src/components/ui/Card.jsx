export default function Card({ className = '', ...rest }) {
  return <div className={`rounded-card bg-surface-card shadow-card ${className}`} {...rest} />
}
