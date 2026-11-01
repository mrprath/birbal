"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { IntroAnimation } from "@/components/IntroAnimation";
import { Subscribe } from "@/components/Subscribe";

type Post = {
  slug: string;
  title: string;
  tag: string;
  oneLiner: string;
  published: string;
};

export function Landing({ posts }: { posts: Post[] }) {
  const [showContent, setShowContent] = useState(false);
  const handleComplete = useCallback(() => setShowContent(true), []);

  return (
    <>
      {!showContent && <IntroAnimation onComplete={handleComplete} />}
      <div
        className={`transition-opacity duration-700 ${
          showContent ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-16 px-6 py-20">
          {/* Bio */}
          <section>
            <h1 className="mb-4 text-3xl font-bold tracking-tight">Pratham</h1>
            <p className="leading-7 text-zinc-400">
              Building AI agent infrastructure. I write about what I build, what I
              learn, and the patterns I find along the way.
            </p>
          </section>

          {/* Recent posts */}
          {posts.length > 0 && (
            <section>
              <div className="mb-6 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Recent</h2>
                <Link href="/blog" className="text-sm text-zinc-500 hover:text-zinc-300">
                  All posts
                </Link>
              </div>
              <ul className="flex flex-col gap-6">
                {posts.map((post) => (
                  <li key={post.slug}>
                    <Link href={`/blog/${post.slug}`} className="group block">
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-medium group-hover:text-zinc-300">{post.title}</h3>
                        <span className="shrink-0 text-xs text-zinc-600">{post.published}</span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-500">{post.oneLiner}</p>
                      <span className="mt-1 inline-block text-xs text-zinc-600">{post.tag}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* News */}
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">News</h2>
              <Link href="/news" className="text-sm text-zinc-500 hover:text-zinc-300">
                All digests
              </Link>
            </div>
            <p className="text-sm text-zinc-500">
              Daily digest of AI, markets, and what matters. Delivered by email.
            </p>
          </section>

          {/* Subscribe */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Subscribe</h2>
            <p className="mb-4 text-sm text-zinc-500">
              Get the daily digest and new posts in your inbox.
            </p>
            <Subscribe />
          </section>

          {/* Footer */}
          <footer className="border-t border-zinc-800 pt-6 text-xs text-zinc-600">
            <div className="flex gap-4">
              <Link href="/blog">Blog</Link>
              <Link href="/news">News</Link>
              <a href="https://github.com/prathcoding" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
