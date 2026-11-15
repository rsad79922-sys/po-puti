// Read-only, aggregate-only production diagnosis. No account IDs, text or credentials.
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync('/var/lib/po-puti/po-puti.sqlite',{readOnly:true});
try{
 const now=Date.now(),hour=3600000;
 const count=(sql,...args)=>db.prepare(sql).get(...args).n;
 console.log('REVIEW_DIAGNOSTICS',JSON.stringify({
 rides:count('SELECT COUNT(*) n FROM rides'),
 withoutEta:count('SELECT COUNT(*) n FROM rides WHERE estimated_arrival_at IS NULL'),
 acceptedBookings:count("SELECT COUNT(*) n FROM requests WHERE status='accepted'"),
 confirmationNotOpen:count('SELECT COUNT(*) n FROM rides WHERE cancelled=0 AND estimated_arrival_at+?>?',hour,now),
 confirmationWindowOpen:count('SELECT COUNT(*) n FROM rides WHERE cancelled=0 AND estimated_arrival_at+?<=? AND estimated_arrival_at+?>?',hour,now,hour+14*86400000,now),
 confirmationExpired:count('SELECT COUNT(*) n FROM rides WHERE estimated_arrival_at+?<=?',hour+14*86400000,now),
 outcomes:db.prepare('SELECT outcome,COUNT(*) count FROM rides GROUP BY outcome').all(),
 answers:db.prepare('SELECT answer,COUNT(*) count FROM ride_confirmations GROUP BY answer').all(),
 reviews:db.prepare('SELECT source,moderation_status,published_at IS NOT NULL published,COUNT(*) count FROM pair_reviews GROUP BY source,moderation_status,published').all(),
 legacyReviews:count('SELECT COUNT(*) n FROM reviews'),
 workers:db.prepare('SELECT name,last_started_at,last_finished_at,last_error FROM background_state').all()
 }));
}finally{db.close()}
