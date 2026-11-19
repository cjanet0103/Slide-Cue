import Link from "next/link";

// Temporary entry page; the full intro page is built in stage 5.
export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 40, letterSpacing: -1, lineHeight: 1.1 }}>SlideCue</h1>
      <p>슬라이드별 발표 시간을 재고, 실전에서 말하는 구절을 따라가는 발표 연습 서비스</p>
      <p>
        <Link href="/app">내 자료로 연습하기 →</Link>
      </p>
    </main>
  );
}
