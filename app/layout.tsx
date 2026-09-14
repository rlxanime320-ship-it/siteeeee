import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIDdow — Beyond the stream",
  description: "A new perspective on your media. Analyze authorized public video, explore its real source quality, and make it yours with VIDdow.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
