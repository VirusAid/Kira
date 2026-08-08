/**
 * Проверка ключа провайдера.
 *
 * Ключ уезжает в заголовок `Authorization: Bearer …`, а заголовки HTTP держат
 * только latin-1. Пойман живьём при запуске Kira: в поле ключа оказался
 * русский текст, и fetch падал изнутри сообщением «Cannot convert argument to
 * a ByteString because the character at index 11 has a value of 1058». Человек
 * читал это вместо «ключ введён неверно».
 */
import { keyProblem } from '../src/main/modules/ai/client'

let pass = 0, fail = 0
const t = (n: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++
}

function main(): void {
  // ── настоящие ключи проходят ──────────────────────────────────────────────
  t('обычный ключ принимается', keyProblem('gsk_AbCd1234567890xyz') === null)
  t('ключ с дефисами и подчёркиваниями',
    keyProblem('sk-or-v1_abc-DEF_123') === null)

  // ── то, что поймали живьём ────────────────────────────────────────────────
  const cyr = keyProblem('gsk_ТВОЙКЛЮЧ')
  t('русские буквы отвергаются', cyr !== null, `-> ${cyr}`)
  t('и объясняются по-человечески', /русские буквы/.test(cyr ?? ''))

  // ── обычные беды копипасты ────────────────────────────────────────────────
  t('перевод строки отвергается', /перевод строки/.test(keyProblem('gsk_abc\ndef') ?? ''))
  t('пробел внутри отвергается', /пробел/.test(keyProblem('gsk_abc def') ?? ''))
  t('пробелы по краям не считаются бедой', keyProblem('gsk_abc'.trim()) === null)
  t('пустой ключ назван пустым', /не задан/.test(keyProblem('') ?? ''))

  // ── прочие непечатаемые ───────────────────────────────────────────────────
  t('кавычки-ёлочки отвергаются', keyProblem('gsk_«abc»') !== null)
  t('эмодзи отвергается', keyProblem('gsk_abc🙂') !== null)

  // ── в сообщении видно, ЧТО именно мешает ──────────────────────────────────
  t('в объяснении показан сам символ', (keyProblem('gsk_abcЖ') ?? '').includes('Ж'))

  console.log(`\n=== ИТОГО: ${pass} PASS, ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}
main()
