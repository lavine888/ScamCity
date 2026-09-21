import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScamCity · AI Society Simulation Lab",
  description: "Test interventions on synthetic societies before deploying them in the real world.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

