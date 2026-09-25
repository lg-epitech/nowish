import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link className="wordmark" href="/" aria-label="Nowish home">
        <BrandMark />
        <span>Nowish</span>
      </Link>

      <Show
        when="signed-in"
        fallback={
          <SignInButton mode="modal" forceRedirectUrl="/">
            <button className="btn btn--quiet" type="button">
              Sign in
            </button>
          </SignInButton>
        }
      >
        <UserButton appearance={{ elements: { avatarBox: "topbar__avatar" } }} />
      </Show>
    </header>
  );
}
