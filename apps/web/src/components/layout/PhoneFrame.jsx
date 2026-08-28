/**
 * PhoneFrame — Responsive Layout Container
 *
 * Desktop (>=768px): Centered phone frame with rounded corners
 * Mobile (<768px): Full screen, no frame
 */
export default function PhoneFrame({ children }) {
  return (
    <div className="phone-frame">
      {children}
    </div>
  )
}
