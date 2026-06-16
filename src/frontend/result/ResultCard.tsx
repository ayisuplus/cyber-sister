// Placeholder — final share card lands in Task 8.
interface Props {
  imageUrl: string;
  lookName: string;
  shareText: string;
}

export default function ResultCard({ imageUrl, lookName, shareText }: Props) {
  return (
    <div className="bg-white rounded-card shadow-soft p-4 max-w-sm">
      <img src={imageUrl} alt={lookName} className="rounded-card mb-3" />
      <h3 className="font-hand text-2xl text-accent mb-1">{lookName}</h3>
      <p className="text-sm text-ink/70">{shareText}</p>
    </div>
  );
}
