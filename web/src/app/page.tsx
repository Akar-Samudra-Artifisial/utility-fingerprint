import { Suspense } from "react";

import { Dashboard } from "@/components/dashboard/dashboard";

function DashboardFallback() {
  return (
    <div className="grid flex-1 place-items-center text-sm text-muted-foreground" aria-busy="true">
      Loading Utility Fingerprint…
    </div>
  );
}

export default function Home() {
  return (
    // The dashboard reads its filters from the URL, so it renders on the client inside Suspense.
    <Suspense fallback={<DashboardFallback />}>
      <Dashboard />
    </Suspense>
  );
}
