/** Рендер Markdown-контента сообщений (marked + санитизация). */
import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

/** Убираем потенциально опасные конструкции из готового HTML. */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => sanitize(marked.parse(content, { async: false }) as string), [content])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
