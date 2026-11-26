import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import {initializeParentBus} from './parent-bus.mjs';
import {boundedInteger,consumeLoginAttempt,LOGIN_ATTEMPT_LIMIT_MESSAGE,logLoginFailure,parseAllowedOrigins,sessionDays} from './security-controls.mjs';

dotenv.config();
const {Pool}=pg;
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:boundedInteger(process.env.SCHOOL_DB_POOL_MAX,8,1,100),idleTimeoutMillis:30000,connectionTimeoutMillis:5000});
const livePool=process.env.TRACCAR_DATABASE_URL?new Pool({connectionString:process.env.TRACCAR_DATABASE_URL,max:boundedInteger(process.env.SCHOOL_TRACKER_DB_POOL_MAX,4,1,50),idleTimeoutMillis:30000,connectionTimeoutMillis:4000}):null;
const PORT=boundedInteger(process.env.SCHOOL_API_PORT,3002,1,65535);
const SESSION_DAYS=sessionDays(process.env.SCHOOL_SESSION_DAYS);
const tokenHash=token=>crypto.createHash('sha256').update(String(token||'')).digest('hex');
const clean=value=>String(value??'').trim();
const parseAttrs=value=>{if(value&&typeof value==='object')return value;try{return JSON.parse(value||'{}')}catch{return {}}};
const hashPassword=(password,salt=crypto.randomBytes(16).toString('hex'))=>`${salt}:${crypto.scryptSync(String(password),salt,64).toString('hex')}`;
const verifyPassword=(password,stored)=>{try{const [salt,hash]=String(stored||'').split(':');if(!salt||!hash)return false;return crypto.timingSafeEqual(crypto.scryptSync(String(password),salt,64),Buffer.from(hash,'hex'))}catch{return false}};
const schoolKeys=new Set(['schoolBuses','schoolBranches','schoolChildren','schoolParents','schoolScans','schoolRoutes','drivers','schoolAttenders','schoolCoordinators','schoolRfidCards','schoolRfidReaders','schoolSettings','companyProfile','companyPreferences','headerBanner']);
const origins=parseAllowedOrigins(process.env.SCHOOL_ALLOWED_ORIGINS,'https://trackschoolbus.masar.qa,https://track.almasar.qa,http://localhost:5173,http://localhost:5177,http://localhost:5178,http://127.0.0.1:5173,http://127.0.0.1:5177,http://127.0.0.1:5178');
if(String(process.env.SCHOOL_ALLOWED_ORIGINS||'').split(',').some(origin=>origin.trim()==='*'))console.warn('Ignoring wildcard SCHOOL_ALLOWED_ORIGINS; configure explicit portal origins.');
app.disable('x-powered-by');
app.set('trust proxy','loopback');
app.use(cors({origin(origin,callback){callback(null,!origin||origins.has(origin))},credentials:false}));
app.use(express.json({limit:'8mb'}));
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(self)',"Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});if(req.path.startsWith('/api/'))res.set({'Cache-Control':'no-store','Pragma':'no-cache'});if(req.secure&&(process.env.NODE_ENV==='production'||process.env.ENABLE_HSTS==='true'))res.set('Strict-Transport-Security','max-age=31536000');next()});

