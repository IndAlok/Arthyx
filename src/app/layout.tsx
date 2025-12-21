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
    "Advanced multilingual financial document analysis. Upload documents in any format, get intelligent insights, visualizations, and accurate answers.",
  keywords: [
    "financial analysis",
    "document analysis",
    "OCR",
    "Hindi",
    "multilingual",
    "AI assistant",
  ],
  authors: [{ name: "Arthyx" }],
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Arthyx | Financial Document Intelligence",
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
