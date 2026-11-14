# Ubuntu 24.04: чистая установка и обновления

Инструкция рассчитана на один сервер, домен `vputipoputka.ru`, systemd и штатный Nginx Ubuntu 24.04. Для другого домена замените его в обоих Nginx-шаблонах, PUBLIC_ORIGIN, APP_ORIGINS, config.js Android и проверках deploy workflow/script. IP берите у вашего VPS: исторические IP из старых отчётов не являются инструкцией менять DNS.

В рамках аудита production не развёртывался. Команды ниже выполняет администратор сервера после принятия PR и прохождения Verify. Для существующей установки сначала прочитайте раздел обновления: не выполняйте шаги чистой установки поверх данных.

## 1. ОС и Node.js 24 LTS

Убедитесь, что A/AAAA домена указывают на этот сервер, открыт SSH и TCP 80/443. Не публикуйте порт 8080. Изменяйте firewall с учётом фактического SSH-порта и существующих правил.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nginx certbot sqlite3 openssl util-linux
```

Нужен Node.js **24.x**, а не штатный Node.js 18. Пример установки из подписанного APT-репозитория NodeSource (проверьте актуальные указания на https://github.com/nodesource/distributions):

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource-repo.key
# Сверьте ключ с официальным источником перед доверием ему.
gpg --show-keys --with-fingerprint /tmp/nodesource-repo.key
sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource-repo.key
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
/usr/bin/node --version
/usr/bin/node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(':memory:').close()"
```

## 2. Получить и проверить код без запуска production

Работайте в пользовательском каталоге. Для установки выбирайте проверенный commit из main после слияния PR.

```sh
git clone https://github.com/rsad79922-sys/po-puti.git
cd po-puti
npm ci --ignore-scripts
npm run verify
npx playwright install --with-deps chromium webkit
BROWSER_ENGINE=chromium npm run test:browser
BROWSER_ENGINE=webkit npm run test:browser
npm audit --audit-level=moderate
sudo bash deploy/check-config.sh
```

Остановитесь при любой ошибке. `check-config.sh` использует временный сертификат и не запускает Nginx или приложение. Затем из **этого же checkout** установите проверенную версию:

```sh
# /opt/po-puti не должен существовать при чистой установке.
sudo git clone --branch main https://github.com/rsad79922-sys/po-puti.git /opt/po-puti
sudo git -C /opt/po-puti checkout --detach "$(git rev-parse HEAD)"
# Вернуть main на ровно проверенный commit, без скачивания новой версии.
sudo git -C /opt/po-puti switch -C main
sudo adduser --system --group --home /var/lib/po-puti --no-create-home poputi
sudo install -d -m 0700 -o poputi -g poputi /var/lib/po-puti
sudo install -d -m 0700 /var/backups/po-puti
sudo install -d -m 0750 -o root -g poputi /etc/po-puti
# Создайте файл только если его ещё нет. Существующий файл не перезаписывать.
sudo test ! -e /etc/po-puti/po-puti.env && sudo install -m 0640 -o root -g poputi deploy/po-puti.env.example /etc/po-puti/po-puti.env
sudoedit /etc/po-puti/po-puti.env
```

PUBLIC_ORIGIN должен быть точным HTTPS origin без завершающего `/`; HOST=127.0.0.1, DATA_DIR=/var/lib/po-puti. Укажите приватно ADMIN_USERNAME и стойкий ADMIN_PASSWORD для первого старта. Удобно сгенерировать пароль менеджером паролей; не включайте его в команды shell, код, PR или GitHub Actions. После создания администратора удалите ADMIN_PASSWORD из env. Переменные не меняют пароль существующего аккаунта и не повышают права существующего пользователя.

## 3. systemd и журналы

```sh
sudo install -m 0644 deploy/po-puti.service deploy/po-puti-health.service deploy/po-puti-health.timer deploy/po-puti-backup.service deploy/po-puti-backup.timer /etc/systemd/system/
printf 'RELEASE_SHA=%s\n' "$(git rev-parse HEAD)" | sudo tee /var/lib/po-puti-release.env >/dev/null
sudo chmod 0600 /var/lib/po-puti-release.env
sudo systemctl daemon-reload
sudo systemctl enable --now po-puti
node deploy/healthcheck.mjs
sudo systemctl enable --now po-puti-health.timer po-puti-backup.timer
sudo systemctl status po-puti --no-pager
sudo journalctl -u po-puti -n 80 --no-pager
```

