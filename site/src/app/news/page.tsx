import Link from "next/link";
import { getNewsDigests } from "@/lib/content";

export default function NewsIndex() {
  const digests = getNewsDigests();

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/" className="mb-8 block text-sm text-zinc-500 hover:text-zinc-300">
        &larr; Home
      </Link>
      <h1 className="mb-10 text-2xl font-bold">News</h1>
      <p className="mb-8 text-sm text-zinc-500">
        Daily digest of AI, markets, and what matters.
      </p>
      {digests.length === 0 ? (
        <p className="text-zinc-500">No digests yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {digests.map((d) => (
            <li key={d.slug}>
              <Link href={`/news/${d.slug}`} className="group flex items-baseline justify-between gap-4">
                <h2 className="font-medium group-hover:text-zinc-300">{d.title}</h2>
                <span className="shrink-0 text-xs text-zinc-600">{d.date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
