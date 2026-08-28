export function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="float-orb animate-orb-a"
        style={{ width: 280, height: 280, top: '-80px', left: '-60px' }}
      />
      <div
        className="float-orb animate-orb-b"
        style={{ width: 220, height: 220, bottom: '-40px', right: '-50px' }}
      />
      <div
        className="float-orb animate-orb-c"
        style={{ width: 160, height: 160, top: '40%', right: '-30px' }}
      />
    </div>
  );
}