Health обращается к SQLite и возвращает `ok`, `backend`, `version`, `release` (SHA установленного кода). При SIGTERM Node закрывает HTTP-сервер и SQLite. Unit ограничивает права, разрешает запись только в каталог данных, отправляет stdout/stderr в journald и перезапускает процесс при аварии. При необходимости включите постоянное хранение journal (`Storage=persistent` в отдельном journald drop-in) и лимит SystemMaxUse по размеру вашего диска.

Локальный health timer раз в минуту пишет HEALTH_OK/HEALTH_FAILED в journal; он не перезапускает приложение при временном сбое и не является внешним монитором. Подключите оповещения к неуспешным unit и внешней HTTPS-проверке.

## 4. Выпустить сертификат, затем включить HTTPS

Сначала устанавливается **только HTTP bootstrap**: он отдаёт ACME challenge и 503 на остальные запросы, не принимает пароли по HTTP.

```sh
sudo install -d -m 0755 /var/www/letsencrypt
sudo install -m 0644 deploy/nginx-log-format.conf /etc/nginx/conf.d/po-puti-log.conf
sudo install -m 0644 deploy/nginx-po-puti.conf /etc/nginx/sites-available/po-puti
sudo ln -s /etc/nginx/sites-available/po-puti /etc/nginx/sites-enabled/po-puti
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d vputipoputka.ru
```

После успешного выпуска замените **тот же файл сайта**, не включайте оба шаблона одновременно:

```sh
sudo install -m 0644 deploy/nginx-po-puti-tls.conf /etc/nginx/sites-available/po-puti
sudo nginx -t
sudo systemctl reload nginx
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '%s\n' '#!/bin/sh' 'nginx -t && systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/po-puti-nginx >/dev/null
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/po-puti-nginx
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
node deploy/healthcheck.mjs https://vputipoputka.ru/api/health
```

Проверьте `curl -I http://vputipoputka.ru/` → 308 на HTTPS. В Nginx TLS 1.2/1.3, HSTS и ограничение login/register действуют на HTTPS; `listen ... ssl http2` поддерживается Nginx 1.24. В access log нет query, IP, Cookie, Authorization и тела запроса. Системный `/etc/logrotate.d/nginx` обычно охватывает `/var/log/nginx/*.log`; проверьте, что оба `po-puti-*.log` входят в ротацию.

## 5. Резервные копии и восстановление

```sh
sudo systemctl start po-puti-backup.service
sudo journalctl -u po-puti-backup --no-pager -n 30
sudo systemctl list-timers 'po-puti-*'
```

Ежедневный backup создаёт новый закрытый каталог `/var/backups/po-puti/backup-*`: SQLite online backup с integrity_check, затем uploads.tar.gz. База снимается первой: изображения append-only. Файлы копий не перезаписываются и не удаляются автоматически. Настройте контроль свободного места, защищённую копию **вне VPS**, шифрование и срок хранения. В копиях есть персональные данные; не загружайте их в GitHub.

Проверяйте восстановление в отдельном временном DATA_DIR: integrity_check, пользователи/поездки и соответствие фотографий. Восстановление production — отдельная ручная операция с остановленным приложением: сначала сохраните весь текущий DATA_DIR вместе с WAL/SHM/uploads и закройте все соединения SQLite; только затем восстанавливайте согласованный набор в новый каталог. Никогда не заменяйте один работающий `.sqlite` поверх существующих WAL/SHM. Это может потерять записи и повредить данные. Автоматический релиз откатывает **только код**.

## 6. GitHub Actions: проверка, затем развёртывание

`Verify` выполняется на каждом PR и push main. Его reusable workflow включает npm ci/audit, все изолированные тесты, сборку, Chromium, WebKit и проверку Nginx/systemd на Ubuntu 24.04. Сделайте эти проверки обязательными в branch protection main. PR не имеет доступа к production secrets.

Workflow `publish-manual.yml` использует тот же полный Verify для **того же SHA**, затем job release с `needs: verify`. Он допускает публикацию только main:

- вручную через Run workflow с `publish-vputipoputka.ru`;
- автоматически после push main, если repository variable **`POPUTI_AUTO_DEPLOY`** равна строке `true`. До настройки публикация выключена.

