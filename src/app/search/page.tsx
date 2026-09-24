import Link from "next/link";
import { SearchForm } from "@/components/search-form";
import { SearchResults } from "@/components/search-results";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  return (
    <main className="results">
      <SearchForm compact initialQuery={q} />
      <SearchResults query={q} />
      <p className="hint"><Link href="/">SonsiSearchホームへ</Link></p>
    </main>
  );
}
