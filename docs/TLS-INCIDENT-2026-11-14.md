# vputipoputka.ru: intermittent TLS handshake timeout

## Current outcome

The application fixes were installed manually by the owner and verified publicly as boot14. Later read-only SSH diagnostics succeeded using the existing GitHub production connection. No nginx, firewall, MTU, sysctl, application, or database settings were changed by these diagnostic runs. The external port 443 failure remains unresolved. After explicit owner approval, a persistent alternate HTTPS entry at https://vputipoputka.ru:8443/ was installed and verified. This mitigates access through an additional port; it does not repair or explain the upstream 443 failure.

## Reproduced failure

On 14 November 2026, 09:41:33–09:42:48 UTC:

- 12/12 TLS probes failed after successful TCP connect (approximately 0.18–0.19 seconds); TLS handshakes timed out after approximately 5 seconds.
- Both TLS 1.2 and TLS 1.3 failed, through DNS and through pinned IPv4 with the correct SNI.
- 14/15 checks of HTML, JavaScript, CSS, Service Worker, and health failed at TLS. The final health check returned HTTP 200 at 09:42:48 UTC.
- The two external jobs ran from AWS us-west-2 and Azure centralus.
- The owner previously observed a blank /api/health page on iPhone. nginx recorded repeated `client timed out ... while SSL handshaking` for that client's connections. The marked HTTP request was absent from the standard access log, while a loopback control request was logged with HTTP 200.

Independent reproduction: https://github.com/rsad79922-sys/po-puti/actions/runs/43479571529 (latest rerun; jobs 132407737864 and 132407738047). Refer to individual probe results, not only overall workflow state.

## Successful observations without production configuration changes

- 09:46:01–09:46:04 UTC: 6/6 requests returned HTTP 200, certificate verification successful, TLS 1.2 and 1.3. Simultaneous server-side TCP capture showed complete exchanges and acknowledgements.
- 09:49:06–09:49:32 UTC: 36/36 requests returned HTTP 200 from three Azure regions (westus, southcentralus, westus2).
- 09:53:26–09:53:48 UTC: another 36/36 requests returned HTTP 200 from three Azure regions (eastus, southcentralus, eastus2).
- Total since 09:46: 78/78 ordinary HTTPS requests succeeded during these sampled periods. This was not a continuous availability test and does not verify the owner's current mobile route.
- SSL Labs assessment started at 09:41:59 UTC and completed with grade A. TLS 1.2/1.3 and modern Apple/Android trust paths were available during that assessment.

Read-only synchronized captures:

- https://github.com/rsad79922-sys/po-puti/actions/runs/43582085532
- https://github.com/rsad79922-sys/po-puti/actions/runs/43582320560
- https://github.com/rsad79922-sys/po-puti/actions/runs/43582652259

## Server observations

- po-puti and nginx active; local HTTP and local HTTPS health returned HTTP 200.
- nginx listens on 0.0.0.0:443 and [::]:443.
- Valid Let's Encrypt certificate for vputipoputka.ru, valid 13 Nov 2026–11 Feb 2027; external certificate verification succeeded.
- The effective site configuration includes TLS 1.2 and TLS 1.3. An outer nginx configuration line lists older versions, but the included site configuration and independent negotiated-protocol results must be considered before drawing conclusions.
- eth0 MTU 1500, virtio interface; tcp_mtu_probing=0. These values alone are not evidence of a defect.
- Large captured outbound units (e.g. 2776/2856 bytes) are compatible with offload/GSO and are not proof of oversized packets on the wire.
- The earlier owner-provided UFW state was inactive and the mangle table had no custom rules. This does not rule out other firewall tables or provider filtering.

## ClientHello size experiment and its limits

Synthetic initial TLS messages of 512, 1200, 1535, and 3000 bytes were sent while recording TCP metadata. Two external machines received prompt TLS records for all sizes: TLS 1.3 handshake records and TLS 1.2 alert records. This establishes delivery and a server response for those particular first flights, not a completed handshake with the modified transcript. One Ubuntu 22.04 Python/OpenSSL client failed locally before network transmission; those eight local client errors are not server failures. Ordinary curl requests on that same machine all succeeded. No size-specific network timeout was reproduced in this sampled interval.

## Unresolved

The initial captures contained successes only; a later synchronized capture reproduced the failure. At 10:13–10:14 UTC, established external 443 flows received no ClientHello payload, or only the first 1448 bytes of a larger ClientHello at eth0; nginx eventually timed out waiting for the remainder. CPU/memory pressure was not observed. This locates the missing data before delivery to the nginx TLS parser, but does not identify the exact upstream filter, network component or virtual-network defect. MTU/MSS is not established as the cause.

