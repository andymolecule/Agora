import { PostClient } from "./PostClient";

export default function PostPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--color-warm-100)_0%,#f7f4ee_52%,#fffdf8_100%)] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PostClient />
    </main>
  );
}
