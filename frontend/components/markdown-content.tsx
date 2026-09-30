import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

export function MarkdownContent({
  content,
  className = "",
}: MarkdownContentProps) {
  return (
    <div className={`markdown-preview ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
          img: ({ node: _node, src, alt }) => {
            const href = typeof src === "string" ? src : undefined;
            return href ? (
              <a href={href} target="_blank" rel="noreferrer">
                [Image: {alt || "open source"}]
              </a>
            ) : (
              <span>[Image]</span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