Further resolution requires a synchronized capture during recurrence, ideally at the provider virtual switch/uplink as well as the guest interface. Inspect packet loss, retransmissions, anti-DDoS/SYN proxy filtering, routing, PMTUD, and guest resource pressure at the failed timestamps. Do not permanently change MTU, disable certificate verification, enable obsolete TLS, or roll back the working application based only on these observations.

## Draft for AdminVPS support (not sent)

VPS public IPv4: 130.49.129.99. Domain/SNI: vputipoputka.ru.

Please investigate intermittent TCP/443 TLS handshake stalls. On 14 Nov 2026 at 09:41:33–09:42:48 UTC, two independent GitHub runners (AWS us-west-2, Azure centralus) completed TCP connects, but 26/27 HTTPS checks stalled during TLS. Both TLS 1.2/1.3 and DNS/pinned-IP routes were affected. nginx also recorded SSL-handshake timeouts for the owner's phone. Guest loopback HTTP and HTTPS health checks succeeded. At 09:42:48 the final external check succeeded; later 78/78 checks from several regions succeeded without production configuration changes. SSL Labs later completed with grade A.

Please correlate those timestamps with host/vSwitch/uplink packet loss, anti-DDoS/SYN proxy events, rate limits and routing changes. We need comparison of guest-side and provider-side packet delivery during a recurrence before assigning a root cause or changing MTU/MSS. Public diagnostic evidence is linked above. No passwords, private keys, application bodies or database records are included.

## Follow-up: captured recurrence and verified alternate port

The owner authorized further investigation and repair on 14 Nov 2026.

- Run https://github.com/rsad79922-sys/po-puti/actions/runs/43584123862 reproduced a synchronized transition from success to failure around 10:13 UTC on three machines. Across 177 ordinary curl/modern Node TLS probes there were 50 failures (15, 17, 18 by machine). The modern client used Node 24.22.2 / OpenSSL 3.5.9 and certificate verification. A sample failing stream completed SYN/SYN-ACK/ACK at 10:13:00, delivered no TLS data to eth0, and timed out at 10:14:00. Other streams delivered only 1448 bytes of a larger initial message and no remainder. Guest nginx CPU stayed approximately 0%, available memory approximately 3.4 GB, no swap use.
- Run https://github.com/rsad79922-sys/po-puti/actions/runs/43584567995 tested the canonical SNI, API SNI, no SNI, and unrelated SNI while explicitly validating the certificate against the canonical hostname. All 36 external TLS connections timed out; simultaneous guest loopback HTTPS health returned 200. This did not support a canonical-domain-only/SNI-only failure.
- Run https://github.com/rsad79922-sys/po-puti/actions/runs/43584903375 temporarily opened a TCP relay on 8443 to the existing loopback nginx 443 listener for 100 seconds. This relay reused the existing nginx TLS service and certificate without reading or exporting the private key. Three paired tests gave **443: 3/3 TLS timeouts; 8443: 3/3 HTTP 200, certificate verification 0**, around 10:21:45–10:22:02 UTC. Port 80 returned 301; an unencrypted, credential-free HTTP control request to port 443 also timed out. The relay then stopped automatically, and no listener remained on 8443. This establishes a port-specific externally observable failure while the same nginx TLS service was functional through another port.
- Application fixes were preserved in main via https://github.com/rsad79922-sys/po-puti/pull/7 after API smoke, WebKit, and Android CI passed. This did not change the deployed runtime or resolve the network issue.

### Prepared mitigation, not applied

A proposal adds `listen 8443 ssl` to the existing active site, retains 443, and adds only the two explicit :8443 site origins to the running API origins. It takes private configuration backups, arms an independent four-minute systemd rollback timer, validates nginx, reloads nginx and restarts the API, then checks public TLS 1.2/1.3, app.js hash, all boot assets, allowed-origin preflight, unauthenticated state rejection, untrusted-origin rejection, and invalid registration validation without creating accounts. Only successful validation disarms rollback. Rollback byte/permission restoration was tested in an isolated temporary directory. Database and uploads are never rewritten.

Automatic approval review rejected committing this push-triggered mitigation workflow because opening a persistent production port, changing CORS and restarting services requires explicit authorization for those changes. The earlier broad authorization was not accepted as specific enough. The mitigation has not been applied. A specific approval is required before retrying; the rejection must not be bypassed.

