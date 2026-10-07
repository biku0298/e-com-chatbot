import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { STORE_CONFIG } from "@/lib/config";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: `${STORE_CONFIG.assistantName} — ${STORE_CONFIG.storeName} Shopping Assistant`,
  description: `Find the perfect kids' clothing with ${STORE_CONFIG.assistantName}, your AI shopping assistant at ${STORE_CONFIG.storeName}.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>{children}</body>
    </html>
  );
}
