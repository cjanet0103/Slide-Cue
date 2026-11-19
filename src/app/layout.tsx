import type { Metadata } from "next";
import { Inter, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoKr = Noto_Sans_KR({
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-kr",
  preload: false,
});

export const metadata: Metadata = {
  title: "SlideCue",
  description: "슬라이드별 발표 시간을 재고, 실전에서 말하는 구절을 따라가는 발표 연습 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${inter.variable} ${notoKr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
