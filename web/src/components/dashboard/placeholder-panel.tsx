export function PlaceholderPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-dashed border-border p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
