# Дополнение к аудиту: независимый SSL Labs и реальный iPhone (13.11.2026)

## Наблюдения пользователя (не CI)
- На физическом iPhone Safari показывает пустой экран на `https://vputipoputka.ru/api/health` через мобильную сеть и Wi-Fi, в обычной и приватной вкладке, включая повторную загрузку. HTTP-статус неизвестен; пустой экран сам по себе не подтверждает TLS failure.
- Google DNS over HTTPS ответил `Status: 0 (NOERROR)`, `A 130.49.129.99`, TTL 3600. Это проверяет резолвер Google, но не локальный DNS-путь телефона.
- SSL Labs показал для `vputipoputka.ru (130.49.129.99)` результат `Assessment failed: No secure protocols supported` (assessed Fri, 13 Nov 2026 09:46:13 UTC). Это **ошибка внешнего TLS-сканирования**, а не доказательство отсутствия TLS 1.2/1.3 на сервере. SSL Labs предупреждает о возможных ошибках сканера.
- Ранее GitHub Actions зафиксировал как серии TLS timeout, так и серии успешных HTTPS 200 без изменений на VPS: [failure](https://github.com/rsad79922-sys/po-puti/actions/runs/43289119116), [success](https://github.com/rsad79922-sys/po-puti/actions/runs/43290587671), [soak](https://github.com/rsad79922-sys/po-puti/actions/runs/43290587917).

## Приоритет: воспроизвести первопричину без изменений production
1. Из нескольких независимых сетей одновременно замерить DNS, TCP connect, TLS1.2 и TLS1.3 handshake, GET `/api/health`, точное время UTC, latency и ошибки. Разделять ошибки транспортного уровня от HTTP/JS.
2. При повторном тайм-ауте выполнить **только чтение** на VPS: `ss -tin`, краткий `tcpdump` для порта 443 (без публикации пакетов с персональными данными), `nginx -T` с редактированием секретов, `journalctl`; сопоставить timestamp и TCP seq/ack с внешней пробой.
3. Проверить MTU/PMTUD, MSS в SYN/SYN-ACK, потери сегментов ClientHello и ServerHello, retransmissions, IPv4 маршруты, CDN/proxy/hosting network и TLS-конфигурацию. Не предполагать MTU как установленную причину.
4. Не запускать `deploy/temporary-https-mss-test.sh` и не менять firewall без отдельного разрешения, плана отката и резервной копии.
5. После подтверждения и исправления причины: 24-часовой внешний soak с несколькими сетями; реальные iPhone Safari и Android APK (Wi-Fi/LTE, возврат из фона, фотографии, вход, публикация, бронь, чат); SQLite backup+restore на отдельной копии; review и merge PR только после согласования.

## Условия выпуска
- На публичном HTTPS нет повторяющихся TLS timeout в длительном мониторинге; документированы используемые сети и пороги.
- PR #4 проходит CI на итоговом SHA; production SHA установлен только после backup, с rollback.
- Физические iPhone и Android проходят end-to-end тесты. Зелёные WebKit CI и Android debug build не заменяют эту проверку.
- Не обещать доступность «на любом операторе» без наблюдений: внешние сети и пользовательские устройства вне контроля приложения.

**Изменений Ubuntu, SQLite, Nginx и firewall этим документом не производится.**
