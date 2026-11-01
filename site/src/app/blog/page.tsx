import Link from "next/link";
import { getBlogPosts } from "@/lib/content";

export default function BlogIndex() {
  const posts = getBlogPosts();

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <Link href="/" className="mb-8 block text-sm text-zinc-500 hover:text-zinc-300">
        &larr; Home
      </Link>
      <h1 className="mb-10 text-2xl font-bold">Blog</h1>
      {posts.length === 0 ? (
        <p className="text-zinc-500">No posts yet.</p>
      ) : (
        <ul className="flex flex-col gap-8">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="group block">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-medium group-hover:text-zinc-300">{post.title}</h2>
                  <span className="shrink-0 text-xs text-zinc-600">{post.published}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-500">{post.oneLiner}</p>
                <span className="mt-1 inline-block text-xs text-zinc-600">{post.tag}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
