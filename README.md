# По пути

PWA и Android-клиент для совместных поездок, общий API на Node.js 24 LTS и SQLite. Интерфейс — обычные HTML/CSS/JS, без отдельного frontend-фреймворка. Сервер не требует npm-зависимостей для запуска.

**Установка на Ubuntu 24.04, HTTPS, systemd, журналы, резервные копии и GitHub Actions:** [deploy/README.md](deploy/README.md).

**Актуальный аудит, исправления, проверки и границы готовности:** [docs/AUDIT-HARDENING-2026-11-14.md](docs/AUDIT-HARDENING-2026-11-14.md). Старые `AUDIT-*.md` — исторические отчёты.

## Разработка и проверки

Нужен Node.js 24.x с `node:sqlite` и npm. Зависимости и Playwright зафиксированы в `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run verify                  # синтаксис + все изолированные тесты + сборка
npx playwright install --with-deps chromium webkit
BROWSER_ENGINE=chromium npm run test:browser
BROWSER_ENGINE=webkit npm run test:browser
npm audit --audit-level=moderate
```

Для имеющегося системного Chromium можно задать `CHROMIUM_PATH=/usr/bin/chromium`. Сборка `npm run build` проверяет пути, manifest и размеры PNG-иконок, затем создаёт runtime-пакет `dist/` с SHA-256 суммами. В него не попадают база, uploads, `.env`, `.git` и node_modules. Запуск — `node server/server.mjs`; весь frontend обслуживает тот же процесс.

```sh
HOST=127.0.0.1 PORT=8080 DATA_DIR=/tmp/po-puti-local npm run server
```

Откройте http://127.0.0.1:8080. Для разработки используйте отдельный DATA_DIR. Тесты `npm test` и браузерные тесты сами создают и удаляют **только свои временные базы**; production не затрагивается. Исторический `tests/smoke-api.mjs` пишет в указанный API; вместо него используйте `tests/smoke-isolated.mjs` через `npm test`.

## Сессии и PWA

Веб-версия использует HttpOnly/SameSite=Strict cookie, в HTTPS-конфигурации — Secure. В localStorage хранится только несекретный маркер смены сессии. При первом открытии новая версия обменивает прежний Bearer-токен на cookie и отзывает его; аккаунты, поездки и корректные черновики сохраняются. Отказ сети при обмене не переводит приложение в деморежим.

API Android продолжает принимать Bearer; его origin `https://localhost` разрешён отдельно. Android использует общий `https://vputipoputka.ru` из config.js. Для другой площадки измените config.js перед сборкой и настройте APP_ORIGINS. Изменения клиента требуют новой сборки APK.

Service Worker использует Network First только для оболочки. API, uploads и динамический config.js не кэшируются. Офлайн можно открыть оболочку, но поиск, публикация, чат и актуализация данных требуют сети. Кэш — не резервная копия пользовательских данных.

Для локальной статической демонстрации: `npm run serve` → http://localhost:8080. Данные остаются в браузере. Демоаккаунты и тестовые пароли этой демонстрации никогда не создаются на backend. На статическом HTTPS-хостинге деморежим включается явно `?demo=1`.

## Android

```sh
npm ci --ignore-scripts
npm run android:add
npm run android:sync
npm run android:open
```

Для сборки нужны JDK 21 и Android SDK. Workflow Android собирает debug APK; это не подписанный production-релиз. Архив `releases/po-puti-android-pwa-v02.zip` исторический и не содержит текущих исправлений.

## Ограничения

Это усиленный MVP. Android Bearer пока хранится в WebView localStorage; перед публичным запуском нужен переход на Android Keystore. Время поездки пока не хранит часовой пояс, `/state` не имеет пагинации, нет проверки телефона, системных push и автоматической модерации. SQLite рассчитан на один процесс и локальный диск. Нужны проверка нагрузки, политика обработки персональных данных и наблюдение на реальных устройствах. Ранее описанные внешние TLS-сбои этим изменением не объявляются устранёнными.
