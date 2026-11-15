#!/usr/bin/env bash
# Generate/retain VAPID only on the VPS. Never return private key material.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || exit 2
cd /opt/po-puti
backup_dir=$(mktemp -d /var/backups/po-puti-web-push-XXXXXXXX)
install -d -m 0750 -o root -g poputi /etc/po-puti
if [[ -f /etc/po-puti/push.env ]]; then cp -a /etc/po-puti/push.env "$backup_dir/push.env.before"; fi
node --input-type=module <<'JS'
import {readFileSync,existsSync,writeFileSync,renameSync} from 'node:fs';import {parseEnv} from 'node:util';import {createECDH} from 'node:crypto';import {generateVAPIDKeys} from 'web-push';
const path='/etc/po-puti/push.env',read=p=>existsSync(p)?readFileSync(p,'utf8'):'';const original=read(path),env={...parseEnv(read('/etc/po-puti/po-puti.env')),...parseEnv(original)};let publicKey=env.VAPID_PUBLIC_KEY,privateKey=env.VAPID_PRIVATE_KEY;
if(!!publicKey!==!!privateKey)throw Error('Incomplete existing VAPID configuration; refusing to rotate');
if(publicKey){const curve=createECDH('prime256v1');try{curve.setPrivateKey(Buffer.from(privateKey,'base64url'));if(!curve.getPublicKey().equals(Buffer.from(publicKey,'base64url')))throw Error()}catch{throw Error('Existing VAPID pair is invalid; existing file preserved')}}else{const pair=generateVAPIDKeys();publicKey=pair.publicKey;privateKey=pair.privateKey}
const subject=env.VAPID_SUBJECT||'https://vputipoputka.ru';if(!/^(?:mailto:|https:\/\/)/.test(subject)||/[\r\n]/.test(subject))throw Error('Invalid VAPID subject');
const other=original.split('\n').filter(line=>!/^\s*VAPID_/.test(line)).join('\n');const temporary=path+'.pending-'+process.pid;writeFileSync(temporary,other+'\nVAPID_PUBLIC_KEY='+publicKey+'\nVAPID_PRIVATE_KEY='+privateKey+'\nVAPID_SUBJECT='+subject+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,path);console.log('VAPID_PAIR_READY: existing valid keys retained or new pair generated privately');
JS
chown root:poputi /etc/po-puti/push.env
chmod 0640 /etc/po-puti/push.env
install -d -m 0755 /etc/systemd/system/po-puti.service.d
dropin=/etc/systemd/system/po-puti.service.d/45-web-push.conf
if [[ -f "$dropin" ]]; then cp -a "$dropin" "$backup_dir/dropin.before"; fi
printf '[Service]\nEnvironmentFile=/etc/po-puti/push.env\n' > "$dropin"
chmod 0644 "$dropin"
rollback(){
 local status=$?;trap - ERR
 cp -a /etc/po-puti/push.env "$backup_dir/push.env.failed"
 if [[ -f "$backup_dir/push.env.before" ]]; then cp -a "$backup_dir/push.env.before" /etc/po-puti/push.env;else rm -f /etc/po-puti/push.env;fi
 if [[ -f "$backup_dir/dropin.before" ]]; then cp -a "$backup_dir/dropin.before" "$dropin";else rm -f "$dropin";fi
 systemctl daemon-reload;systemctl restart po-puti || true
 exit "$status"
}
trap rollback ERR
systemctl daemon-reload
systemctl restart po-puti
healthy=0
for ((i=0;i<10;i++));do
 if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 4 http://127.0.0.1:8080/api/health | grep -q '"ok":true';then healthy=1;break;fi
 sleep 1
done
[[ "$healthy" -eq 1 ]]
trap - ERR
echo "WEB_PUSH_CONFIGURED: private settings active, valid pair preserved; backup $backup_dir"
