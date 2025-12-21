import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Arthyx | Financial Document Intelligence",
  description:
    "Advanced multilingual financial document analysis with RAG, knowledge graphs, and pre-trained SEBI/RBI expertise. Supports 50MB files and Indian languages.",
  keywords: [
    "financial analysis",
    "document analysis",
    "OCR",
    "Hindi",
    "multilingual",
    "AI assistant",
    "SEBI",
    "RBI",
    "quantitative finance",
  ],
  authors: [{ name: "Arthyx" }],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Arthyx | Financial Document Intelligence",
    description:
      "Advanced multilingual financial document analysis powered by AI with SEBI/RBI expertise",
    type: "website",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Arthyx | Financial Document Intelligence",
    description: "Advanced multilingual financial document analysis powered by AI",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
