import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALMA · Hotel Choice Study",
  description:
    "A short, anonymous study on how travellers choose hotels. Helps calibrate the ALMA-GraphRAG recommendation model.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