### Additional evidence for AdminVPS support

Please inspect external TCP/443 handling between 10:13 and 10:22 UTC. Guest capture shows TCP establishment with absent or incomplete application payload, while local HTTPS is healthy. A verified 8443-to-loopback-443 TCP relay returned HTTP 200 with the same nginx and certificate during simultaneous failures on external 443. Even a plain HTTP control request to 443 timed out, while port 80 responded. Check provider port-specific filtering/SYN proxy/anti-DDoS state and the host virtual switch; compare ingress/egress against the guest captures. No permanent workaround was installed.

## Approved mitigation applied and verified (10:32 UTC)

The owner explicitly authorized opening port 8443, changing nginx and CORS, restarting services and retaining the configuration after successful validation. The approved workflow completed successfully: https://github.com/rsad79922-sys/po-puti/actions/runs/43585751858 .

- Added one `listen 8443 ssl` directive to the existing active site, preserving port 443 and the existing certificate.
- Preserved the running APP_ORIGINS and appended only `https://vputipoputka.ru:8443` and `https://api.vputipoputka.ru:8443`.
- Saved private configuration backups under `/var/backups/po-puti-https8443-khLpq16k`; nginx syntax validation passed.
- An independent four-minute rollback timer was armed before modifications. After external checks passed, the timer was stopped and the changes retained at 10:32:44 UTC. No active temporary TCP relay is involved in the retained entry.
- External AWS us-west-2 checks: 6/6 TLS 1.2/1.3 health requests returned 200 with certificate verification 0. HTML, app.js, CSS, Service Worker, manifest and config.js loaded. app.js SHA-256 matched the deployed approved code.
- Approved-origin CORS preflight returned 204. Unauthenticated state returned 401; untrusted-origin preflight returned 403; invalid empty registration returned 400. No test accounts or application records were created.
- Database and uploaded photos were not rewritten or restored. Account data remains in the same database. Browser login tokens are origin-specific, so a user opening :8443 may need to sign in again with their existing credentials.
- Independent real Chromium mobile-viewport navigation at 10:35 UTC loaded the public login UI three times, removed the boot overlay, fetched health successfully and reopened after Service Worker activation without browser runtime errors. Evidence: https://github.com/rsad79922-sys/po-puti/actions/runs/43585944263 . No production accounts were used.

The working web entry is **https://vputipoputka.ru:8443/**. Physical-phone verification and long-term cross-network stability are not established by these tests. Existing Android APKs still embed their previous API URL and are not automatically updated by changing nginx; a new Android configuration/build is a separate follow-up. The provider investigation for the original 443 failure remains open.

## Последующее расследование: обход 8443 также не гарантирует доступность

После запроса владельца установить и исправить причину выполнен двусторонний захват: клиентский tcpdump фиксирует отправку и повторные передачи ClientHello размером 223 байта, но эти пакеты отсутствуют на eth0 VPS. SYN/SYN-ACK/ACK присутствуют с совпадающими начальными TCP sequence numbers. В той серии (10:42 UTC) 443 отвечал, а 8443 зависал — направление разницы между портами изменилось. Полные правила и списки служб не публиковались: первоначальную попытку такого расширенного вывода отклонила автоматическая проверка. Вместо неё опубликованы безопасные агрегаты: iptables rules 0, nft rules 0, TC classifiers отсутствуют, XDP отсутствует, rx/tx dropped/errors 0. Копирование пакетов на клиенте и сервере локализует потерю между этими точками, но не называет конкретный внешний узел.

Check-Host независимо воспроизвёл успех 443 и тайм-аут 8443, включая проверку обоих портов на одних и тех же узлах Германии, Нидерландов и Украины. В следующем окне оба порта снова ответили: обычный TLS и четыре варианта сегментации прошли все 12 проверок. Уменьшение MSS не подтвердилось как средство устранения; производственные MTU/MSS не менялись. Поэтому обозначение 8443 как рабочего входа относится к успешному временному окну и не должно читаться как доказательство постоянной доступности.

Подключён SSH к VPS, но не личный кабинет AdminVPS и не средства управления сетью провайдера. Для установления конкретного внешнего устройства/правила и исправления необходимы сетевые данные и действия провайдера. Подготовлен адресный текст обращения с проверяемыми seq/ack и временем: [ADMINVPS-SUPPORT-2026-11-14.md](ADMINVPS-SUPPORT-2026-11-14.md). Обращение не отправлялось. Разрешение владельца на ремонт не создаёт отсутствующего технического подключения к кабинету хостинга.
