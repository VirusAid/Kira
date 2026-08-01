/**
 * Рендер Markdown-сообщений.
 *
 * Текст сюда приходит из ненадёжного источника. Это не паранойя: ответ модели
 * складывается в том числе из прочитанных веб-страниц, распознанного с экрана
 * текста, содержимого файлов и ответов чужих расширений. Любое из этих мест
 * может подсунуть разметку, а у окна Kira есть мост к управлению компьютером —
 * значит, выполненный здесь скрипт получает доступ ко всему.
 *
 * Поэтому чистим по СПИСКУ РАЗРЕШЁННОГО, разбирая дерево, а не вычёркивая
 * знакомые строки регулярками. Прежняя чистка была именно такой и пропускала
 * `<img src=x onerror=…>`, `<svg onload=…>`, `<style>`, `<object>` и даже
 * `<script >` с пробелом — всё, что не совпало с шаблоном дословно. Держалось
 * это лишь на политике безопасности страницы, то есть на одном слое.
 */
import { useMemo, type MouseEvent } from 'react'
import { marked } from 'marked'
import { kira } from '@/api'
import { sanitizeHtml } from '@/lib/sanitizeHtml'

marked.setOptions({ gfm: true, breaks: true })

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => sanitizeHtml(marked.parse(content, { async: false }) as string), [content])

  /**
   * Ссылка уводит в СИСТЕМНЫЙ браузер, а не открывает сайт внутри Kira.
   * Обычный переход подменил бы окно приложения чужой страницей — вместе с
   * мостом к управлению компьютером, который в этом окне живёт.
   */
  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const link = (e.target as HTMLElement).closest?.('a')
    const href = link?.getAttribute('href')
    if (!href) return
    e.preventDefault()
    void kira.app.openExternal(href)
  }

  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
