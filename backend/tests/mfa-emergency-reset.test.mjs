import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptTotpSecret,totpCodeAtCounter} from '../mfa-totp.mjs';
import {emergencyResetSuperAdminMfa} from '../mfa-emergency-reset.mjs';

function resetDb({actorCodeValid=true,enrolledCount=1}={}){
  const key=Buffer.alloc(32,19),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',now=1_700_000_000_000;
  const counter=Math.floor(now/1000/30),actorCode=totpCodeAtCounter(secret,counter);
  const users=[
    {id:2,role:'super_admin',status:'active',mfa_totp_secret_enc:encryptTotpSecret(secret,key),mfa_totp_enabled_at:new Date(now-1000),mfa_totp_last_counter:null},
    {id:7,role:'super_admin',status:'active',mfa_totp_secret_enc:'encrypted-target-secret',mfa_totp_enabled_at:new Date(now-1000),mfa_totp_last_counter:counter-1}
  ];
  const calls=[];
  const client={async query(sql,params=[]){
    calls.push({sql:String(sql),params});
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
    if(String(sql).includes('FROM auth_users WHERE id=ANY'))return {rowCount:users.length,rows:users};
    if(String(sql).includes('COUNT(*)::int AS count'))return {rowCount:1,rows:[{count:enrolledCount}]};
    if(String(sql).includes("UPDATE auth_users SET mfa_totp_last_counter"))return {rowCount:1,rows:[]};
    if(String(sql).includes("UPDATE auth_users SET mfa_totp_secret_enc=NULL"))return {rowCount:1,rows:[]};
    return {rowCount:1,rows:[]};
  }};
  return {client,key,secret,now,actorCode:actorCodeValid?actorCode:'000000',calls};
}

test('emergency reset requires a different enrolled Super Admin and removes sessions/factors atomically',async()=>{
  const db=resetDb();
  const result=await emergencyResetSuperAdminMfa(db.client,{actorUserId:2,targetUserId:7,actorCode:db.actorCode,encryptionKey:db.key,now:db.now});
  assert.deepEqual(result,{actorUserId:2,targetUserId:7,reset:true});
  const queries=db.calls.map(call=>call.sql).join('\n');
  assert.match(queries,/DELETE FROM auth_mfa_challenges WHERE user_id=\$1/);
  assert.match(queries,/DELETE FROM auth_sessions WHERE user_id=\$1/);
  assert.match(queries,/super_admin_mfa_emergency_reset/);
  assert.deepEqual(db.calls.filter(call=>call.sql==='COMMIT').length,1);
  assert.equal(db.calls.some(call=>call.sql==='ROLLBACK'),false);
  const audit=db.calls.find(call=>call.sql.includes('super_admin_mfa_emergency_reset'));
  assert.doesNotMatch(JSON.stringify(audit.params),new RegExp(db.actorCode));
  assert.doesNotMatch(JSON.stringify(audit.params),/GEZDGNBVGY3TQOJ/);
});

test('emergency reset refuses to remove the last active MFA factor',async()=>{
  const db=resetDb({enrolledCount:0});
  await assert.rejects(emergencyResetSuperAdminMfa(db.client,{actorUserId:2,targetUserId:7,actorCode:db.actorCode,encryptionKey:db.key,now:db.now}),{code:'mfa_reset_last_factor'});
  assert.equal(db.calls.some(call=>call.sql.startsWith('UPDATE auth_users SET mfa_totp_secret_enc=NULL')),false);
  assert.equal(db.calls.at(-1).sql,'ROLLBACK');
});

test('emergency reset refuses invalid or reused authenticator codes',async()=>{
  const db=resetDb({actorCodeValid:false});
  await assert.rejects(emergencyResetSuperAdminMfa(db.client,{actorUserId:2,targetUserId:7,actorCode:db.actorCode,encryptionKey:db.key,now:db.now}),{code:'mfa_reset_actor_verification_failed'});
  assert.equal(db.calls.some(call=>call.sql.startsWith('UPDATE auth_users SET mfa_totp_secret_enc=NULL')),false);
  assert.equal(db.calls.at(-1).sql,'ROLLBACK');
});
