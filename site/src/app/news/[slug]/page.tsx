import Link from "next/link";
import { getNewsDigest, getNewsDigests } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getNewsDigests().map((d) => ({ slug: d.slug }));
}

export default async function DigestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const digest = getNewsDigest(slug);
  if (!digest) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/news" className="mb-8 block text-sm text-zinc-500 hover:text-zinc-300">
        &larr; News
      </Link>
      <header className="mb-10">
        <h1 className="text-2xl font-bold leading-tight">{digest.meta.title}</h1>
        <span className="mt-2 block text-xs text-zinc-500">{digest.meta.date}</span>
      </header>
      <article className="text-zinc-300">
        <Markdown content={digest.body} />
      </article>
      <footer className="mt-16 border-t border-zinc-800 pt-6">
        <Link href="/news" className="text-sm text-zinc-500 hover:text-zinc-300">
          &larr; All digests
        </Link>
      </footer>
    </div>
  );
}