const trackingApi=axios.create({baseURL:process.env.TRACCAR_BASE_URL||'http://127.0.0.1:8082',auth:{username:process.env.TRACCAR_ADMIN_EMAIL||'',password:process.env.TRACCAR_ADMIN_PASSWORD||''},timeout:10000,headers:{'Content-Type':'application/json'}});
let liveCache=null,liveCacheAt=0,livePending=null;
async function loadLiveRaw(){
  if(livePool){
    try{
      const {rows}=await livePool.query(`SELECT d.id,d.name,d.uniqueid,d.status,d.lastupdate,d.positionid,
        p.protocol,p.latitude,p.longitude,p.speed,p.course,p.altitude,p.fixtime,p.devicetime,p.servertime,p.valid,p.attributes,
        vp.latitude AS last_valid_latitude,vp.longitude AS last_valid_longitude,vp.course AS last_valid_course,
        vp.altitude AS last_valid_altitude,vp.fixtime AS last_valid_fixtime,vp.devicetime AS last_valid_devicetime,
        vp.servertime AS last_valid_servertime
        FROM tc_devices d LEFT JOIN tc_positions p ON p.id=d.positionid
        LEFT JOIN LATERAL (SELECT latitude,longitude,course,altitude,fixtime,devicetime,servertime FROM tc_positions
          WHERE deviceid=d.id AND valid=TRUE AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
            AND (abs(latitude)>0.000001 OR abs(longitude)>0.000001) ORDER BY id DESC LIMIT 1) vp ON p.valid=FALSE`);
      return {source:'database',rows};
    }catch(error){console.error('School live database query unavailable:',error.message)}
  }
  const [devicesResult,positionsResult]=await Promise.all([trackingApi.get('/api/devices'),trackingApi.get('/api/positions')]);
  const devices=Array.isArray(devicesResult.data)?devicesResult.data:[],positions=Array.isArray(positionsResult.data)?positionsResult.data:[],byDevice=new Map(positions.map(p=>[String(p.deviceId),p]));
  return {source:'api',rows:devices.map(d=>{const p=byDevice.get(String(d.id))||{};return{id:d.id,name:d.name,uniqueid:d.uniqueId,status:d.status,lastupdate:d.lastUpdate,positionid:d.positionId,protocol:p.protocol,latitude:p.latitude,longitude:p.longitude,speed:p.speed,course:p.course,altitude:p.altitude,fixtime:p.fixTime,devicetime:p.deviceTime,servertime:p.serverTime,valid:p.valid,attributes:p.attributes||{}}})};
}
async function readLiveSnapshots(){const now=Date.now();if(liveCache&&now-liveCacheAt<2500)return liveCache;if(livePending)return livePending;livePending=loadLiveRaw().then(value=>{liveCache=value;liveCacheAt=Date.now();return value}).finally(()=>{livePending=null});return livePending}

