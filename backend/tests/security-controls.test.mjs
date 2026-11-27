import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {boundedInteger,clearSessionCookie,consumeLoginAttempt,createLoginLimiter,hasSessionCookie,isWebClient,LOGIN_ATTEMPT_LIMIT_MESSAGE,LOGIN_IP_LIMIT_MESSAGE,loginIdentityHash,originAllowedForApiRequest,originAllowedForCookieRequest,parseAllowedOrigins,parseRequestCookies,redactSensitiveData,redactSensitiveText,requestClient,sessionCookieName,sessionDays,sessionLifetimeMs,sessionTokenFromRequest,setSessionCookie,usesCookieSession,validateProductionOrigins} from '../security-controls.mjs';

function loginWindowDb(){
  const windows=new Map();
  return {windows,async query(sql,[identityHash,timestamp,windowMs=60000]){
    assert.match(sql,/ON CONFLICT\(account_hash\) DO UPDATE/);
    const now=new Date(timestamp).getTime(),old=windows.get(identityHash),period=Number(windowMs)||60000;
    const row=!old||old.startedAt+period<=now?{startedAt:now,count:1}:{startedAt:old.startedAt,count:old.count+1};
    windows.set(identityHash,row);
    return {rows:[{window_started_at:new Date(row.startedAt),attempt_count:row.count}]};
  }};
}

test('database login limit allows attempts one through five, blocks six, and resets at 60 seconds',async()=>{
  const db=loginWindowDb(),start=Date.parse('2026-11-16T12:00:00Z');
  assert.equal(loginIdentityHash(' User@Example.com '),loginIdentityHash('user@example.com'));
  for(let i=1;i<=5;i++){
    const result=await consumeLoginAttempt(db,i%2?'User@example.com':'user@example.com',start);
    assert.deepEqual(result,{allowed:true,attempts:i,retryAfterSeconds:60});
  }
  const blocked=await consumeLoginAttempt(db,'USER@example.com',start);
  assert.deepEqual(blocked,{allowed:false,attempts:6,retryAfterSeconds:60});
  assert.equal(LOGIN_ATTEMPT_LIMIT_MESSAGE,'Too many login attempts. Please try again after 1 minute.');
  const reset=await consumeLoginAttempt(db,'user@example.com',start+60000);
  assert.deepEqual(reset,{allowed:true,attempts:1,retryAfterSeconds:60});
});

test('fleet and School Bus APIs both use the shared account counter and response message',()=>{
  const fleet=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const school=fs.readFileSync(new URL('../school-server.js',import.meta.url),'utf8');
  for(const source of [fleet,school]){
    assert.match(source,/consumeLoginAttempt\(pool,email\)/);
    assert.match(source,/LOGIN_ATTEMPT_LIMIT_MESSAGE/);
    assert.match(source,/status\(429\)/);
  }
  assert.doesNotMatch(school,/schoolLoginLimiter|loginBlocked\(req,email\)/);
  assert.match(fleet,/LOGIN_IP_WINDOW_MS/);
  assert.match(school,/LOGIN_IP_WINDOW_MS/);
});

test('database IP request limit uses an independent 15-minute window',async()=>{
  const db=loginWindowDb(),start=Date.parse('2026-11-16T12:00:00Z'),policy={windowMs:15*60_000,maxAttempts:2};
  assert.deepEqual(await consumeLoginAttempt(db,'ip:192.0.2.9',start,policy),{allowed:true,attempts:1,retryAfterSeconds:900});
  assert.deepEqual(await consumeLoginAttempt(db,'ip:192.0.2.9',start+30_000,policy),{allowed:true,attempts:2,retryAfterSeconds:870});
  assert.deepEqual(await consumeLoginAttempt(db,'ip:192.0.2.9',start+60_000,policy),{allowed:false,attempts:3,retryAfterSeconds:840});
  assert.equal(LOGIN_IP_LIMIT_MESSAGE,'Too many sign-in requests from this network. Please wait 15 minutes.');
});

