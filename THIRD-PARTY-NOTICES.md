# Стороннее программное обеспечение в составе Kira

Kira включает открытый код и обученные модели других авторов. Ниже перечислено
то, что входит в поставку, с указанием версий и лицензий. Полные тексты
лицензий доступны по ссылкам на страницы проектов.

Сам код Kira распространяется на условиях [собственной лицензии](LICENSE) и
открытым не является. Перечисленное ниже к нему не относится.

Файл собирается автоматически: `node scripts/licenses.mjs`.
Дата сборки: 2026-08-08.

---

## Платформа

| Компонент | Версия | Лицензия |
|---|---|---|
| Electron | 33.4.11 | MIT |
| Chromium (в составе Electron) | — | BSD-3-Clause |
| Node.js (в составе Electron) | — | MIT |

Electron: https://github.com/electron/electron
Chromium: https://chromium.googlesource.com/chromium/src/+/main/LICENSE

---

## Библиотеки JavaScript (в приложении)

| Компонент | Версия | Лицензия |
|---|---|---|
| @anthropic-ai/sdk | 0.112.3 | MIT |
| @cryptography/aes | 0.1.1 | GPL-3.0-or-later |
| @napi-rs/canvas | 0.1.80 | MIT |
| @xmldom/xmldom | 0.9.10 | MIT |
| @xmldom/xmldom | 0.8.13 | MIT |
| adler-32 | 1.3.1 | Apache-2.0 |
| anymatch | 3.1.3 | ISC |
| argparse | 2.0.1 | Python-2.0 |
| argparse | 1.0.10 | MIT |
| async-mutex | 0.3.2 | MIT |
| base64-js | 1.5.1 | MIT |
| big-integer | 1.6.52 | Unlicense |
| bluebird | 3.7.2 | MIT |
| bluebird | 3.4.7 | MIT |
| braces | 3.0.3 | MIT |
| buffer | 5.7.1 | MIT |
| buffer | 6.0.3 | MIT |
| builder-util-runtime | 9.2.10 | MIT |
| builder-util-runtime | 9.7.0 | MIT |
| cfb | 1.2.2 | Apache-2.0 |
| chokidar | 3.6.0 | MIT |
| codepage | 1.15.0 | Apache-2.0 |
| crc-32 | 1.2.2 | Apache-2.0 |
| dingbat-to-unicode | 1.0.1 | BSD-2-Clause |
| electron-updater | 6.8.9 | MIT |
| fs-extra | 9.1.0 | MIT |
| fs-extra | 10.1.0 | MIT |
| fs-extra | 11.3.6 | MIT |
| fs-extra | 8.1.0 | MIT |
| glob-parent | 5.1.2 | ISC |
| htmlparser2 | 6.1.0 | MIT |
| is-binary-path | 2.1.0 | MIT |
| is-glob | 4.0.3 | MIT |
| js-yaml | 4.3.0 | MIT |
| json-schema-to-ts | 3.1.1 | MIT |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) |
| lazy-val | 1.0.5 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| lop | 0.4.2 | BSD-2-Clause |
| mammoth | 1.12.0 | BSD-2-Clause |
| marked | 12.0.2 | MIT |
| mime | 2.6.0 | MIT |
| mime | 3.0.0 | MIT |
| node-cron | 3.0.3 | ISC |
| node-localstorage | 2.2.1 | MIT |
| normalize-path | 3.0.0 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| pako | 2.2.0 | (MIT AND Zlib) |
| path-browserify | 1.0.1 | MIT |
| path-is-absolute | 1.0.1 | MIT |
| pdf-parse | 2.4.5 | Apache-2.0 |
| pdfjs-dist | 5.4.296 | Apache-2.0 |
| readdirp | 3.6.0 | MIT |
| real-cancellable-promise | 1.2.3 | MIT |
| semver | 7.8.5 | ISC |
| semver | 7.7.4 | ISC |
| semver | 6.3.1 | ISC |
| socks | 2.8.9 | MIT |
| ssf | 0.11.2 | Apache-2.0 |
| standardwebhooks | 1.0.0 | MIT |
| store2 | 2.14.4 | MIT |
| telegram | 2.26.22 | MIT |
| tiny-typed-emitter | 2.1.0 | MIT |
| ts-custom-error | 3.3.1 | MIT |
| underscore | 1.13.8 | MIT |
| uuid | 8.3.2 | MIT |
| websocket | 1.0.35 | Apache-2.0 |
| wmf | 1.0.2 | Apache-2.0 |
| word | 0.3.0 | Apache-2.0 |
| ws | 8.21.0 | MIT |
| xlsx | 0.18.5 | Apache-2.0 |
| xmlbuilder | 10.1.1 | MIT |
| xmlbuilder | 15.1.1 | MIT |

