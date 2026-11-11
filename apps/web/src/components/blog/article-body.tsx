/**
 * Renders an article's block tree as React elements. No HTML is ever passed
 * through: the body is model-written, so every node is built from parsed text.
 * Links are limited to http(s), mailto and same-site paths by `safeHref`;
 * they stay followed because the articles are our own, approved editorial.
 */

import { Fragment } from 'react';

import { parseInline, type Block, type Inline } from '@/lib/blog/content';

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-moss">
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case 'code':
            return (
              <code key={i} dir="ltr" className="rounded bg-chalk-raised px-1.5 py-0.5 font-plexmono text-[0.9em]">
                {node.text}
              </code>
            );
          case 'link': {
            const external = /^https?:/i.test(node.href);
            return (
              <a
                key={i}
                href={node.href}
                {...(external ? { rel: 'noopener', target: '_blank' } : {})}
                className="font-medium text-moss underline decoration-saffron decoration-2 underline-offset-4 hover:decoration-moss"
              >
                <InlineNodes nodes={node.children} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

const Text = ({ text }: { text: string }) => <InlineNodes nodes={parseInline(text)} />;

export function ArticleBody({ blocks, locale }: { blocks: Block[]; locale: string }) {
  // `decimal` prints Latin digits even on an RTL page; Persian lists count in Persian.
  const ordered = locale === 'fa' ? '[list-style-type:persian]' : 'list-decimal';

  return (
    <div className="text-[18px] leading-[1.8] text-moss-muted">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            if (block.level === 2) {
              return (
                <h2 key={i} className="mt-14 font-display text-[clamp(1.6rem,2.6vw,2rem)] font-bold leading-snug tracking-[-0.015em] text-moss">
                  <Text text={block.text} />
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3 key={i} className="mt-10 font-display text-[22px] font-bold leading-snug text-moss">
                  <Text text={block.text} />
                </h3>
              );
            }
            return (
              <h4 key={i} className="mt-8 text-[18px] font-semibold text-moss">
                <Text text={block.text} />
              </h4>
            );
          }
          case 'paragraph':
            return (
              <p key={i} className="mt-6">
                <Text text={block.text} />
              </p>
            );
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={i} className={`mt-6 space-y-2 ps-6 ${block.ordered ? ordered : 'list-disc'} marker:text-saffron-ink`}>
                {block.items.map((item, j) => (
                  <li key={j} className="ps-1">
                    <Text text={item} />
                  </li>
                ))}
              </ListTag>
            );
          }
          case 'quote':
            return (
              <blockquote key={i} className="mt-8 border-s-4 border-saffron ps-6 text-[20px] italic text-moss">
                <Text text={block.text} />
              </blockquote>
            );
          case 'code':
            return (
              <pre key={i} dir="ltr" className="mt-8 overflow-x-auto rounded-xl border border-rule bg-chalk-raised p-5 font-plexmono text-[14px] leading-relaxed text-moss">
                <code>{block.text}</code>
              </pre>
            );
          case 'rule':
            return <hr key={i} className="my-12 border-rule" />;
        }
      })}
    </div>
  );
}
