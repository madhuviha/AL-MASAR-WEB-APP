import dotenv from 'dotenv';
import pg from 'pg';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {emergencyResetSuperAdminMfa} from './mfa-emergency-reset.mjs';

dotenv.config({path:fileURLToPath(new URL('./.env',import.meta.url))});
const {Pool}=pg;

function prompt(label){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  return new Promise(resolve=>rl.question(label,value=>{rl.close();resolve(value.trim())}));
}
function promptHidden(label){
  const input=process.stdin;
  if(!input.isTTY||typeof input.setRawMode!=='function')return Promise.reject(new Error('Run this procedure in an interactive terminal so the authenticator code is not echoed.'));
  return new Promise((resolve,reject)=>{
    let value='';
    const wasRaw=input.isRaw;
    const finish=(error)=>{input.off('data',onData);input.setRawMode(wasRaw);input.pause();process.stdout.write('\n');error?reject(error):resolve(value)};
    const onData=chunk=>{
      for(const char of String(chunk)){
        if(char==='\u0003')return finish(new Error('Cancelled.'));
        if(char==='\r'||char==='\n')return finish();
        if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue}
        if(char>=' '&&char<='~')value+=char;
      }
    };
    process.stdout.write(label);input.setRawMode(true);input.resume();input.on('data',onData);
  });
}

const databaseUrl=String(process.env.DATABASE_URL||'').trim();
if(!databaseUrl){console.error('DATABASE_URL is not configured. No reset was performed.');process.exit(2)}
const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'masar-super-admin-mfa-reset'});
let client;
try{
  console.info('Emergency MFA reset requires a different, active Super Admin with MFA enabled.');
  const actorUserId=Number(await prompt('Authorizing Super Admin user ID: '));
  const targetUserId=Number(await prompt('Super Admin user ID to reset: '));
  if(String(await prompt(`Type RESET MFA FOR USER ${targetUserId} to continue: `))!==`RESET MFA FOR USER ${targetUserId}`){console.info('Cancelled. No reset was performed.');process.exitCode=1}
  else{
    const actorCode=await promptHidden('Authorizing Super Admin current authenticator code (input hidden): ');
    const encryptionKey=String(process.env.SUPER_ADMIN_MFA_ENCRYPTION_KEY||'');
    client=await pool.connect();
    const result=await emergencyResetSuperAdminMfa(client,{actorUserId,targetUserId,actorCode,encryptionKey});
    console.info(`MFA reset completed for Super Admin user ${result.targetUserId}; they must enroll again. The action was audit logged.`);
  }
}catch(error){
  const code=String(error?.code||'');
  console.error(code.startsWith('mfa_reset_')?error.message:`MFA reset failed${code?` (${code})`:''}. No secret values were printed.`);
  process.exitCode=1;
}finally{client?.release();await pool.end()}