async function schoolAuth(req,res,next){
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();if(!token)return res.status(401).json({error:'not_authenticated'});
    const row=(await pool.query(`SELECT u.id,u.company_id,u.name,u.email,u.role,u.status,u.metadata,s.expires_at,
      sa.display_name AS school_name,sa.status AS school_status,c.status AS company_status
      FROM school_portal_sessions s JOIN auth_users u ON u.id=s.user_id
      LEFT JOIN school_accounts sa ON sa.company_id=u.company_id
      LEFT JOIN companies c ON c.id=u.company_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[tokenHash(token)])).rows[0];
    if(!row)return res.status(401).json({error:'not_authenticated'});
    if(row.status!=='active'||row.school_status!=='active'||row.company_status!=='active')return res.status(403).json({error:'school_account_disabled'});
    const isSchoolAdmin=row.role==='school_admin'&&row.metadata?.schoolAdmin===true;
    const isSchoolParent=row.role==='parent'&&row.metadata?.schoolParent===true;
    if(!isSchoolAdmin&&!isSchoolParent)return res.status(403).json({error:'school_role_required'});
    req.schoolToken=token;req.user=row;next();
  }catch(error){console.error('School authentication error:',error.message);res.status(500).json({error:'school_auth_failed'})}
}
const requireSchoolAdmin=(req,res,next)=>req.user?.role==='school_admin'&&req.user?.metadata?.schoolAdmin===true?next():res.status(403).json({error:'school_administrator_required'});

async function fleetSuper(req,res,next){
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();if(!token)return res.status(401).json({error:'not_authenticated'});
    const user=(await pool.query(`SELECT u.id,u.role,u.status FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW() AND COALESCE(s.active_app_role,'fleet')='fleet'`,[tokenHash(token)])).rows[0];
    if(!user||user.role!=='super_admin'||user.status!=='active')return res.status(403).json({error:'super_admin_required'});
    req.superAdmin=user;next();
  }catch(error){console.error('School account administration auth error:',error.message);res.status(500).json({error:'school_admin_auth_failed'})}
}

app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'masar-school-api',database:'connected'})}catch{res.status(503).json({ok:false,service:'masar-school-api',database:'unavailable'})}});

app.post('/api/school/auth/login',async(req,res)=>{
  const email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
  try{
    const attempt=await consumeLoginAttempt(pool,email);
    if(!attempt.allowed){logLoginFailure(req,email,'rate_limited');res.set('Retry-After',String(attempt.retryAfterSeconds));return res.status(429).json({error:'too_many_login_attempts',message:LOGIN_ATTEMPT_LIMIT_MESSAGE})}
    const row=(await pool.query(`SELECT u.id,u.company_id,u.name,u.email,u.password_hash,u.role,u.status,u.metadata,
      sa.display_name AS school_name,sa.status AS school_status,c.status AS company_status
      FROM auth_users u JOIN school_accounts sa ON sa.company_id=u.company_id JOIN companies c ON c.id=u.company_id
      WHERE lower(u.email)=lower($1) LIMIT 1`,[email])).rows[0];
    const allowedAdmin=row?.role==='school_admin'&&row?.metadata?.schoolAdmin===true;
    const allowedParent=row?.role==='parent'&&row?.metadata?.schoolParent===true;
    if(!row||!verifyPassword(password,row.password_hash)||(!allowedAdmin&&!allowedParent)){logLoginFailure(req,email,'invalid_credentials');return res.status(401).json({error:'invalid_credentials'})}
    if(row.status!=='active'||row.school_status!=='active'||row.company_status!=='active'){return res.status(403).json({error:'school_account_disabled'})}
    const token=crypto.randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+SESSION_DAYS*86400000);
    await pool.query('INSERT INTO school_portal_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[tokenHash(token),row.id,expiresAt]);
    const {password_hash:_hidden,...user}=row;
    res.set('Cache-Control','no-store').json({token,expiresAt:expiresAt.toISOString(),user:{id:Number(user.id),companyId:Number(user.company_id),name:user.name,email:user.email,role:user.role,status:user.status,metadata:user.metadata||{},schoolName:user.school_name}});
  }catch(error){console.error('School login failed:',error.message);res.status(500).json({error:'school_login_failed'})}
});
app.get('/api/school/auth/me',schoolAuth,(req,res)=>res.json({id:Number(req.user.id),companyId:Number(req.user.company_id),name:req.user.name,email:req.user.email,role:req.user.role,status:req.user.status,metadata:req.user.metadata||{},schoolName:req.user.school_name}));
app.post('/api/school/auth/logout',schoolAuth,async(req,res)=>{try{await pool.query('DELETE FROM school_portal_sessions WHERE token_hash=$1',[tokenHash(req.schoolToken)])}catch{}res.json({ok:true})});

app.get('/api/school/admin/accounts',fleetSuper,async(_req,res)=>{
  try{const rows=(await pool.query(`SELECT sa.company_id AS "companyId",sa.display_name AS "schoolName",sa.status,
    sa.created_at AS "createdAt",u.id AS "adminUserId",u.name AS "adminName",u.email AS "adminEmail"
    FROM school_accounts sa LEFT JOIN auth_users u ON u.id=sa.admin_user_id ORDER BY sa.display_name`)).rows;res.json(rows)}
  catch(error){console.error('School accounts list failed:',error.message);res.status(500).json({error:'school_accounts_unavailable'})}
});
app.post('/api/school/admin/accounts',fleetSuper,async(req,res)=>{
  const companyId=Number(req.body?.companyId),schoolName=clean(req.body?.schoolName),adminName=clean(req.body?.adminName),email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
  if(!Number.isSafeInteger(companyId)||companyId<1||!schoolName||!adminName||!email.includes('@')||password.length<4)return res.status(400).json({error:'school_company_admin_name_email_and_4_character_password_required'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const company=(await client.query("SELECT id,status FROM companies WHERE id=$1 FOR UPDATE",[companyId])).rows[0];
    if(!company||company.status!=='active'){await client.query('ROLLBACK');return res.status(404).json({error:'active_company_not_found'})}
    const exists=(await client.query('SELECT 1 FROM school_accounts WHERE company_id=$1',[companyId])).rowCount>0;
    if(exists){await client.query('ROLLBACK');return res.status(409).json({error:'school_account_already_exists'})}
    const user=(await client.query(`INSERT INTO auth_users(company_id,name,email,password_hash,role,status,metadata)
      VALUES($1,$2,$3,$4,'school_admin','active',$5::jsonb) RETURNING id,name,email,role,status`,[companyId,adminName,email,hashPassword(password),JSON.stringify({schoolAdmin:true})])).rows[0];
    const account=(await client.query(`INSERT INTO school_accounts(company_id,display_name,status,admin_user_id,created_by)
      VALUES($1,$2,'active',$3,$4) RETURNING company_id AS "companyId",display_name AS "schoolName",status,created_at AS "createdAt"`,[companyId,schoolName,user.id,req.superAdmin.id])).rows[0];
    await client.query('COMMIT');res.status(201).json({...account,adminUserId:Number(user.id),adminName:user.name,adminEmail:user.email});
  }catch(error){try{await client.query('ROLLBACK')}catch{};console.error('School account creation failed:',error.message);res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'email_already_registered':'school_account_create_failed'})}finally{client.release()}
});

app.get('/api/school/company/me',schoolAuth,async(req,res)=>{
  try{const company=(await pool.query(`SELECT c.id,c.email,c.status,c.metadata,sa.display_name AS school_name,sa.status AS school_status
    FROM companies c JOIN school_accounts sa ON sa.company_id=c.id WHERE c.id=$1`,[req.user.company_id])).rows[0];
    if(!company)return res.status(404).json({error:'school_account_not_found'});
    res.json({id:Number(company.id),name:company.school_name,email:company.email,status:company.school_status,metadata:{...(company.metadata||{}),schoolName:company.school_name}})
  }catch(error){console.error('School profile load failed:',error.message);res.status(500).json({error:'school_profile_unavailable'})}
});
app.get('/api/school/state',schoolAuth,async(req,res)=>{
  try{const row=(await pool.query('SELECT data,version,updated_at AS "updatedAt" FROM school_portal_state WHERE company_id=$1',[req.user.company_id])).rows[0];res.json(row||{data:{},version:0,updatedAt:null})}
  catch(error){console.error('School state load failed:',error.message);res.status(500).json({error:'school_state_unavailable'})}
});
app.put('/api/school/state',schoolAuth,requireSchoolAdmin,async(req,res)=>{
  const incoming=req.body?.data;if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))return res.status(400).json({error:'school_state_data_required'});
  const data=Object.fromEntries(Object.entries(incoming).filter(([key])=>schoolKeys.has(key))),version=Number(req.body?.version);
  if(!Number.isSafeInteger(version)||version<0)return res.status(400).json({error:'school_state_version_required'});
  try{
    let row=(await pool.query(`UPDATE school_portal_state SET data=$1::jsonb,version=version+1,updated_by=$2,updated_at=NOW()
      WHERE company_id=$3 AND version=$4 RETURNING version,updated_at AS "updatedAt"`,[JSON.stringify(data),req.user.id,req.user.company_id,version])).rows[0];
    if(!row&&version===0){row=(await pool.query(`INSERT INTO school_portal_state(company_id,data,version,updated_by)
      VALUES($1,$2::jsonb,1,$3) ON CONFLICT(company_id) DO NOTHING RETURNING version,updated_at AS "updatedAt"`,[req.user.company_id,JSON.stringify(data),req.user.id])).rows[0]}
    if(!row)return res.status(409).json({error:'school_state_changed_refresh_and_retry'});
    res.json({...row,version:Number(row.version)});
  }catch(error){console.error('School state save failed:',error.message);res.status(500).json({error:'school_state_save_failed'})}
});

const vehicleCache=new Map();
async function schoolVehicles(companyId){
  const key=String(companyId),cached=vehicleCache.get(key),now=Date.now();if(cached&&now-cached.at<4000)return cached.value;if(cached?.pending)return cached.pending;
  const pending=(async()=>{
    const [{rows},live]=await Promise.all([
      pool.query(`SELECT v.*,c.name AS company_name,(v.expiration_date IS NOT NULL AND v.expiration_date<CURRENT_DATE) AS expired
        FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.company_id=$1
        AND COALESCE(v.metadata->>'archived','false')<>'true' AND COALESCE(c.status,'active')<>'archived' ORDER BY v.id DESC`,[companyId]),
      readLiveSnapshots().catch(()=>({source:'unavailable',rows:[]}))
    ]);
    const liveMap=new Map((live.rows||[]).map(row=>[String(row.id),row])),offlineMinutes=boundedInteger(process.env.OFFLINE_MINUTES,10,1,525600);
    return rows.map(vehicle=>{
      const found=vehicle.traccar_device_id==null?null:liveMap.get(String(vehicle.traccar_device_id)),raw=parseAttrs(found?.attributes),lastUpdate=found?.lastupdate||null,lastMs=Date.parse(lastUpdate||''),online=Number.isFinite(lastMs)&&Date.now()-lastMs<=offlineMinutes*60000;
      const valid=found?.valid!==false,latitude=valid?found?.latitude:(found?.last_valid_latitude??found?.latitude),longitude=valid?found?.longitude:(found?.last_valid_longitude??found?.longitude),speed=found?.speed==null?null:Number((Number(found.speed)*1.852).toFixed(1)),ignition=typeof raw.ignition==='boolean'?raw.ignition:null,motion=typeof raw.motion==='boolean'?raw.motion:null;
      const status=vehicle.expired?'offline':!online?'offline':ignition===false?'parked':speed!=null&&speed>3?'moving':speed!=null&&speed<=3&&ignition===true?'idle':motion===true?'moving':'parked';
      const driverName=String(vehicle.metadata?.driverName||'').trim();
      return {...vehicle,driver_name:driverName,driver_qid:vehicle.metadata?.driverQid||'',driver_mobile:vehicle.metadata?.driverMobile||'',
        live_access:!vehicle.expired,access_status:vehicle.expired?'expired':'active',connection_status:online?'online':'offline',device_status:found?.status||'unknown',
        status,live_source:live.source||'unavailable',last_update:lastUpdate,position_time:found?.servertime||null,position_valid:found?.valid??null,fix_time:found?.fixtime||null,device_time:found?.devicetime||null,
        latitude:Number.isFinite(Number(latitude))?Number(latitude):null,longitude:Number.isFinite(Number(longitude))?Number(longitude):null,speed_kph:speed,course:found?.course??found?.last_valid_course??null,altitude:found?.altitude??found?.last_valid_altitude??null,
        ignition,motion,attributes:raw,telemetry:{},mapped_io:[],current_driver:driverName?{name:driverName}: {name:'Not identified'}};
    });
  })();vehicleCache.set(key,{at:now,pending});try{const value=await pending;vehicleCache.set(key,{at:Date.now(),value});return value}catch(error){vehicleCache.delete(key);throw error}
}
app.get('/api/school/vehicles',schoolAuth,requireSchoolAdmin,async(req,res)=>{try{res.json(await schoolVehicles(req.user.company_id))}catch(error){console.error('School vehicle list failed:',error.message);res.status(503).json({error:'school_vehicles_unavailable'})}});
app.get('/api/school/vehicles/stream',schoolAuth,requireSchoolAdmin,(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache,no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.write('retry: 3000\n\n');let closed=false,busy=false,last='';
  const push=async()=>{if(closed||busy)return;busy=true;try{const payload=JSON.stringify(await schoolVehicles(req.user.company_id));if(payload!==last){last=payload;res.write(`event: vehicles\ndata: ${payload}\n\n`)}}catch{if(!closed)res.write('event: unavailable\ndata: {}\n\n')}finally{busy=false}};
  push();const interval=setInterval(push,5000),heartbeat=setInterval(()=>{if(!closed)res.write(': heartbeat\n\n')},15000);req.on('close',()=>{closed=true;clearInterval(interval);clearInterval(heartbeat)});
});

// Schema changes are an explicit command (`npm run migrate:school`) so opening
// the local School API cannot silently run DDL against a tunneled/live database.
await pool.query('SELECT 1 FROM school_accounts LIMIT 1');
await pool.query('SELECT 1 FROM school_portal_sessions LIMIT 1');
await pool.query('SELECT 1 FROM mobile_push_tokens LIMIT 1');
await pool.query('SELECT 1 FROM auth_login_attempt_windows LIMIT 0');
app.post('/api/push/register',schoolAuth,async(req,res)=>{
  if(req.user.role!=='parent'||req.user.metadata?.schoolParent!==true)return res.status(403).json({error:'school_parent_required'});
  const token=String(req.body?.token||'');if(token.length<20||token.length>4096||/\s/.test(token))return res.status(400).json({error:'invalid_push_token'});
  try{await pool.query(`INSERT INTO mobile_push_tokens(token_hash,token,user_id,company_id,session_hash,app_role)
    VALUES($1,$2,$3,$4,$5,'parent') ON CONFLICT(token_hash) DO UPDATE SET token=EXCLUDED.token,user_id=EXCLUDED.user_id,
    company_id=EXCLUDED.company_id,session_hash=EXCLUDED.session_hash,app_role='parent',updated_at=NOW()`,
    [tokenHash(token),token,req.user.id,req.user.company_id,tokenHash(req.schoolToken)]);res.json({ok:true})}
  catch(error){console.error('School push registration failed:',error.message);res.status(500).json({error:'push_registration_failed'})}
});
app.post('/api/push/unregister',schoolAuth,async(req,res)=>{try{await pool.query('DELETE FROM mobile_push_tokens WHERE user_id=$1 AND token_hash=$2 AND app_role=\'parent\'',[req.user.id,tokenHash(req.body?.token||'')]);res.json({ok:true})}catch{res.status(500).json({error:'push_unregistration_failed'})}});
await initializeParentBus(app,{pool,requireAuth:schoolAuth,readLiveSnapshots});
const server=app.listen(PORT,'127.0.0.1',()=>console.info(`Masar School API listening on 127.0.0.1:${PORT}`));
async function shutdown(){server.close(()=>{});await Promise.allSettled([pool.end(),livePool?.end()]);process.exit(0)}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
