import type { Metadata } from "next";
import { Cormorant_Garamond, JetBrains_Mono, Nunito_Sans } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Family Life Calendar",
  description: "Зеркало прожитого дня для семьи",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${nunitoSans.variable} ${jetbrainsMono.variable} ${cormorant.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
