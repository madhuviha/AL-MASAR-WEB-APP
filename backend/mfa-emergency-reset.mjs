import {decryptTotpSecret,parseMfaEncryptionKey,verifyTotpCode} from './mfa-totp.mjs';

function fail(code,message){const error=new Error(message);error.code=code;throw error}

// Reset is deliberately CLI-only: a different active, MFA-enrolled Super
// Admin must authorize it with a fresh TOTP code. No recovery secrets or
// passwords are written to the audit record.
export async function emergencyResetSuperAdminMfa(client,{actorUserId,targetUserId,actorCode,encryptionKey,now=Date.now()}){
  const actorId=Number(actorUserId),targetId=Number(targetUserId);
  if(!Number.isSafeInteger(actorId)||actorId<1||!Number.isSafeInteger(targetId)||targetId<1||actorId===targetId)
    fail('mfa_reset_invalid_accounts','Choose two different Super Admin accounts.');
  await client.query('BEGIN');
  try{
    const users=(await client.query(`SELECT id,role,status,mfa_totp_secret_enc,mfa_totp_enabled_at,mfa_totp_last_counter
      FROM auth_users WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`,[[actorId,targetId]])).rows;
    const actor=users.find(user=>Number(user.id)===actorId),target=users.find(user=>Number(user.id)===targetId);
    if(actor?.role!=='super_admin'||actor.status!=='active'||!actor.mfa_totp_enabled_at||!actor.mfa_totp_secret_enc)
      fail('mfa_reset_actor_not_enrolled','The authorizing Super Admin must be active and have MFA enabled.');
    if(target?.role!=='super_admin'||target.status!=='active'||!target.mfa_totp_enabled_at)
      fail('mfa_reset_target_not_enrolled','The target must be an active Super Admin with MFA enabled.');
    const enrolledCount=Number((await client.query(`SELECT COUNT(*)::int AS count FROM auth_users
      WHERE role='super_admin' AND status='active' AND mfa_totp_enabled_at IS NOT NULL AND id<>$1`,[targetId])).rows[0]?.count||0);
    if(enrolledCount<1)fail('mfa_reset_last_factor','Keep another active MFA-enrolled Super Admin available before a reset.');
    const key=Buffer.isBuffer(encryptionKey)?encryptionKey:parseMfaEncryptionKey(encryptionKey);
    if(key.length!==32)fail('mfa_reset_key_invalid','The Super Admin MFA encryption key is not configured correctly.');
    const secret=decryptTotpSecret(actor.mfa_totp_secret_enc,key);
    const counter=verifyTotpCode(secret,actorCode,{now,afterCounter:actor.mfa_totp_last_counter});
    if(counter===null)fail('mfa_reset_actor_verification_failed','The second Super Admin authenticator code is invalid or already used.');

    await client.query('UPDATE auth_users SET mfa_totp_last_counter=$1 WHERE id=$2',[counter,actorId]);
    const cleared=await client.query(`UPDATE auth_users SET mfa_totp_secret_enc=NULL,mfa_totp_enabled_at=NULL,
      mfa_totp_pending_secret_enc=NULL,mfa_totp_pending_expires_at=NULL,mfa_totp_last_counter=NULL,
      mfa_recovery_codes='[]'::jsonb WHERE id=$1 AND role='super_admin' AND status='active'`,[targetId]);
    if(!cleared.rowCount)fail('mfa_reset_target_changed','The target account changed during the reset.');
    await client.query('DELETE FROM auth_mfa_challenges WHERE user_id=$1',[targetId]);
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[targetId]);
    await client.query(`INSERT INTO audit_events(user_id,action,entity_type,entity_id,detail)
      VALUES($1,'super_admin_mfa_emergency_reset','auth_user',$2,$3::jsonb)`,
      [actorId,String(targetId),JSON.stringify({method:'second_super_admin_totp',targetMustReenroll:true})]);
    await client.query('COMMIT');
    return {actorUserId:actorId,targetUserId:targetId,reset:true};
  }catch(error){try{await client.query('ROLLBACK')}catch{};throw error}
}
