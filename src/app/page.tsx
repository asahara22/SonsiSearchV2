import { SearchForm } from "@/components/search-form";
import { RecentSites } from "@/components/recent-sites";

export default function HomePage() {
  return (
    <main className="home page-enter">
      <div className="hero-orbit" aria-hidden="true"><span>◉</span></div>
      <p className="eyebrow">YOUR WINDOW TO THE WEB</p>
      <h1 className="wordmark">Search the<br/><span>open web.</span></h1>
      <p className="tagline">見つけて、そのまま読む。</p>
      <SearchForm />
      <p className="hint">Enter a search or a web address to get started</p>
      <RecentSites />
    </main>
  );
}