Создайте GitHub Environment `production`, при необходимости с required reviewers и allowed branch main. В его secrets задайте:

| Secret | Значение |
|---|---|
| POPUTI_DEPLOY_HOST | DNS/IP VPS |
| POPUTI_DEPLOY_USER | SSH-пользователь развёртывания |
| POPUTI_DEPLOY_SSH_KEY | отдельный приватный SSH-ключ, только в secrets |
| POPUTI_DEPLOY_KNOWN_HOSTS | проверенный host key VPS из доверенного канала |
| POPUTI_DEPLOY_PORT | необязательно, по умолчанию 22 |

Не получайте host key непроверенным `ssh-keyscan` в workflow. Учётная запись должна иметь неинтерактивный sudo для release script. Текущий механизм передаёт проверенный script через `sudo -n bash -s`, поэтому ключ фактически даёт администраторские права. Используйте отдельный ключ, production Environment с контролем доступа и выделенный deploy-аккаунт; не выдавайте его обычным разработчикам. Этот механизм не является ограниченным sudo API.

На сервере нужен чистый Git checkout main в `/opt/po-puti`, работающий unit новой версии и данные снаружи checkout. Скрипт проверяет SHA принадлежность main и fast-forward, блокирует одновременный релиз, проверяет кандидата в /tmp **до остановки сервиса**, создаёт SQLite/uploads backup, обновляет код и ждёт локальный health с точным SHA и HTTPS health. Ошибка возвращает прежний код; пользовательские данные не откатываются. Внешний runner проверяет HTTPS и SHA ещё раз. Если сбой виден только снаружи, job падает для расследования; автоматический откат по внешнему наблюдению не выполняется.

Этот PR не включает POPUTI_AUTO_DEPLOY, не меняет secrets, не запускает workflow публикации и не сливается автоматически.

## 7. Обновление уже работающего сервера

Сначала сохраните текущие env, Nginx/systemd и согласованную копию данных. Не клонируйте новый каталог поверх `/var/lib/po-puti`, не копируйте `.env.example` поверх рабочего env. Проверьте отдельный кандидат командой Verify.

Перед первым автоматическим релизом установите новый systemd unit, добавьте PUBLIC_ORIGIN в существующий env, создайте приватный release.env с текущим SHA и выполните daemon-reload. Подготовьте Nginx TLS-шаблон в отдельном файле, сохраните текущую конфигурацию и примените его только после `nginx -t`. Каталоги данных и uploads остаются прежними. После этого используйте проверенный release workflow вместо `git pull && restart`.

Проверьте на двух тестовых аккаунтах: вход, публикацию, заявку, подтверждение, чат, отмену, выход; затем на настоящем Android/iPhone. Существующие пользователи PWA автоматически перейдут с Bearer на cookie. Старые Android-клиенты продолжат использовать Bearer. Время поездок/часовые пояса, внешние TLS-инциденты и ограничения MVP описаны в отчёте аудита.

## Переустановка VPS и первое автоматическое размещение

После переустановки сначала сверяйте host fingerprint через доверенную консоль провайдера. `deploy/ssh-host-fingerprint.txt` содержит только публичный отпечаток, подтверждённый владельцем; private key остаётся в GitHub Secrets. Скрипт `prepare-ssh.sh` сравнивает ключ сервера с этим отпечатком и сохраняет StrictHostKeyChecking=yes. При несовпадении он не продолжает соединение.

Переустановка также удаляет прежние `authorized_keys`. Workflow read-only preflight может подготовить краткоживущий artifact только с публичной половиной существующего deployment-ключа. Восстановление доступа выполняет владелец через доверенную консоль; автоматическое создание SSH-пользователей или расширение sudo не выполняется.

Для чистого сервера в ручном workflow публикации предусмотрен флаг `initial_install=true`. После полного Verify он устанавливает Node 24/Nginx/Certbot, получает сертификат и запускает systemd. Существующий `/opt/po-puti` отклоняется: работающие установки обновляются обычным release workflow. База и uploads из `/var/lib/po-puti` сохраняются и резервируются; при их отсутствии создаётся новая пустая база. Этот процесс не восстанавливает данные, удалённые при переустановке: старые резервные копии нужно возвращать отдельно. Пароли администратора не создаются и не публикуются автоматически.
