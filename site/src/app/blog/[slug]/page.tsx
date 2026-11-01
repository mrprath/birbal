import Link from "next/link";
import { getBlogPost, getBlogPosts } from "@/lib/content";
import { Markdown } from "@/components/Markdown";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getBlogPosts().map((p) => ({ slug: p.slug }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/blog" className="mb-8 block text-sm text-zinc-500 hover:text-zinc-300">
        &larr; Blog
      </Link>
      <header className="mb-10">
        <h1 className="text-2xl font-bold leading-tight">{post.meta.title}</h1>
        <div className="mt-2 flex gap-3 text-xs text-zinc-500">
          <span>{post.meta.published}</span>
          <span>{post.meta.tag}</span>
        </div>
      </header>
      <article className="text-zinc-300">
        <Markdown content={post.body} />
      </article>
      <footer className="mt-16 border-t border-zinc-800 pt-6">
        <Link href="/blog" className="text-sm text-zinc-500 hover:text-zinc-300">
          &larr; All posts
        </Link>
      </footer>
    </div>
  );
}
