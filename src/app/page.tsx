import { Show } from "@clerk/nextjs";

import { Dashboard } from "@/components/dashboard";
import { Landing } from "@/components/landing";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <div className="shell">
      <SiteHeader />
      <main className="shell__main">
        <Show when="signed-in" fallback={<Landing />}>
          <Dashboard />
        </Show>
      </main>
      <SiteFooter />
    </div>
  );
}
