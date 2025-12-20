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
  title: "Arthyx | AI Financial Document Assistant",
  description:
    "Advanced multilingual financial document analysis powered by AI. Upload documents in any format, get intelligent insights, visualizations, and answers.",
  keywords: [
    "financial analysis",
    "AI assistant",
    "document analysis",
    "OCR",
    "Hindi",
    "multilingual",
    "RAG",
  ],
  authors: [{ name: "Arthyx" }],
  openGraph: {
    title: "Arthyx | AI Financial Document Assistant",
    description:
      "Advanced multilingual financial document analysis powered by AI",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
