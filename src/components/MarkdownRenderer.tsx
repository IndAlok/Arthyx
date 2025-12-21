"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-invert prose-sm max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-white mt-4 mb-2 border-b border-slate-700 pb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-white mt-3 mb-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-emerald-400 mt-2 mb-1">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-slate-300 mb-2 leading-relaxed">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="text-white font-semibold">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="text-emerald-300 italic">{children}</em>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 text-slate-300 my-2 ml-2">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 text-slate-300 my-2 ml-2">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-slate-300">{children}</li>
          ),
          code: ({ className: codeClassName, children }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-slate-700 text-emerald-400 text-sm font-mono">
                  {children}
                </code>
              );
            }
            return (
              <code className="block p-3 rounded-lg bg-slate-800 text-slate-300 text-sm font-mono overflow-x-auto my-2">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="w-full border-collapse border border-slate-700 rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-800">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-sm font-semibold text-white border border-slate-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm text-slate-300 border border-slate-700">
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-emerald-500 pl-4 my-2 italic text-slate-400">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a 
              href={href} 
              className="text-emerald-400 hover:text-emerald-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          hr: () => (
            <hr className="border-slate-700 my-4" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
