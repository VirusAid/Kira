/**
 * prepare-standalone — готовит ресурсы для полностью автономного установщика Kira:
 *  • копирует локальное Python-окружение с torch (pyenv) в resources/pyenv
 *  • скачивает Windows-embeddable Python в resources/python (чтобы .exe работал
 *    на ПК без установленного Python)
 *  • скачивает модель голоса Silero в resources/model
 *
 * После этого `electron-vite build && electron-builder --win` соберёт установщик,
 * в котором локальный голос работает из коробки. Размер установщика ~1 ГБ.
 *
 * Запуск: npm run prepare:standalone   (или npm run dist:standalone)
 */
import { existsSync, mkdirSync, cpSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { execSync } from 'child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const res = join(root, 'resources')

// ВАЖНО: версия embeddable Python должна совпадать с ABI пакетов в pyenv.
// pyenv собран колёсами cp314 (torch/numpy/onnxruntime под 3.14) — значит и
// встраиваемый Python обязан быть 3.14.x, иначе нативные модули не загрузятся.
const PY_EMBED_URL = 'https://www.python.org/ftp/python/3.14.6/python-3.14.6-embed-amd64.zip'
const MODEL_URL = 'https://huggingface.co/Derur/silero-models/resolve/main/tts/ru/ru_v4/v4_ru.pt'

async function download(url, dest) {
  console.log(`↓ ${url}`)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} для ${url}`)
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest))
}

async function main() {
  mkdirSync(res, { recursive: true })

  // 1. pyenv (torch) — копируем локально установленное окружение
  const pyenvSrc = join(root, 'pyenv')
  const pyenvDst = join(res, 'pyenv')
  if (existsSync(pyenvSrc)) {
    if (!existsSync(pyenvDst)) {
      console.log('• Копирую pyenv (torch)… это займёт минуту')
      cpSync(pyenvSrc, pyenvDst, { recursive: true })
    } else console.log('• pyenv уже на месте')
  } else {
    console.warn('⚠ pyenv не найден. Сначала установи локальный голос (кнопка в Настройках → Голос) или через pip.')
  }

  // 2. модель Silero
  const modelDir = join(res, 'model')
  mkdirSync(modelDir, { recursive: true })
  const modelDst = join(modelDir, 'v4_ru.pt')
  if (!existsSync(modelDst)) {
    console.log('• Скачиваю модель Silero (~40 МБ)…')
    await download(MODEL_URL, modelDst)
  } else console.log('• Модель уже на месте')

  // 3. embeddable Python
  const pyDir = join(res, 'python')
  if (!existsSync(join(pyDir, 'python.exe'))) {
    mkdirSync(pyDir, { recursive: true })
    const zip = join(res, 'python-embed.zip')
    console.log('• Скачиваю embeddable Python…')
    await download(PY_EMBED_URL, zip)
    console.log('• Распаковываю Python…')
    execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${pyDir}'"`, { stdio: 'inherit' })
    // embeddable Python при наличии ._pth-файла ИГНОРИРУЕТ переменную PYTHONPATH,
    // поэтому прописываем путь к pyenv (../pyenv относительно python.exe) прямо в
    // ._pth и включаем site — иначе `import torch` из pyenv не найдётся.
    const { readdirSync, readFileSync, writeFileSync } = await import('fs')
    const pthName = readdirSync(pyDir).find((f) => f.endsWith('._pth'))
    if (pthName) {
      const pth = join(pyDir, pthName)
      let c = readFileSync(pth, 'utf-8')
      if (!c.includes('..\\pyenv')) c += '\r\n..\\pyenv\r\n'
      if (!c.includes('import site')) c += 'import site\r\n'
      writeFileSync(pth, c)
      console.log(`• ${pthName}: добавлен путь ..\\pyenv + import site`)
    } else {
      console.warn('⚠ ._pth не найден в embeddable Python — проверь распаковку')
    }
  } else console.log('• Python уже на месте')

  console.log('\n✅ Готово. Теперь: npm run dist  (или уже запущено через dist:standalone)')
  console.log('   Установщик появится в папке release/ (~1 ГБ, локальный голос из коробки).')
}

main().catch((e) => { console.error('Ошибка подготовки:', e.message); process.exit(1) })
