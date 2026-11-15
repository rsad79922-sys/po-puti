'use strict';
fetch('/api/public-config',{credentials:'omit',cache:'no-store'}).then(r=>r.json()).then(c=>{if(c.privacy?.operator&&c.privacy?.contact)document.getElementById('privacy-owner').textContent=c.privacy.operator+'. Контакт: '+c.privacy.contact}).catch(()=>{});
