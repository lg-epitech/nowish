import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";

import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-sans",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

export const metadata: Metadata = {
  title: {
    default: "Nowish",
    template: "%s | Nowish",
  },
  description:
    "Log how long things actually take. Nowish learns your rhythm and tells you whether now is a good time to shower, do laundry, or anything else.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1514" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={bricolage.variable} suppressHydrationWarning>
      <body>
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "var(--ink)",
              colorPrimaryForeground: "var(--surface)",
              colorForeground: "var(--ink)",
              colorMutedForeground: "var(--ink-2)",
              colorBackground: "var(--surface)",
              colorInput: "var(--page)",
              colorInputForeground: "var(--ink)",
              colorNeutral: "var(--ink)",
              borderRadius: "0.75rem",
              fontFamily: "var(--font-sans), system-ui, sans-serif",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
