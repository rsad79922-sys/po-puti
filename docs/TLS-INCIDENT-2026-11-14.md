# vputipoputka.ru: intermittent TLS handshake timeout

## Current outcome

The application fixes were installed manually by the owner and verified publicly as boot14. Later read-only SSH diagnostics succeeded using the existing GitHub production connection. No nginx, firewall, MTU, sysctl, application, or database settings were changed by these diagnostic runs. The TLS timeout remains unresolved; subsequent successful connections are recovery observations, not evidence of a repair.

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

No failing externally generated TLS attempt was reproduced during the synchronized VPS captures. Therefore the exact missing packet or blocked TLS stage is not identified. No claim can be made that MTU/MSS, a particular TLS cipher, the certificate chain, nginx, or the provider is the proven root cause. The earlier 26 failures and the subsequent recovery must both be retained.

Further resolution requires a synchronized capture during recurrence, ideally at the provider virtual switch/uplink as well as the guest interface. Inspect packet loss, retransmissions, anti-DDoS/SYN proxy filtering, routing, PMTUD, and guest resource pressure at the failed timestamps. Do not permanently change MTU, disable certificate verification, enable obsolete TLS, or roll back the working application based only on these observations.

## Draft for AdminVPS support (not sent)

VPS public IPv4: 130.49.129.99. Domain/SNI: vputipoputka.ru.

Please investigate intermittent TCP/443 TLS handshake stalls. On 14 Nov 2026 at 09:41:33–09:42:48 UTC, two independent GitHub runners (AWS us-west-2, Azure centralus) completed TCP connects, but 26/27 HTTPS checks stalled during TLS. Both TLS 1.2/1.3 and DNS/pinned-IP routes were affected. nginx also recorded SSL-handshake timeouts for the owner's phone. Guest loopback HTTP and HTTPS health checks succeeded. At 09:42:48 the final external check succeeded; later 78/78 checks from several regions succeeded without production configuration changes. SSL Labs later completed with grade A.

Please correlate those timestamps with host/vSwitch/uplink packet loss, anti-DDoS/SYN proxy events, rate limits and routing changes. We need comparison of guest-side and provider-side packet delivery during a recurrence before assigning a root cause or changing MTU/MSS. Public diagnostic evidence is linked above. No passwords, private keys, application bodies or database records are included.
