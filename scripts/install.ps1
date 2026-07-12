# Установщик Kira: ставит зависимости Node и локальные Python-подсистемы
# (голос Silero, память fastembed, узнавание голоса, эмоции, офлайн wake-word).
# Запускается через «Установить Kira.bat».

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$OutputEncoding = [System.Text.Encoding]::UTF8

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

Say '============================================================' Cyan
Say '  Установка Kira - ставит все необходимое для работы' Cyan
Say '============================================================' Cyan
Say '  Нужны заранее установленные Node.js и Python 3.'
Say '  Займет несколько минут (качается ~0.5 ГБ пакетов).'
Say '============================================================' Cyan
Say ''

# --- проверка Node.js ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say '[ОШИБКА] Node.js не найден.' Red
  Say 'Установи LTS-версию с https://nodejs.org и запусти файл снова.' Red
  return
}

# --- проверка Python ---
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Say '[ОШИБКА] Python не найден.' Red
  Say 'Установи Python 3 с https://python.org (галочка "Add python.exe to PATH").' Red
  return
}
$pyver = (& python --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $pyver -notmatch 'Python') {
  Say '[ОШИБКА] Python не запускается - вероятно, заглушка Microsoft Store.' Red
  Say 'Установи настоящий Python 3 с https://python.org и отключи в "Параметры ->' Red
  Say 'Псевдонимы выполнения приложений" пункты python.' Red
  return
}

Say ('  Node.js:  ' + (& node --version))
Say ('  Python:   ' + $pyver)
Say ''

$pyenv = Join-Path $root 'pyenv'
$pytmp = Join-Path $root 'pytmp'
New-Item -ItemType Directory -Force -Path $pyenv, $pytmp | Out-Null
# временная папка pip - на том же диске, что pyenv, иначе pip падает с WinError 17
$env:TMP = $pytmp
$env:TEMP = $pytmp
$env:PIP_NO_INPUT = '1'

# запускает pip install --target pyenv с нужными пакетами; код возврата в $LASTEXITCODE
function Pip([string[]]$pkgs, [string[]]$extra = @()) {
  $pipArgs = @('-m', 'pip', 'install', '--no-cache-dir', '--target', $pyenv) + $pkgs + $extra
  & python @pipArgs
}

Say '=== [1/6] Зависимости Node (npm install) ===' Yellow
& npm install
if ($LASTEXITCODE -ne 0) { Say '[ОШИБКА] npm install завершился с ошибкой.' Red; return }
Say ''

Say '=== [2/6] PyTorch + numpy (CPU, ~200-300 МБ) - локальный голос Silero ===' Yellow
Pip @('numpy<2.5', 'torch') @('--index-url', 'https://download.pytorch.org/whl/cpu', '--extra-index-url', 'https://pypi.org/simple')
if ($LASTEXITCODE -ne 0) { Say '[ОШИБКА] Не удалось установить torch/numpy. Голос Silero не заработает.' Red; return }
Say ''

Say '=== [3/6] Семантическая память (fastembed) ===' Yellow
Pip @('fastembed')
if ($LASTEXITCODE -ne 0) { Say '[!] fastembed не установлен - память будет работать в лексическом режиме.' DarkYellow }
Say ''

Say '=== [4/6] Узнавание голоса + эмоции (resemblyzer + librosa) ===' Yellow
Pip @('resemblyzer') @('--no-deps')
Pip @('numpy<2.5', 'librosa')
if ($LASTEXITCODE -ne 0) {
  Say '[!] librosa/resemblyzer не установлены - узнавание голоса/эмоции выключены.' DarkYellow
}
else {
  # webrtcvad (зависимость resemblyzer) не собирается на Python 3.14 - кладём заглушку
  Copy-Item (Join-Path $PSScriptRoot 'webrtcvad.py') (Join-Path $pyenv 'webrtcvad.py') -Force
  Say '  Заглушка webrtcvad установлена.'
}
Say ''

Say '=== [5/6] Офлайн-активация словом "Кира" (vosk) ===' Yellow
Pip @('vosk')
if ($LASTEXITCODE -ne 0) { Say '[!] vosk не установлен - офлайн wake-word недоступен.' DarkYellow }
Say ''

Say '=== [6/6] Проверка установленного ===' Yellow
$env:PYTHONPATH = $pyenv
function Chk([string]$import, [string]$label) {
  & python -c "import $import" 2>$null
  if ($LASTEXITCODE -eq 0) { Say ('  ' + $label + ' OK') Green }
  else { Say ('  ' + $label + ' - нет') DarkYellow }
}
Chk 'torch'                              'torch      '
Chk 'numpy'                              'numpy      '
Chk 'fastembed'                          'fastembed  '
Chk 'resemblyzer, librosa, webrtcvad'    'голос/эмоции'
Chk 'vosk'                               'vosk       '
Say ''

Say '============================================================' Cyan
Say '  Установка завершена.' Green
Say '  Модели скачаются автоматически при первом использовании'
Say '  (Silero ~40 МБ, эмбеддинги ~220 МБ, vosk ~45 МБ) - или'
Say '  вручную в приложении: раздел "Центр систем".'
Say ''
Say '  Не забудь вставить API-ключ в Настройки -> Модели ИИ'
Say '  (бесплатный Groq: https://console.groq.com/keys).'
Say ''
Say '  Запуск: "Запустить Kira.bat"  (или  npm run dev)'
Say '============================================================' Cyan
