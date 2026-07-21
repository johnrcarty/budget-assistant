export default function SummaryLoading() {
  return (
    <div>
      <header className="px-4 pt-6 pb-4">
        <div className="h-8 w-36 animate-pulse rounded bg-muted" />
      </header>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="h-10 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-[440px] animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