test('Super Admin MFA uses a separate persistent account and IP attempt window',async()=>{
  const db=loginWindowDb(),start=Date.parse('2026-11-16T12:00:00Z'),policy={windowMs:15*60_000,maxAttempts:8};
  for(let i=1;i<=8;i++)assert.equal((await consumeLoginAttempt(db,'mfa:42:192.0.2.1',start,policy)).allowed,true);
  const blocked=await consumeLoginAttempt(db,'mfa:42:192.0.2.1',start,policy);
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.retryAfterSeconds,900);
  assert.ok([...db.windows.keys()].every(key=>/^[a-f0-9]{64}$/.test(key)));
});

test('startup role migration is schema-only and does not create grants or rewrite sessions',()=>{
  const migration=fs.readFileSync(new URL('../migration-auth-app-roles.sql',import.meta.url),'utf8');
  const parentMigration=fs.readFileSync(new URL('../migration-parent-bus.sql',import.meta.url),'utf8');
  const schoolMigration=fs.readFileSync(new URL('../migration-school-portal.sql',import.meta.url),'utf8');
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  assert.doesNotMatch(migration,/INSERT\s+INTO\s+auth_user_app_roles/i);
  assert.doesNotMatch(migration,/UPDATE\s+auth_sessions/i);
  assert.doesNotMatch(parentMigration,/auth_users_role_check/i);
  assert.doesNotMatch(schoolMigration,/auth_users_role_check/i);
  assert.doesNotMatch(server,/migration-school-admin-role\.sql/i);
  assert.match(migration,/existing rows remain/i);
});

test('Release 1 keeps MFA enforcement behind the explicit enable switch until staged proof is complete',()=>{
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const environment=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
  assert.match(environment,/SUPER_ADMIN_MFA_REQUIRED=false/);
  assert.match(server,/superAdminMfaRequired\(\)\|\|u\.mfa_totp_enabled_at/);
  assert.match(server,/superAdminMfaRequired\(\)&&!u\.mfa_totp_enabled_at/);
  assert.match(server,/MFA_RATE_WINDOW_MS=15\*60\*1000,MFA_RATE_MAX_ATTEMPTS=8/);
  assert.match(server,/super_admin_mfa_failed/);
  assert.match(server,/super_admin_mfa_rate_limited/);
});

