import { AppHeader } from "@/components/layout/AppHeader";

export default function TodayPage() {
  return (
    <div>
      <AppHeader title="Today" />
      <div className="p-4 text-muted-foreground">
        Nothing here yet — head to the Budget tab to get started.
      </div>
    </div>
  );
}
