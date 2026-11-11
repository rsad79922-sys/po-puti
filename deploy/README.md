# Развёртывание «По пути» на Ubuntu 24.04

Целевой адрес PWA: **https://vputipoputka.ru**. Android должен обращаться к тому же HTTPS API.
Текущий backend — MVP для **ограниченного тестирования**, а не готовый публичный сервис: до запуска с реальными пользователями необходим аудит безопасности и хранения сессий (токен сейчас в localStorage), антиспам/модерация, резервное копирование, восстановление и проверки под нагрузкой.

## 1. DNS и SSH

1. В DNS-панели домена создайте или обновите запись **A**: имя **@** (или пустое поле, по правилам панели), значение **130.49.129.99**, TTL **300 секунд** или «Авто». В результате **vputipoputka.ru → 130.49.129.99**. При наличии конфликтующих A-записей для корня домена проверьте их и уберите только устаревшие. Запись AAAA не создавайте, пока на VPS нет корректно настроенного IPv6. Записи MX/TXT/NS не меняйте без отдельной причины.
2. По желанию настройте **www** как CNAME на **vputipoputka.ru**. Текущий Nginx и сертификат в этом проекте рассчитаны только на домен без www; перед использованием www отдельно добавьте его в конфигурацию и сертификат.
3. Проверьте, что есть SSH-доступ с правами sudo и открыты TCP 80/443 в панели VPS. Не отправляйте логин-пароль или SSH-ключи в чат.
4. Проверьте DNS на локальном компьютере: `nslookup vputipoputka.ru`. Сертификат заказывают только после правильного DNS.

## 2. Программы на Ubuntu

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx sqlite3
```

Серверу необходим **Node.js 22.16+ или Node.js 24 LTS** с поддержкой `node:sqlite`, а не штатный Node.js 18 из Ubuntu 24.04. Используйте официальные инструкции Node.js/NodeSource для установки подходящей версии и проверьте:

```bash
node -v
which node
node -e "const {DatabaseSync}=require('node:sqlite'); new DatabaseSync(':memory:').close(); console.log('SQLite OK')"
```

В unit-файле задан `/usr/bin/node`. Если `which node` показывает другой путь, исправьте `ExecStart` **до** запуска сервиса.

## 3. Код, служебный пользователь и переменные окружения

```bash
sudo git clone https://github.com/rsad79922-sys/po-puti.git /opt/po-puti
sudo adduser --system --group --home /var/lib/po-puti --no-create-home poputi
sudo install -d -m 0700 -o poputi -g poputi /var/lib/po-puti
sudo install -d -m 0750 -o root -g poputi /etc/po-puti
sudo install -m 0640 -o root -g poputi /opt/po-puti/deploy/po-puti.env.example /etc/po-puti/po-puti.env
sudo nano /etc/po-puti/po-puti.env
```

В **/etc/po-puti/po-puti.env** укажите `ADMIN_USERNAME` (3–32 латинских символа, цифры, `_` или `-`) и сильный случайный `ADMIN_PASSWORD` (минимум 8 символов). Для генерации на сервере: `openssl rand -hex 32`. Не сохраняйте реальные значения в GitHub и не присылайте их в чат. Создание администратора выполняется при первом запуске, если такого логина ещё нет; переменная окружения **не** переустанавливает пароль существующего пользователя.

## 4. Запуск backend через systemd

```bash
sudo install -m 0644 /opt/po-puti/deploy/po-puti.service /etc/systemd/system/po-puti.service
sudo systemctl daemon-reload
sudo systemctl enable --now po-puti
sudo systemctl --no-pager status po-puti
curl -fsS http://127.0.0.1:8080/api/health
```

Ожидаемый ответ health: `{"ok":true,"backend":"sqlite","version":"0.2"}`. Если ошибка: `sudo journalctl -u po-puti -n 80 --no-pager`. Внешний доступ к порту 8080 **не открывать**.

## 5. Nginx, firewall и HTTPS

```bash
sudo install -m 0644 /opt/po-puti/deploy/nginx-po-puti.conf /etc/nginx/sites-available/po-puti
sudo ln -s /etc/nginx/sites-available/po-puti /etc/nginx/sites-enabled/po-puti
sudo nginx -t
sudo systemctl reload nginx
```

Если `ufw` включён, разрешите SSH (с учётом вашего фактического SSH-порта) и HTTP/HTTPS. **Не включайте UFW вслепую**, чтобы не потерять SSH-доступ.

```bash
sudo ufw allow 'Nginx Full'
sudo certbot --nginx -d vputipoputka.ru --redirect
curl -fsS https://vputipoputka.ru/api/health
```

Certbot добавит настройки HTTPS в Nginx после проверки домена. Проверьте автообновление: `sudo certbot renew --dry-run`. Если домен ещё не направлен на сервер, HTTPS пока не заработает.

## 6. Проверка реальных сценариев

Откройте `https://vputipoputka.ru` в мобильном браузере, создайте **два отдельных тестовых аккаунта**. В одном опубликуйте поездку, из второго отправьте заявку, из первого подтвердите и проверьте двусторонний чат. Убедитесь, что при обновлении PWA сессия сохранилась.

**Важно:** `node tests/smoke-api.mjs` создаёт временные аккаунты и тестовую поездку **в той базе, против которой запущен тест**. Для публичной базы не запускайте его без согласования тестовых данных. Вместо этого используйте отдельную временную копию БД.

Для Android нельзя использовать локальный демонстрационный режим: перед сборкой задайте в `www/config.js`:
```js
window.PO_PUTI_BACKEND = true;
window.PO_PUTI_API_BASE = 'https://vputipoputka.ru';
```
В основной PWA менять файл не требуется: backend автоматически включает API при выдаче `/config.js`.

## 7. Обновления и резервное копирование

```bash
cd /opt/po-puti
sudo git pull --ff-only
sudo systemctl restart po-puti
curl -fsS http://127.0.0.1:8080/api/health
```

Перед обновлением сохраните БД. Для SQLite в WAL-режиме нельзя полагаться только на обычный `cp` работающего файла. Используйте команду `sqlite3 .backup` и храните защищённые копии **вне VPS**. Например (после создания каталога):

```bash
sudo install -d -m 0700 -o poputi -g poputi /var/backups/po-puti
sudo -u poputi sqlite3 /var/lib/po-puti/po-puti.sqlite ".backup '/var/backups/po-puti/po-puti-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
```

Проверяйте восстановление из копии отдельно. До публичного запуска настройте регулярные резервные копии и мониторинг отказов, ограничение доступа к SSH, обновления ОС, а также полноценное управление секретами.

## Готовность к публикации

Этот комплект автоматизирует инфраструктуру MVP, но **не подтверждает готовность к публичному запуску**. Перед использованием с реальными людьми нужны безопасное хранение сессий, защита от XSS/CSRF, аудит персональных данных, жалобы и модерация, политика конфиденциальности, проверка картографической интеграции, системные уведомления, мониторинг и план восстановления.
