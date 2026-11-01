import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mt-8 mb-4 text-2xl font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mt-6 mb-3 text-xl font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
        p: ({ children }) => <p className="mb-4 leading-7">{children}</p>,
        ul: ({ children }) => <ul className="mb-4 ml-6 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="mb-4 ml-6 list-decimal">{children}</ol>,
        li: ({ children }) => <li className="mb-1 leading-7">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} className="underline hover:text-zinc-300" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="my-4 overflow-x-auto rounded bg-white/5 p-4 text-sm">
                <code>{children}</code>
              </pre>
            );
          }
          return <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm">{children}</code>;
        },
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-2 border-zinc-500 pl-4 italic">{children}</blockquote>
        ),
        hr: () => <hr className="my-6 border-zinc-700" />,
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        img: ({ src, alt }) => (
          <figure className="my-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt || ""} className="rounded" />
          </figure>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