---

## Библиотеки JavaScript (встроенные расширения)

Поставляются в `resources/mcp` и запускаются как отдельные программы.

| Компонент | Версия | Лицензия |
|---|---|---|
| @hono/node-server | 2.1.0 | MIT |
| @isaacs/cliui | 8.0.2 | ISC |
| @modelcontextprotocol/sdk | 1.30.0 | MIT |
| @modelcontextprotocol/server-filesystem | 2026.7.10 | MIT |
| @modelcontextprotocol/server-memory | 2026.7.4 | MIT |
| @pkgjs/parseargs | 0.11.0 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| ansi-regex | 6.2.2 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 6.2.3 | MIT |
| ansi-styles | 4.3.0 | MIT |
| balanced-match | 4.0.4 | MIT |
| balanced-match | 1.0.2 | MIT |
| body-parser | 2.3.0 | MIT |
| brace-expansion | 5.0.9 | MIT |
| brace-expansion | 2.1.4 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| content-disposition | 1.1.0 | MIT |
| content-type | 2.0.0 | MIT |
| content-type | 1.0.5 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| depd | 2.0.0 | MIT |
| diff | 8.0.4 | BSD-3-Clause |
| dunder-proto | 1.0.1 | MIT |
| eastasianwidth | 0.2.0 | MIT |
| ee-first | 1.1.1 | MIT |
| emoji-regex | 9.2.2 | MIT |
| emoji-regex | 8.0.0 | MIT |
| encodeurl | 2.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.0 | MIT |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.6.2 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.5 | BSD-3-Clause |
| finalhandler | 2.1.1 | MIT |
| foreground-child | 3.3.1 | ISC |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| glob | 10.5.0 | ISC |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.4 | MIT |
| hono | 4.13.1 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| inherits | 2.0.4 | ISC |
| ip-address | 10.4.0 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jackspeak | 3.4.3 | BlueOak-1.0.0 |
| jose | 6.2.8 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| lru-cache | 10.4.3 | ISC |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.1 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| minimatch | 9.0.9 | ISC |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| ms | 2.1.3 | MIT |
| negotiator | 1.0.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| on-finished | 2.4.1 | MIT |
| once | 1.4.0 | ISC |
| package-json-from-dist | 1.0.1 | BlueOak-1.0.0 |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| path-scurry | 1.11.1 | BlueOak-1.0.0 |
| path-to-regexp | 8.4.2 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| proxy-addr | 2.0.7 | MIT |
| qs | 6.15.3 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| require-from-string | 2.0.2 | MIT |
| router | 2.2.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| signal-exit | 4.1.0 | ISC |
| statuses | 2.0.2 | MIT |
| string-width | 5.1.2 | MIT |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| strip-ansi | 7.2.0 | MIT |
| toidentifier | 1.0.1 | MIT |
| type-is | 2.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| vary | 1.1.2 | MIT |
| which | 2.0.2 | ISC |
| wrap-ansi | 8.1.0 | MIT |
| wrap-ansi | 7.0.0 | MIT |
| wrappy | 1.0.2 | ISC |
| zod | 4.4.3 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |

---

