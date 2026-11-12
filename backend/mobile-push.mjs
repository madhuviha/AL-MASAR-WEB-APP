import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {alertSemanticKey} from './alert-rules.mjs';
const EXPECTED_PROJECT='masar-tracking-e9095';
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
export function pushContent(alert,vehicle={}){
 const speed=Number(alert.actualSpeed??alert.speed);const hasSpeed=alert.actualSpeed!=null||alert.speed!=null;
 const eventType=pushSoundEvent(alert);
 const channels={ignition_on:'masar_ignition_on_v1',ignition_off:'masar_ignition_off_v1',geofence_entry:'masar_geofence_entry_v1',geofence_exit:'masar_geofence_exit_v1',overspeed:'masar_overspeed_v1',general:'masar_general_v1'};
 return {title:`${vehicle.name||alert.vehicleName||'Vehicle'} · ${alert.type||'Alert'}`.slice(0,160),body:[hasSpeed&&Number.isFinite(speed)?`Speed: ${Math.round(speed)} km/h`:null,String(alert.description||alert.message||'').replace(/(\d+\.\d+)\s*(km\/h|kph)/gi,(_m,n,u)=>Math.round(Number(n))+' '+u)||null].filter(Boolean).join(' · ').slice(0,500),eventType,channelId:channels[eventType]};
}
function pushSoundEvent(alert={}){
 const values=[alert.eventType,alert.type,alert.event,alert.alertType,alert.category,alert.title,alert.description,alert.message].filter(Boolean).map(value=>String(value).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''));
 for(const event of values){
  const ignition=event.includes('ignition')||event.includes('engine');
  if(ignition&&/(^|_)(on|start|started|true)(_|$)/.test(event))return 'ignition_on';
  if(ignition&&/(^|_)(off|stop|stopped|false)(_|$)/.test(event))return 'ignition_off';
  if(event.includes('geofence')&&/(^|_)(entry|enter|entered|in)(_|$)/.test(event))return 'geofence_entry';
  if(event.includes('geofence')&&/(^|_)(exit|out|leave|left)(_|$)/.test(event))return 'geofence_exit';
  if(event.includes('overspeed')||event.includes('over_speed')||event.includes('speeding')||event.includes('speed_limit_exceeded'))return 'overspeed';
 }
 return 'general';
}
export function pushOutboxIdentity(alert,companyId=''){
 return {
  alertId:String(alert?.eventKey||alert?.id||''),
  semanticKey:alertSemanticKey(alert,companyId)
 };
}
export async function enqueueUserPushes(pool,{userIds=[],companyId,alertId,semanticKey,payload={}}={}){
 const ids=[...new Set((Array.isArray(userIds)?userIds:[]).map(Number).filter(Number.isSafeInteger))];
 if(!ids.length||!Number.isSafeInteger(Number(companyId))||!String(alertId||''))return {queued:0};
 const tokens=(await pool.query("SELECT token_hash FROM mobile_push_tokens WHERE company_id=$1 AND user_id=ANY($2::bigint[]) AND app_role='parent'",[companyId,ids])).rows;
 let queued=0;
 for(const token of tokens){
  const result=await pool.query('INSERT INTO mobile_push_outbox(token_hash,alert_id,semantic_key,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[token.token_hash,String(alertId),semanticKey?String(semanticKey):null,JSON.stringify(payload)]);
  queued+=result.rowCount||0;
 }
 return {queued,tokens:tokens.length};
}
export async function initializePush(app,{pool,requireAuth}){
 await pool.query(`CREATE TABLE IF NOT EXISTS mobile_push_tokens (token_hash text PRIMARY KEY,token text NOT NULL,user_id bigint NOT NULL,company_id bigint NOT NULL,session_hash text NOT NULL,app_role text NOT NULL DEFAULT 'fleet' CHECK(app_role IN ('fleet','parent')),created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW());ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS app_role text;UPDATE mobile_push_tokens t SET app_role=COALESCE(s.active_app_role,CASE WHEN u.role='parent' THEN 'parent' ELSE 'fleet' END,'fleet') FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=t.session_hash AND t.app_role IS NULL;UPDATE mobile_push_tokens SET app_role='fleet' WHERE app_role IS NULL;ALTER TABLE mobile_push_tokens ALTER COLUMN app_role SET DEFAULT 'fleet';ALTER TABLE mobile_push_tokens ALTER COLUMN app_role SET NOT NULL;DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='mobile_push_tokens'::regclass AND conname='mobile_push_tokens_app_role_check') THEN ALTER TABLE mobile_push_tokens ADD CONSTRAINT mobile_push_tokens_app_role_check CHECK(app_role IN ('fleet','parent')); END IF; END $$;CREATE TABLE IF NOT EXISTS mobile_push_outbox (id bigserial PRIMARY KEY,token_hash text NOT NULL,alert_id text NOT NULL,semantic_key text,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),next_attempt timestamptz NOT NULL DEFAULT NOW(),attempts int NOT NULL DEFAULT 0,sent_at timestamptz,UNIQUE(token_hash,alert_id));ALTER TABLE mobile_push_outbox ADD COLUMN IF NOT EXISTS semantic_key text;CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_outbox_token_semantic_key ON mobile_push_outbox(token_hash,semantic_key) WHERE semantic_key IS NOT NULL;`);
 const register=(path,...handlers)=>{app.post(`/api${path}`,...handlers);app.post(path,...handlers)};
 register('/push/register',requireAuth,async(req,res)=>{try{
  if(!req.user.company_id)return res.status(403).json({error:'company_account_required'});
  const token=String(req.body?.token||'');if(token.length<20||token.length>4096||/\s/.test(token))return res.status(400).json({error:'invalid_push_token'});
  const session=String(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  await pool.query(`INSERT INTO mobile_push_tokens(token_hash,token,user_id,company_id,session_hash,app_role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(token_hash) DO UPDATE SET token=EXCLUDED.token,user_id=EXCLUDED.user_id,company_id=EXCLUDED.company_id,session_hash=EXCLUDED.session_hash,app_role=EXCLUDED.app_role,created_at=CASE WHEN mobile_push_tokens.user_id<>EXCLUDED.user_id OR mobile_push_tokens.session_hash<>EXCLUDED.session_hash OR mobile_push_tokens.app_role<>EXCLUDED.app_role THEN NOW() ELSE mobile_push_tokens.created_at END,updated_at=NOW()`,[hash(token),token,req.user.id,req.user.company_id,hash(session),req.user.app_role||'fleet']);
  res.json({ok:true});
 }catch{res.status(500).json({error:'push_registration_failed'})}});
 register('/push/unregister',requireAuth,async(req,res)=>{await pool.query('DELETE FROM mobile_push_tokens WHERE user_id=$1 AND token_hash=$2',[req.user.id,hash(req.body?.token||'')]);res.json({ok:true})});
 let access=null,expiry=0,busy=false,lastCleanup=0;
 async function accessToken(){if(access&&Date.now()<expiry)return access;const key=JSON.parse(await readFile(process.env.FIREBASE_SERVICE_ACCOUNT||'/etc/inviha/firebase-admin.json','utf8'));if(key.project_id!==EXPECTED_PROJECT)throw Error('Wrong Firebase project');const now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:key.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});const assertion=unsigned+'.'+crypto.sign('RSA-SHA256',Buffer.from(unsigned),key.private_key).toString('base64url');const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||!d.access_token)throw Error('Firebase authorization failed');access=d.access_token;expiry=Date.now()+Math.max(60,Number(d.expires_in)-120)*1000;return access;}
 async function tick(){if(busy)return;busy=true;try{
  if(Date.now()-lastCleanup>3600000){await pool.query("DELETE FROM mobile_push_outbox WHERE created_at<NOW()-INTERVAL '24 hours';DELETE FROM mobile_push_tokens t WHERE t.updated_at<NOW()-INTERVAL '30 days' OR NOT ((t.app_role='parent' AND EXISTS(SELECT 1 FROM school_portal_sessions sp WHERE sp.token_hash=t.session_hash AND sp.expires_at>NOW())) OR (t.app_role='fleet' AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=t.session_hash AND s.expires_at>NOW() AND COALESCE(s.active_app_role,'fleet')='fleet')))");lastCleanup=Date.now()}
  const targets=await pool.query(`SELECT t.token_hash,t.company_id,t.created_at,t.app_role,c.data FROM mobile_push_tokens t JOIN auth_sessions s ON s.token_hash=t.session_hash AND s.expires_at>NOW() AND COALESCE(s.active_app_role,'fleet')='fleet' JOIN auth_users u ON u.id=t.user_id AND u.status='active' AND u.company_id=t.company_id JOIN companies co ON co.id=t.company_id AND co.status='active' JOIN company_state c ON c.company_id=t.company_id WHERE t.app_role='fleet'`);
  for(const target of targets.rows){if(target.app_role==='parent')continue;for(const a of (Array.isArray(target.data?.alerts)?target.data.alerts:[])){const time=Date.parse(a.createdAt);if(!a.id||!Number.isFinite(time)||time<+target.created_at||time<Date.now()-86400000||time>Date.now()+60000)continue;const {alertId,semanticKey}=pushOutboxIdentity(a,target.company_id);const v=(await pool.query('SELECT name FROM vehicles WHERE id::text=$1 AND company_id=$2',[String(a.vehicleId||''),target.company_id])).rows[0]||{};
   await pool.query('UPDATE mobile_push_outbox o SET semantic_key=$3 WHERE o.token_hash=$1 AND o.alert_id=$2 AND o.semantic_key IS NULL AND NOT EXISTS(SELECT 1 FROM mobile_push_outbox claimed WHERE claimed.token_hash=$1 AND claimed.semantic_key=$3)',[target.token_hash,alertId,semanticKey]);
   await pool.query('UPDATE mobile_push_outbox o SET sent_at=COALESCE(o.sent_at,NOW()) WHERE o.token_hash=$1 AND o.alert_id=$2 AND o.semantic_key IS NULL AND EXISTS(SELECT 1 FROM mobile_push_outbox claimed WHERE claimed.token_hash=$1 AND claimed.semantic_key=$3)',[target.token_hash,alertId,semanticKey]);
   await pool.query('INSERT INTO mobile_push_outbox(token_hash,alert_id,semantic_key,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[target.token_hash,alertId,semanticKey,JSON.stringify({...pushContent(a,v),vehicleId:String(a.vehicleId||'')})]);}}
  const jobs=await pool.query(`UPDATE mobile_push_outbox SET next_attempt=NOW()+INTERVAL '2 minutes',attempts=attempts+1 WHERE id IN(SELECT id FROM mobile_push_outbox WHERE sent_at IS NULL AND next_attempt<=NOW() AND attempts<8 ORDER BY id LIMIT 30 FOR UPDATE SKIP LOCKED) RETURNING *`);
  for(const job of jobs.rows){const t=(await pool.query(`SELECT t.token,t.app_role FROM mobile_push_tokens t JOIN auth_users u ON u.id=t.user_id AND u.status='active' AND u.company_id=t.company_id JOIN companies co ON co.id=t.company_id AND co.status='active' WHERE t.token_hash=$1 AND $2::timestamptz>=t.created_at AND ((t.app_role='fleet' AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=t.session_hash AND s.expires_at>NOW() AND COALESCE(s.active_app_role,'fleet')='fleet')) OR (t.app_role='parent' AND EXISTS(SELECT 1 FROM school_portal_sessions sp WHERE sp.token_hash=t.session_hash AND sp.expires_at>NOW())) )`,[job.token_hash,job.created_at])).rows[0];if(!t||t.app_role==='parent'&&!job.payload?.childId){await pool.query('DELETE FROM mobile_push_outbox WHERE id=$1',[job.id]);continue;}
   try{const token=await accessToken(),r=await fetch(`https://fcm.googleapis.com/v1/projects/${EXPECTED_PROJECT}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token:t.token,data:{alertId:String(job.alert_id),vehicleId:String(job.payload.vehicleId||''),childId:String(job.payload.childId||''),scanId:String(job.payload.scanId||''),title:String(job.payload.title||'Masar Tracking'),body:String(job.payload.body||''),eventType:String(job.payload.eventType||'general'),channelId:String(job.payload.channelId||'masar_general_v1')},android:{priority:'high',ttl:'86400s'}}}),signal:AbortSignal.timeout(15000)});const result=await r.json();if(r.ok)await pool.query('UPDATE mobile_push_outbox SET sent_at=NOW() WHERE id=$1',[job.id]);else if(result.error?.details?.some(x=>x.errorCode==='UNREGISTERED'))await pool.query('DELETE FROM mobile_push_tokens WHERE token_hash=$1',[job.token_hash]);else {if(r.status===401){access=null;expiry=0;}console.error('Push delivery rejected',r.status);}}catch{console.error('Push delivery retry scheduled');}
  }
 }catch{console.error('Push worker temporarily unavailable')}finally{busy=false}}
 const timer=setInterval(tick,10000);timer.unref();void tick();return ()=>clearInterval(timer);
}