test('all portal HTML pages defer CSP to the report-only response header',()=>{
  const files=['../../company-admin/frontend/index.html','../../company-admin/frontend/schoolbus.html','../../super-admin/frontend/index.html'];
  for(const file of files)assert.doesNotMatch(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/http-equiv=["']Content-Security-Policy["']/i);
  const nginx=fs.readFileSync(new URL('../nginx-security-headers.conf.example',import.meta.url),'utf8');
  assert.match(nginx,/Content-Security-Policy-Report-Only/);
  assert.match(nginx,/report-uri \/inviha-api\/api\/security\/csp-report/);
  assert.match(nginx,/Strict-Transport-Security/);
});

test('School Bus migration repair is explicit and schema checks avoid user credentials',()=>{
  const migration=fs.readFileSync(new URL('../migration-school-admin-role.sql',import.meta.url),'utf8');
  const report=fs.readFileSync(new URL('../release1-school-schema-check.sql',import.meta.url),'utf8');
  assert.match(migration,/school_admin/);
  assert.doesNotMatch(migration,/INSERT\s+INTO\s+auth_users|UPDATE\s+auth_users/i);
  assert.doesNotMatch(report.replace(/--.*$/gm,''),/\b(password_hash|email|password|token|secret)\b/i);
  assert.match(report,/accepts_school_admin/);
});

test('CORS configuration keeps exact HTTP(S) origins and drops wildcards or paths',()=>{
  const origins=parseAllowedOrigins('https://track.almasar.qa,https://example.com/path,*,javascript:alert(1),http://localhost:5173/');
  assert.deepEqual([...origins].sort(),['http://localhost:5173','https://track.almasar.qa']);
});

test('production CORS requires explicit exact HTTPS origins without wildcards',()=>{
  const origins=parseAllowedOrigins('https://track.almasar.qa,https://admin.almasar.qa');
  assert.equal(validateProductionOrigins('https://track.almasar.qa,https://admin.almasar.qa',origins),true);
  assert.throws(()=>validateProductionOrigins('',origins),/explicit HTTPS/);
  assert.throws(()=>validateProductionOrigins('https://track.almasar.qa,*',origins),/wildcard/);
  assert.throws(()=>validateProductionOrigins('http://track.almasar.qa',parseAllowedOrigins('http://track.almasar.qa')),/exact HTTPS/);
});

test('API rejects any supplied origin that is not an exact allowed origin',()=>{
  const allowed=parseAllowedOrigins('https://track.almasar.qa,https://admin.almasar.qa');
  assert.equal(originAllowedForApiRequest({headers:{}},allowed),true);
  assert.equal(originAllowedForApiRequest({headers:{origin:'https://track.almasar.qa'}},allowed),true);
  assert.equal(originAllowedForApiRequest({headers:{origin:'https://track.almasar.qa.evil.example'}},allowed),false);
  assert.equal(originAllowedForApiRequest({headers:{origin:'https://evil.example'}},allowed),false);
});

test('fleet and School Bus CORS preflights reach the exact-origin rejection middleware',()=>{
  const fleet=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const school=fs.readFileSync(new URL('../school-server.js',import.meta.url),'utf8');
  for(const source of [fleet,school]){
    assert.match(source,/credentials:true,preflightContinue:true/);
    assert.match(source,/originAllowedForApiRequest\(req,/);
    assert.match(source,/if\(req\.method==='OPTIONS'\)return res\.status\(204\)\.end\(\)/);
    assert.match(source,/status\(403\)\.json\(\{error:'origin_not_allowed'\}\)/);
  }
});

test('login limiter blocks repeated email and IP attempts and expires its window',()=>{
  let time=1000;
  const limiter=createLoginLimiter({windowMs:1000,maxPerAccountAndIp:2,maxPerIp:3,maxEntries:100,now:()=>time});
  const request={ip:'192.0.2.4'};
  limiter.recordFailure(request,'User@example.com');
  limiter.recordFailure(request,'user@example.com');
  assert.equal(limiter.blocked(request,'USER@example.com'),true);
  assert.equal(limiter.blocked(request,'other@example.com'),false);
  time+=1001;
  assert.equal(limiter.blocked(request,'user@example.com'),false);
});

test('successful login clears the account counter but keeps the IP abuse counter',()=>{
  const limiter=createLoginLimiter({maxPerAccountAndIp:2,maxPerIp:2,maxEntries:100});
  const request={ip:'192.0.2.5'};
  limiter.recordFailure(request,'user@example.com');
  limiter.clearFailures(request,'user@example.com');
  assert.equal(limiter.blocked(request,'user@example.com'),false);
  limiter.recordFailure(request,'other@example.com');
  assert.equal(limiter.blocked(request,'another@example.com'),true);
});

test('session lifetime values are finite and capped',()=>{
  assert.equal(sessionDays('14'),14);
  assert.equal(sessionDays('invalid'),7);
  assert.equal(sessionDays('1000'),30);
  assert.equal(sessionDays('-5'),1);
  assert.equal(boundedInteger('not-a-port',3001,1,65535),3001);
  assert.equal(boundedInteger('999999',3001,1,65535),65535);
});

test('API response redaction removes nested credential fields without changing ordinary vehicle data',()=>{
  const result=redactSensitiveData({id:17,name:'Bus 17',metadata:{cameras:[{ftpUser:'camera',ftpPassword:'hidden',url:'https://camera.local/live'}],apiKey:'hidden'},attributes:{ignition:true}});
  assert.deepEqual(result,{id:17,name:'Bus 17',metadata:{cameras:[{url:'https://camera.local/live'}]},attributes:{ignition:true}});
});

test('API response redaction preserves tracker timestamps while removing credentials',()=>{
  const received=new Date('2026-11-27T01:00:00.000Z');
  const result=redactSensitiveData({last_update:received,position_time:received,metadata:{password:'hidden'},invalid_time:new Date('invalid')});
  assert.deepEqual(result,{last_update:'2026-11-27T01:00:00.000Z',position_time:'2026-11-27T01:00:00.000Z',metadata:{},invalid_time:null});
});

test('web sessions use distinct HttpOnly same-site cookies and expire safely',()=>{
  const request={secure:false,headers:{'x-masar-client':'web-company','x-forwarded-proto':'https'}};
  const headers=new Map(),response={getHeader:name=>headers.get(name),setHeader:(name,value)=>headers.set(name,value)};
  assert.equal(setSessionCookie(request,response,'opaque-session'), 'masar_fleet_session');
  const value=headers.get('Set-Cookie')[0];
  assert.match(value,/^masar_fleet_session=opaque-session;/);
  assert.match(value,/HttpOnly/);
  assert.match(value,/SameSite=Lax/);
  assert.match(value,/; Secure/);
  assert.match(value,/Path=\//);
  assert.doesNotMatch(value,/Domain=/i);
  const requestCookies={headers:{'x-masar-client':'web-admin',cookie:'masar_admin_session=admin%2Btoken; masar_fleet_session=fleet'}};
  assert.equal(requestClient(requestCookies),'web-admin');
  assert.equal(sessionCookieName('web-admin'),'masar_admin_session');
  assert.equal(sessionTokenFromRequest(requestCookies),'admin+token');
  assert.equal(requestCookies.authCookieName,'masar_admin_session');
  assert.deepEqual({...parseRequestCookies('a=one%20two; a=ignored; bad')},{a:'one two'});
  assert.equal(isWebClient(requestCookies),true);
  clearSessionCookie(requestCookies,response);
  assert.match(headers.get('Set-Cookie')[1],/^masar_admin_session=;/);
  assert.match(headers.get('Set-Cookie')[1],/Max-Age=0/);
});

test('cookie-v1 browser requests prefer the host-only cookie over a bearer header',()=>{
  const request={headers:{'x-masar-client':'web-admin','x-masar-auth-mode':'cookie-v1',cookie:'masar_admin_session=cookie-session','authorization':'Bearer legacy-session'}};
  assert.equal(usesCookieSession(request),true);
  assert.equal(sessionTokenFromRequest(request),'cookie-session');
  const legacy={headers:{'x-masar-client':'web-admin',cookie:'masar_admin_session=cookie-session','authorization':'Bearer legacy-session'}};
  assert.equal(usesCookieSession(legacy),false);
  assert.equal(sessionTokenFromRequest(legacy),'legacy-session');
});

test('browser session lifetime honors remember-me and same-origin checks protect cookie writes',()=>{
  const web={headers:{'x-masar-client':'web-school'}};
  assert.equal(sessionLifetimeMs(web,false,{days:7,hours:12}),12*3600000);
  assert.equal(sessionLifetimeMs(web,true,{days:7,hours:12}),7*86400000);
  assert.equal(sessionLifetimeMs({headers:{}},false,{days:7,hours:12}),7*86400000);
  const allowed=parseAllowedOrigins('https://track.almasar.qa,http://localhost:5177');
  const sameOrigin={method:'POST',headers:{cookie:'masar_fleet_session=abc',origin:'https://track.almasar.qa','sec-fetch-site':'same-origin'}};
  assert.equal(hasSessionCookie(sameOrigin),true);
  assert.equal(originAllowedForCookieRequest(sameOrigin,allowed),true);
  assert.equal(originAllowedForCookieRequest({...sameOrigin,headers:{...sameOrigin.headers,origin:'https://attacker.invalid','sec-fetch-site':'cross-site'}},allowed),false);
  assert.equal(originAllowedForCookieRequest({...sameOrigin,method:'GET'},allowed),true);
});

test('credential values in error text are redacted before logging',()=>{
  assert.equal(redactSensitiveText('login failed: password=hunter2 authorization=Bearer abcdefghijklmnop'), 'login failed: password=[redacted] authorization=[redacted]');
  assert.equal(redactSensitiveText('{"password_hash":"secret-hash","access_token":"secret-token"}'), '{"password_hash":"[redacted]","access_token":"[redacted]"}');
});

test('web portal source no longer stores or passes bearer sessions through URLs',()=>{
  const companyApi=fs.readFileSync(new URL('../../company-admin/frontend/src/api.js',import.meta.url),'utf8');
  const superApp=fs.readFileSync(new URL('../../super-admin/frontend/src/App.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(companyApi,/localStorage\.setItem\([^\n]*(?:inviha_company_token|inviha_school_token|inviha_super_token)/);
  assert.doesNotMatch(companyApi,/supportToken/);
  assert.doesNotMatch(superApp,/localStorage\.setItem\(AUTH_KEY/);
  assert.doesNotMatch(superApp,/\?supportToken=/);
  assert.match(companyApi,/credentials:'same-origin'/);
  assert.match(superApp,/"X-Masar-Client": "web-admin"/);
});