## Пакеты Python (голос, распознавание речи, смысловой поиск)

Поставляются в `resources/pyenv`.

| Компонент | Версия | Лицензия |
|---|---|---|
| anyio | 4.14.1 | MIT |
| audioop-lts | 0.2.2 | PSF-2.0 |
| audioread | 3.1.0 | MIT |
| certifi | 2026.6.17 | MPL-2.0 |
| cffi | 2.1.0 | MIT-0 |
| charset-normalizer | 3.4.9 | MIT |
| click | 8.4.2 | BSD-3-Clause |
| colorama | 0.4.6 | BSD |
| decorator | 5.3.1 | BSD-2-Clause |
| fastembed | 0.8.0 | Apache License |
| filelock | 3.29.7 | MIT |
| flatbuffers | 25.12.19 | Apache 2.0 |
| fsspec | 2026.6.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| hf-xet | 1.5.1 | Apache-2.0 |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| huggingface_hub | 1.23.0 | Apache-2.0 |
| idna | 3.18 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD |
| joblib | 1.5.3 | BSD-3-Clause |
| lazy-loader | 0.5 | BSD-3-Clause |
| librosa | 0.11.0 | ISC |
| llvmlite | 0.48.0 | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception |
| loguru | 0.7.3 | MIT |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| mmh3 | 5.2.1 | MIT |
| mpmath | 1.3.0 | BSD |
| msgpack | 1.2.1 | Apache-2.0 |
| narwhals | 2.23.0 | MIT |
| networkx | 3.6.1 | BSD-3-Clause |
| numba | 0.66.0 | BSD |
| numpy | 2.5.1 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| onnxruntime | 1.27.0 | MIT |
| packaging | 26.2 | Apache-2.0 OR BSD-2-Clause |
| pillow | 12.3.0 | MIT-CMU |
| platformdirs | 4.10.0 | MIT |
| pooch | 1.9.0 | BSD-3-Clause |
| protobuf | 7.35.1 | 3-Clause BSD License |
| py_rust_stemmers | 0.1.8 | MIT |
| pycparser | 3.0 | BSD-3-Clause |
| PyYAML | 6.0.3 | MIT |
| requests | 2.34.2 | Apache-2.0 |
| Resemblyzer | 0.1.4 | Apache-2.0 |
| scikit-learn | 1.9.0 | BSD-3-Clause |
| scipy | 1.18.0 | BSD |
| setuptools | 83.0.0 | MIT |
| soundfile | 0.14.0 | BSD 3-Clause License |
| soxr | 1.1.0 | LGPL-2.1-or-later |
| srt | 3.5.3 | MIT |
| standard-aifc | 3.13.0 | PSF-2.0 |
| standard-chunk | 3.13.0 | PSF-2.0 |
| standard-sunau | 3.13.0 | PSF-2.0 |
| sympy | 1.14.0 | BSD |
| threadpoolctl | 3.6.0 | BSD-3-Clause |
| tokenizers | 0.23.1 | Apache-2.0 |
| torch | 2.13.0+cpu | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT |
| tqdm | 4.68.4 | MPL-2.0 AND MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.7.0 | MIT |
| vosk | 0.3.45 | Apache-2.0 |
| websockets | 16.1 | BSD-3-Clause |
| win32_setctime | 1.2.0 | MIT license |

---

## Модели

| Модель | Назначение | Лицензия |
|---|---|---|
| vosk-model-small-ru-0.22 | распознавание речи офлайн | Apache-2.0 |
| Silero TTS v4_ru | синтез речи офлайн | CC BY-NC-SA (см. примечание) |

Vosk: https://alphacephei.com/vosk/models
Silero: https://github.com/snakers4/silero-models

**Примечание о Silero.** Модели Silero, кроме `v5_cis_base`, опубликованы под
лицензией с запретом коммерческого использования. Для платного распространения
требуется либо переход на `v5_cis_base` (MIT), либо отдельное соглашение с
авторами.
