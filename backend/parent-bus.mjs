import crypto from 'node:crypto';
import {enqueueUserPushes} from './mobile-push.mjs';
import {oneWireIdentifierAliases,normalizeIdentifier as normalizeTrackerIdentifier} from './driver-identity.mjs';

const clean=value=>String(value??'').trim();
const normalizeId=value=>clean(value).toUpperCase().replace(/\s+/g,'');
const numberId=value=>{const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null};
export function hasSchoolModuleAccess(user){
  return user?.role==='super_admin'||(user?.role==='school_admin'&&user?.metadata?.schoolAdmin===true);
}
const isAdmin=user=>user?.role==='super_admin'||(user?.role==='school_admin'&&hasSchoolModuleAccess(user));
const isParent=user=>user?.role==='parent'&&user?.metadata?.schoolParent===true;

export function normalizeIdentifier(value){return normalizeId(value);}
export function deriveEventType(lastEventType){return lastEventType==='boarded'?'alighted':'boarded';}
export function buildDedupeKey({childId,vehicleId,eventType,scannedAt,scanId}={}){
  const explicit=clean(scanId);
  if(explicit)return `scan:${explicit}`;
  const time=Date.parse(scannedAt||'');
  const minute=Number.isFinite(time)?Math.floor(time/60000):Math.floor(Date.now()/60000);
  // A reader retry can be interpreted as the opposite alternating event when
  // it arrives immediately after the first scan. Keep the time-window key
  // independent of event type so the retry cannot create a false drop-off.
  return `auto:${childId}:${vehicleId}:${minute}`;
}
export function schoolPushContent({childName,eventType,vehicleName,scannedAt}={}){
  const name=clean(childName)||'Your child';
  const vehicle=clean(vehicleName)||'the assigned bus';
  const time=Date.parse(scannedAt||'');
  const when=Number.isFinite(time)?new Intl.DateTimeFormat('en-GB',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Qatar'}).format(new Date(time)):'';
  const verb=eventType==='alighted'?'got off':'boarded';
  return {
    title:`${name} ${eventType==='alighted'?'arrived':'boarded'}`.slice(0,160),
    body:`${name} ${verb} ${vehicle}${when?` at ${when}`:''}.`.slice(0,500),
    eventType:`school_${eventType}`,
    channelId:'masar_school_v1'
  };
}

async function recordSchoolScan(db,{child,companyId,vehicleId,rfidIdentifier,scannedAt,eventType=null,scanId=null,source='rfid',metadata={}}={}){
  const last=(await db.query('SELECT event_type FROM school_scan_events WHERE child_id=$1 AND vehicle_id=$2 ORDER BY scanned_at DESC,id DESC LIMIT 1',[child.id,vehicleId])).rows[0];
  const nextEventType=clean(eventType).toLowerCase()||deriveEventType(last?.event_type);
  if(!['boarded','alighted'].includes(nextEventType))throw Error('event_type_must_be_boarded_or_alighted');
  const dedupeKey=buildDedupeKey({childId:child.id,vehicleId,eventType:nextEventType,scannedAt,scanId});
  const inserted=await db.query(`INSERT INTO school_scan_events(company_id,child_id,vehicle_id,event_type,rfid_identifier,scanned_at,source,dedupe_key,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(dedupe_key) DO NOTHING
    RETURNING id,company_id AS "companyId",child_id AS "childId",vehicle_id AS "vehicleId",event_type AS "eventType",rfid_identifier AS "rfidIdentifier",scanned_at AS "scannedAt",source`,
    [companyId,child.id,vehicleId,nextEventType,normalizeId(rfidIdentifier)||clean(rfidIdentifier),scannedAt,source,dedupeKey,JSON.stringify(metadata&&typeof metadata==='object'?metadata:{})]);
  if(!inserted.rows[0]){
    const existing=(await db.query('SELECT id,company_id AS "companyId",child_id AS "childId",vehicle_id AS "vehicleId",event_type AS "eventType",rfid_identifier AS "rfidIdentifier",scanned_at AS "scannedAt",source FROM school_scan_events WHERE dedupe_key=$1',[dedupeKey])).rows[0];
    return {duplicate:true,event:existing||null,push:{queued:0}};
  }
  const event=inserted.rows[0],parents=(await db.query(`SELECT cp.parent_user_id
    FROM school_child_parents cp JOIN auth_users u ON u.id=cp.parent_user_id
    WHERE cp.child_id=$1
      AND COALESCE(u.metadata->'notificationPreferences'->>'enabled','true')<>'false'
      AND (($2='boarded' AND COALESCE(u.metadata->'notificationPreferences'->>'boarding','true')<>'false')
        OR ($2='alighted' AND COALESCE(u.metadata->'notificationPreferences'->>'dropoff','true')<>'false'))`,[child.id,nextEventType])).rows.map(row=>row.parent_user_id);
  const content=schoolPushContent({childName:child.name,eventType:nextEventType,vehicleName:child.vehicle_name||child.vehicleName,scannedAt});
  const push=await enqueueUserPushes(db,{userIds:parents,companyId,alertId:`school:${event.id}`,semanticKey:`school:${child.id}:${event.id}`,payload:{...content,childId:String(child.id),vehicleId:String(vehicleId),scanId:String(event.id)}});
  return {duplicate:false,event,push};
}

async function assertSchoolCardAvailable(db,companyId,rfidIdentifier,excludeChildId=null){
  const aliases=oneWireIdentifierAliases(rfidIdentifier);if(!aliases.length)return;
  await db.query('SELECT pg_advisory_xact_lock(728104,$1::int)',[companyId]);
  const children=(await db.query(`SELECT id,rfid_identifier FROM school_children
    WHERE company_id=$1 AND rfid_identifier IS NOT NULL AND ($2::bigint IS NULL OR id<>$2)`,[companyId,excludeChildId])).rows;
  const requested=new Set(aliases);
  if(children.some(row=>oneWireIdentifierAliases(row.rfid_identifier).some(alias=>requested.has(alias))))throw Error('rfid_already_assigned');
}

function scanAttributes(position){
  let attributes=position?.attributes||{};
  if(typeof attributes==='string'){try{attributes=JSON.parse(attributes)}catch{attributes={}}}
  return attributes&&typeof attributes==='object'?attributes:{};
}
const scanKeys=['driverUniqueId','iButton','ibutton','iButtonId','rfid','oneWire','1wire'];
const rememberedKeys=['lastKnownDriverUniqueId','driverIdentifier','driver_id','driverId','driverID'];
function trackerReaderIdentifier(position){
  const attributes=scanAttributes(position);
  for(const key of scanKeys){const value=attributes[key];if(value!==undefined&&value!==null&&String(value).trim())return {value,key,isScan:true};}
  for(const key of rememberedKeys){const value=attributes[key];if(value!==undefined&&value!==null&&String(value).trim())return {value,key,isScan:false};}
  return null;
}

async function logSchoolScanIssue(db,{companyId,vehicle,identifier,position,reason}={}){
  try{await db.query(`INSERT INTO diagnostic_events(level,source,event_type,message,company_id,vehicle_id,protocol,detail)
    VALUES('warning','school-rfid','school_rfid_ignored',$1,$2,$3,$4,$5::jsonb)`,[
      `Child RFID scan was not recorded (${reason}).`,companyId,vehicle.id,vehicle.protocol||null,
      JSON.stringify({reason,rfidIdentifier:normalizeTrackerIdentifier(identifier)||String(identifier||''),positionId:position?.id??null})
    ])}catch(error){console.error('School RFID diagnostic could not be recorded:',error.message)}
}

/** Classify the shared Teltonika iButton/1-Wire identity channel against child cards. */
export async function processTrackerChildRfid(db,vehicle,position,registeredCards=[]){
  const scanned=trackerReaderIdentifier(position);if(!scanned)return {handled:false};
  const normalized=normalizeTrackerIdentifier(scanned.value);if(!normalized)return {handled:false};
  const aliases=oneWireIdentifierAliases(scanned.value);if(!aliases.length)return {handled:false};
  const companyId=numberId(vehicle?.company_id),vehicleId=numberId(vehicle?.id);if(!companyId||!vehicleId)return {handled:false};
  const matches=(await db.query(`SELECT c.id,c.company_id,c.name,c.rfid_identifier,c.active,c.metadata,
      a.vehicle_id,v.name AS vehicle_name,a.active AS assignment_active
    FROM school_children c
    LEFT JOIN school_bus_assignments a ON a.child_id=c.id
    LEFT JOIN vehicles v ON v.id=a.vehicle_id
    WHERE c.company_id=$1 AND upper(regexp_replace(c.rfid_identifier,'[[:space:]]','','g'))=ANY($2::text[])`,[companyId,aliases])).rows;
  if(!matches.length){
    const registered=(Array.isArray(registeredCards)?registeredCards:[]).some(card=>String(card.companyId??companyId)===String(companyId)&&oneWireIdentifierAliases(card.tagNumber||card.rfidIdentifier).some(alias=>aliases.includes(alias)));
    if(!registered)return {handled:false};
    if(scanned.isScan)await logSchoolScanIssue(db,{companyId,vehicle,identifier:scanned.value,position,reason:'rfid_card_not_assigned_to_child'});
    return {handled:true,reason:'rfid_card_not_assigned_to_child'};
  }
  if(matches.length!==1){await logSchoolScanIssue(db,{companyId,vehicle,identifier:scanned.value,position,reason:'ambiguous_child_card'});return {handled:true,reason:'ambiguous_child_card'};}
  const child=matches[0];
  if(!child.active||['disabled','lost','inactive'].includes(String(child.metadata?.rfidStatus||'Active').toLowerCase())){
    await logSchoolScanIssue(db,{companyId,vehicle,identifier:scanned.value,position,reason:'card_inactive'});return {handled:true,reason:'card_inactive'};
  }
  if(!child.assignment_active||!child.vehicle_id){await logSchoolScanIssue(db,{companyId,vehicle,identifier:scanned.value,position,reason:'child_bus_not_assigned'});return {handled:true,reason:'child_bus_not_assigned'};}
  if(String(child.vehicle_id)!==String(vehicleId)){await logSchoolScanIssue(db,{companyId,vehicle,identifier:scanned.value,position,reason:'child_assigned_to_another_bus'});return {handled:true,reason:'child_assigned_to_another_bus'};}
  if(!scanned.isScan)return {handled:true,remembered:true,childId:child.id};
  // Prefer Traccar's server-received timestamp. If it is missing/invalid, use this
  // backend's clock; deviceTime/fixTime can be offset and should not set scan time.
  const rawTime=position.serverTime||'';
  const receivedAt=Date.parse(rawTime);
  const now=Date.now();
  const time=Number.isFinite(receivedAt)&&receivedAt<=now+60000?receivedAt:now;
   const recent=(await db.query(`SELECT id FROM school_scan_events WHERE company_id=$1 AND child_id=$2 AND vehicle_id=$3
    AND source='teltonika-1wire' AND scanned_at BETWEEN $4::timestamptz-INTERVAL '15 seconds' AND $4::timestamptz+INTERVAL '15 seconds' ORDER BY scanned_at DESC,id DESC LIMIT 1`,[companyId,child.id,vehicleId,new Date(time).toISOString()])).rows[0];
  if(recent)return {handled:true,childId:child.id,duplicate:true,event:null,push:{queued:0}};
  const positionId=position.id==null?crypto.createHash('sha256').update(JSON.stringify([position.deviceId,rawTime,normalized])).digest('hex'):String(position.id);
  const result=await recordSchoolScan(db,{child,companyId,vehicleId,rfidIdentifier:normalized,scannedAt:new Date(time).toISOString(),scanId:`traccar:${position.deviceId||vehicle.traccar_device_id}:${positionId}`,source:'teltonika-1wire',metadata:{readerField:scanned.key,positionId,deviceId:String(position.deviceId||vehicle.traccar_device_id),timestampSource:Number.isFinite(receivedAt)&&receivedAt<=now+60000?'traccar_server':'backend_server',serverTime:position.serverTime||null,deviceTime:position.deviceTime||null,fixTime:position.fixTime||null}});
  return {handled:true,childId:child.id,...result};
}

const hashPassword=(password,salt=crypto.randomBytes(16).toString('hex'))=>{
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');
  return `${salt}:${hash}`;
};

function companyIdFor(user,requested){
  if(user?.role==='super_admin')return numberId(requested);
  return numberId(user?.company_id);
}

function requireSchoolAdmin(req,res,next){return isAdmin(req.user)?next():res.status(403).json({error:'school_administrator_required'});}
function requireParentOrAdmin(req,res,next){return isParent(req.user)||isAdmin(req.user)?next():res.status(403).json({error:'parent_or_administrator_required'});}

export async function initializeParentBus(app,{pool,requireAuth,readLiveSnapshots}){
  const getMobile=(path,...handlers)=>{app.get(`/api${path}`,...handlers);app.get(path,...handlers)};
  getMobile('/school/children',requireAuth,requireParentOrAdmin,async(req,res)=>{
    try{
      const companyId=companyIdFor(req.user,req.query.companyId);
      if(!companyId)return res.status(400).json({error:'company_id_required'});
      const parentClause=isParent(req.user)?'AND EXISTS (SELECT 1 FROM school_child_parents cp WHERE cp.child_id=c.id AND cp.parent_user_id=$2)':'';
      const params=isParent(req.user)?[companyId,req.user.id]:[companyId];
      const {rows}=await pool.query(`
        SELECT c.id,c.company_id AS "companyId",c.name,c.grade,c.class_name AS "className",
               c.rfid_identifier AS "rfidIdentifier",c.active,c.metadata,
               a.vehicle_id AS "vehicleId",a.home_stop AS "homeStop",a.school_name AS "schoolName",
               v.name AS "vehicleName",v.plate_number AS "plateNumber",
               v.metadata->>'driverName' AS "driverName",
               v.metadata->>'driverQid' AS "driverQid",
               v.metadata->>'driverMobile' AS "driverMobile",
               se.event_type AS "lastEventType",se.scanned_at AS "lastScannedAt"
        FROM school_children c
        LEFT JOIN school_bus_assignments a ON a.child_id=c.id AND a.active=TRUE
        LEFT JOIN vehicles v ON v.id=a.vehicle_id
        LEFT JOIN LATERAL (SELECT event_type,scanned_at FROM school_scan_events WHERE child_id=c.id ORDER BY scanned_at DESC,id DESC LIMIT 1) se ON TRUE
        WHERE c.company_id=$1 ${parentClause} AND c.active=TRUE ORDER BY c.name`,params);
      res.set('Cache-Control','private,no-store').json(rows);
    }catch(error){console.error('School children failed:',error.message);res.status(503).json({error:'school_children_unavailable'});}
  });

  getMobile('/school/children/:id/bus-location',requireAuth,requireParentOrAdmin,async(req,res)=>{
    const childId=numberId(req.params.id),companyId=companyIdFor(req.user,req.query.companyId);
    if(!childId||!companyId)return res.status(400).json({error:'company_and_child_required'});
    try{
      const parentClause=isParent(req.user)?'AND EXISTS (SELECT 1 FROM school_child_parents cp WHERE cp.child_id=c.id AND cp.parent_user_id=$3)':'';
      const params=isParent(req.user)?[childId,companyId,req.user.id]:[childId,companyId];
      const child=(await pool.query(`SELECT c.id AS "childId",c.name AS "childName",v.id AS "vehicleId",v.name AS "vehicleName",
          v.traccar_device_id AS "deviceId",v.plate_number AS "plateNumber"
        FROM school_children c
        JOIN school_bus_assignments a ON a.child_id=c.id AND a.active=TRUE
        JOIN vehicles v ON v.id=a.vehicle_id AND v.company_id=c.company_id AND v.active<>FALSE
        WHERE c.id=$1 AND c.company_id=$2 AND c.active=TRUE ${parentClause} LIMIT 1`,params)).rows[0];
      if(!child)return res.status(404).json({error:'child_or_assigned_bus_not_found'});
      if(!child.deviceId||typeof readLiveSnapshots!=='function')return res.set('Cache-Control','private,no-store').json({childId:child.childId,vehicle:{id:child.vehicleId,name:child.vehicleName,plateNumber:child.plateNumber},gpsAvailable:false,latitude:null,longitude:null,gpsUpdatedAt:null,packetReceivedAt:null});
      const snapshot=await readLiveSnapshots(),position=snapshot?.rows?.find(item=>String(item.id)===String(child.deviceId));
      const latitude=Number(position?.latitude),longitude=Number(position?.longitude);
      const gpsAvailable=Boolean(position&&position.valid!==false&&position.latitude!=null&&position.longitude!=null&&Number.isFinite(latitude)&&Number.isFinite(longitude));
      const gpsUpdatedAt=position?.fixTime||position?.fixtime||position?.serverTime||position?.servertime||position?.lastupdate||position?.lastUpdate||null;
      const packetReceivedAt=position?.lastupdate||position?.lastUpdate||position?.serverTime||position?.servertime||null;
      res.set('Cache-Control','private,no-store').json({childId:child.childId,vehicle:{id:child.vehicleId,name:child.vehicleName,plateNumber:child.plateNumber},gpsAvailable,latitude:gpsAvailable?latitude:null,longitude:gpsAvailable?longitude:null,gpsUpdatedAt,packetReceivedAt,source:snapshot?.source||null});
    }catch(error){console.error('Parent bus location failed:',error.message);res.status(503).json({error:'parent_bus_location_unavailable'});}
  });

  app.post('/api/school/children',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId);
    const name=clean(req.body?.name),rfidIdentifier=normalizeId(req.body?.rfidIdentifier);
    if(!companyId||!name)return res.status(400).json({error:'company_id_and_child_name_required'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(rfidIdentifier)await assertSchoolCardAvailable(client,companyId,rfidIdentifier);
      const {rows}=await client.query(`INSERT INTO school_children(company_id,name,grade,class_name,rfid_identifier,metadata)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,company_id AS "companyId",name,grade,class_name AS "className",rfid_identifier AS "rfidIdentifier",active,metadata`,
        [companyId,name,clean(req.body?.grade)||null,clean(req.body?.className)||null,rfidIdentifier||null,JSON.stringify(req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{})]);
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    }catch(error){try{await client.query('ROLLBACK')}catch{};const conflict=error.code==='23505'||error.message==='rfid_already_assigned';res.status(conflict?409:500).json({error:conflict?'rfid_already_assigned':'school_child_create_failed'});}finally{client.release();}
  });

  app.put('/api/school/children/:id',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId);if(!companyId)return res.status(400).json({error:'company_id_required'});
    const name=clean(req.body?.name);if(!name)return res.status(400).json({error:'child_name_required'});
    const rfidIdentifier=normalizeId(req.body?.rfidIdentifier)||null,childId=numberId(req.params.id),client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(rfidIdentifier)await assertSchoolCardAvailable(client,companyId,rfidIdentifier,childId);
      const {rows}=await client.query(`UPDATE school_children SET name=$1,grade=$2,class_name=$3,rfid_identifier=$4,active=$5,metadata=$6::jsonb,updated_at=NOW()
        WHERE id=$7 AND company_id=$8 RETURNING id,company_id AS "companyId",name,grade,class_name AS "className",rfid_identifier AS "rfidIdentifier",active,metadata`,
        [name,clean(req.body?.grade)||null,clean(req.body?.className)||null,rfidIdentifier,req.body?.active!==false,JSON.stringify(req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{}),childId,companyId]);
      if(!rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'school_child_not_found'});}
      await client.query('COMMIT');res.json(rows[0]);
    }catch(error){try{await client.query('ROLLBACK')}catch{};const conflict=error.code==='23505'||error.message==='rfid_already_assigned';res.status(conflict?409:500).json({error:conflict?'rfid_already_assigned':'school_child_update_failed'});}finally{client.release();}
  });

  app.delete('/api/school/children/:id',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),childId=numberId(req.params.id);
    if(!companyId||!childId)return res.status(400).json({error:'company_and_child_required'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(728104,$1::int)',[companyId]);
      const deleted=await client.query(`UPDATE school_children SET active=FALSE,rfid_identifier=NULL,
        metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('deletedAt',NOW(),'deletedBy',$1),updated_at=NOW()
        WHERE id=$2 AND company_id=$3 AND active=TRUE RETURNING id`,[req.user.id,childId,companyId]);
      if(!deleted.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'school_child_not_found'});}
      await client.query('UPDATE school_bus_assignments SET active=FALSE,updated_at=NOW() WHERE child_id=$1',[childId]);
      await client.query('DELETE FROM school_child_parents WHERE child_id=$1',[childId]);
      await client.query('COMMIT');res.json({ok:true,id:childId});
    }catch(error){try{await client.query('ROLLBACK')}catch{};console.error('School child delete failed:',error.message);res.status(500).json({error:'school_child_delete_failed'});}finally{client.release();}
  });

  app.put('/api/school/children/:id/assignment',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),childId=numberId(req.params.id),vehicleId=numberId(req.body?.vehicleId);
    if(!companyId||!childId||!vehicleId)return res.status(400).json({error:'company_child_and_vehicle_required'});
    try{
      const child=(await pool.query('SELECT id FROM school_children WHERE id=$1 AND company_id=$2',[childId,companyId])).rows[0];
      const vehicle=(await pool.query(`SELECT id,name,plate_number,
        metadata->>'driverName' AS "driverName",
        metadata->>'driverQid' AS "driverQid",
        metadata->>'driverMobile' AS "driverMobile"
        FROM vehicles WHERE id=$1 AND company_id=$2 AND active<>FALSE`,[vehicleId,companyId])).rows[0];
      if(!child||!vehicle)return res.status(404).json({error:'child_or_vehicle_not_found'});
      const {rows}=await pool.query(`INSERT INTO school_bus_assignments(child_id,vehicle_id,home_stop,school_name,active)
        VALUES($1,$2,$3,$4,TRUE) ON CONFLICT(child_id) DO UPDATE SET vehicle_id=EXCLUDED.vehicle_id,home_stop=EXCLUDED.home_stop,school_name=EXCLUDED.school_name,active=TRUE,updated_at=NOW()
        RETURNING child_id AS "childId",vehicle_id AS "vehicleId",home_stop AS "homeStop",school_name AS "schoolName",active`,
        [childId,vehicleId,clean(req.body?.homeStop)||null,clean(req.body?.schoolName)||null]);
      res.json({...rows[0],vehicleName:vehicle.name,plateNumber:vehicle.plate_number,driverName:vehicle.driverName||'',driverQid:vehicle.driverQid||'',driverMobile:vehicle.driverMobile||''});
    }catch{res.status(500).json({error:'school_assignment_failed'});}
  });

  app.post('/api/school/parents',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),name=clean(req.body?.name),email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
    const childIds=[...new Set((Array.isArray(req.body?.childIds)?req.body.childIds:[]).map(numberId).filter(Boolean))];
    const requestedPreferences=req.body?.notificationPreferences&&typeof req.body.notificationPreferences==='object'?req.body.notificationPreferences:{};
    const notificationPreferences={enabled:requestedPreferences.enabled!==false,boarding:requestedPreferences.boarding!==false,dropoff:requestedPreferences.dropoff!==false};
    if(!companyId||!name||!email.includes('@')||!/^[A-Za-z0-9]{4,}$/.test(password)||!childIds.length)return res.status(400).json({error:'company_name_email_password_and_child_ids_required'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const children=await client.query('SELECT id FROM school_children WHERE company_id=$1 AND id=ANY($2::bigint[]) FOR UPDATE',[companyId,childIds]);
      if(children.rowCount!==childIds.length){await client.query('ROLLBACK');return res.status(404).json({error:'school_child_not_found'});}
      const user=(await client.query(`INSERT INTO auth_users(company_id,name,email,password_hash,role,status,metadata)
        VALUES($1,$2,$3,$4,'parent','active',$5::jsonb) RETURNING id,company_id AS "companyId",name,email,role,status`,[companyId,name,email,hashPassword(password),JSON.stringify({schoolParent:true,notificationPreferences})])).rows[0];
      await client.query("INSERT INTO auth_user_app_roles(user_id,app_role,granted_by) VALUES($1,'parent',$2) ON CONFLICT(user_id,app_role) DO NOTHING",[user.id,req.user.id]);
      for(const childId of childIds)await client.query('INSERT INTO school_child_parents(child_id,parent_user_id) VALUES($1,$2)',[childId,user.id]);
      await client.query("INSERT INTO audit_events(company_id,user_id,action,entity_type,entity_id,detail) VALUES($1,$2,'school_parent_created','auth_user',$3,$4::jsonb)",[companyId,req.user.id,String(user.id),JSON.stringify({accountRole:'parent',grantedAppRoles:['parent'],linkedChildCount:childIds.length})]);
      await client.query('COMMIT');res.status(201).json({...user,childIds});
    }catch(error){try{await client.query('ROLLBACK')}catch{};res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'email_already_registered':'school_parent_create_failed'});}finally{client.release();}
  });

  app.get('/api/school/parents',requireAuth,requireSchoolAdmin,async(req,res)=>{
    try{
      const companyId=companyIdFor(req.user,req.query.companyId);if(!companyId)return res.status(400).json({error:'company_id_required'});
      const {rows}=await pool.query(`SELECT u.id,u.company_id AS "companyId",u.name,u.email,u.status,u.metadata,
        u.metadata->'notificationPreferences' AS "notificationPreferences",
        COALESCE(jsonb_agg(jsonb_build_object('childId',c.id,'childName',c.name) ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) AS children,
        COALESCE(array_agg(c.id ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL),ARRAY[]::bigint[]) AS "childIds"
        FROM auth_users u LEFT JOIN school_child_parents cp ON cp.parent_user_id=u.id LEFT JOIN school_children c ON c.id=cp.child_id
        WHERE u.company_id=$1 AND u.metadata->>'schoolParent'='true' AND (u.role='parent' OR EXISTS (SELECT 1 FROM auth_user_app_roles ar WHERE ar.user_id=u.id AND ar.app_role='parent')) AND COALESCE(u.metadata->>'deleted','false')<>'true'
        GROUP BY u.id ORDER BY u.name`,[companyId]);
      res.set('Cache-Control','private,no-store').json(rows);
    }catch(error){res.status(503).json({error:'school_parents_unavailable'});}
  });

  app.put('/api/school/parents/:id',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),parentId=numberId(req.params.id),name=clean(req.body?.name),email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||'');
    const childIds=[...new Set((Array.isArray(req.body?.childIds)?req.body.childIds:[]).map(numberId).filter(Boolean))];
    const requestedPreferences=req.body?.notificationPreferences&&typeof req.body.notificationPreferences==='object'?req.body.notificationPreferences:{};
    const notificationPreferences={enabled:requestedPreferences.enabled!==false,boarding:requestedPreferences.boarding!==false,dropoff:requestedPreferences.dropoff!==false};
    if(!companyId||!parentId||!name||!email.includes('@')||!childIds.length||(password&&!/^[A-Za-z0-9]{4,}$/.test(password)))return res.status(400).json({error:'parent_name_email_and_child_ids_required'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const parent=await client.query(`SELECT id FROM auth_users WHERE id=$1 AND company_id=$2 AND metadata->>'schoolParent'='true' AND (role='parent' OR EXISTS (SELECT 1 FROM auth_user_app_roles ar WHERE ar.user_id=auth_users.id AND ar.app_role='parent')) AND COALESCE(metadata->>'deleted','false')<>'true' FOR UPDATE`,[parentId,companyId]);
      if(!parent.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'school_parent_not_found'});}
      const linked=await client.query('SELECT id FROM school_children WHERE company_id=$1 AND id=ANY($2::bigint[]) FOR UPDATE',[companyId,childIds]);
      if(linked.rowCount!==childIds.length){await client.query('ROLLBACK');return res.status(404).json({error:'school_child_not_found'});}
      const user=(await client.query(`UPDATE auth_users SET name=$1,email=$2,password_hash=COALESCE($3,password_hash),metadata=COALESCE(metadata,'{}'::jsonb)||$4::jsonb,updated_at=NOW()
        WHERE id=$5 AND company_id=$6 AND metadata->>'schoolParent'='true' AND (role='parent' OR EXISTS (SELECT 1 FROM auth_user_app_roles ar WHERE ar.user_id=auth_users.id AND ar.app_role='parent')) RETURNING id,company_id AS "companyId",name,email,role,status,metadata`,[name,email,password?hashPassword(password):null,JSON.stringify({schoolParent:true,notificationPreferences}),parentId,companyId])).rows[0];
      await client.query('DELETE FROM school_child_parents WHERE parent_user_id=$1',[parentId]);
      for(const childId of childIds)await client.query('INSERT INTO school_child_parents(child_id,parent_user_id) VALUES($1,$2)',[childId,parentId]);
      if(password)await client.query('DELETE FROM school_portal_sessions WHERE user_id=$1',[parentId]);
      await client.query('COMMIT');res.json({...user,childIds,notificationPreferences});
    }catch(error){try{await client.query('ROLLBACK')}catch{};res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'email_already_registered':'school_parent_update_failed'});}finally{client.release();}
  });

  app.delete('/api/school/parents/:id',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),parentId=numberId(req.params.id);
    if(!companyId||!parentId)return res.status(400).json({error:'company_and_parent_required'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const target=(await client.query(`SELECT id,role FROM auth_users WHERE id=$1 AND company_id=$2 AND metadata->>'schoolParent'='true' AND COALESCE(metadata->>'deleted','false')<>'true'
        AND (role='parent' OR EXISTS (SELECT 1 FROM auth_user_app_roles ar WHERE ar.user_id=auth_users.id AND ar.app_role='parent')) FOR UPDATE`,[parentId,companyId])).rows[0];
      if(!target){await client.query('ROLLBACK');return res.status(404).json({error:'school_parent_not_found'});}
      if(target.role!=='parent'){
        await client.query("DELETE FROM auth_user_app_roles WHERE user_id=$1 AND app_role='parent'",[parentId]);
        await client.query("UPDATE auth_users SET metadata=COALESCE(metadata,'{}'::jsonb)-'schoolParent'-'notificationPreferences',updated_at=NOW() WHERE id=$1",[parentId]);
        await client.query("DELETE FROM school_portal_sessions WHERE user_id=$1",[parentId]);
        await client.query("DELETE FROM mobile_push_outbox WHERE token_hash IN(SELECT token_hash FROM mobile_push_tokens WHERE user_id=$1 AND app_role='parent')",[parentId]);
        await client.query("DELETE FROM mobile_push_tokens WHERE user_id=$1 AND app_role='parent'",[parentId]);
        await client.query('DELETE FROM school_child_parents WHERE parent_user_id=$1',[parentId]);
        await client.query("INSERT INTO audit_events(company_id,user_id,action,entity_type,entity_id,detail) VALUES($1,$2,'parent_app_role_revoked','auth_user',$3,'{}'::jsonb)",[companyId,req.user.id,String(parentId)]);
        await client.query('COMMIT');return res.json({ok:true,id:parentId,fleetAccountPreserved:true});
      }
      const deleted=await client.query(`UPDATE auth_users SET status='inactive',
        metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('deleted',true,'deletedAt',NOW(),'deletedBy',$1),updated_at=NOW()
        WHERE id=$2 AND company_id=$3 AND role='parent' AND COALESCE(metadata->>'deleted','false')<>'true' RETURNING id`,[req.user.id,parentId,companyId]);
      if(!deleted.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'school_parent_not_found'});}
      await client.query('DELETE FROM school_child_parents WHERE parent_user_id=$1',[parentId]);
       await client.query('DELETE FROM school_portal_sessions WHERE user_id=$1',[parentId]);
      await client.query("INSERT INTO audit_events(company_id,user_id,action,entity_type,entity_id,detail) VALUES($1,$2,'school_parent_deactivated','auth_user',$3,'{}'::jsonb)",[companyId,req.user.id,String(parentId)]);
      await client.query('COMMIT');res.json({ok:true,id:parentId});
    }catch(error){try{await client.query('ROLLBACK')}catch{};console.error('School parent delete failed:',error.message);res.status(500).json({error:'school_parent_delete_failed'});}finally{client.release();}
  });

  getMobile('/school/parent/dashboard',requireAuth,requireParentOrAdmin,async(req,res)=>{
    try{
      const companyId=companyIdFor(req.user,req.query.companyId);if(!companyId)return res.status(400).json({error:'company_id_required'});
      const parentClause=isParent(req.user)?'AND cp.parent_user_id=$2':'';const params=isParent(req.user)?[companyId,req.user.id]:[companyId];
      const {rows}=await pool.query(`SELECT DISTINCT c.id AS "childId",c.name AS "childName",a.vehicle_id AS "vehicleId",v.name AS "vehicleName",v.plate_number AS "plateNumber",
        v.metadata->>'driverName' AS "driverName",v.metadata->>'driverQid' AS "driverQid",v.metadata->>'driverMobile' AS "driverMobile",
        se.event_type AS "lastEventType",se.scanned_at AS "lastScannedAt",se.source AS "lastSource"
        FROM school_children c JOIN school_child_parents cp ON cp.child_id=c.id
        LEFT JOIN school_bus_assignments a ON a.child_id=c.id AND a.active=TRUE LEFT JOIN vehicles v ON v.id=a.vehicle_id
        LEFT JOIN LATERAL (SELECT event_type,scanned_at,source FROM school_scan_events WHERE child_id=c.id ORDER BY scanned_at DESC,id DESC LIMIT 1) se ON TRUE
        WHERE c.company_id=$1 AND c.active=TRUE ${parentClause} ORDER BY c.name`,params);
      res.set('Cache-Control','private,no-store').json({companyId,children:rows});
    }catch(error){console.error('Parent dashboard failed:',error.message);res.status(503).json({error:'parent_dashboard_unavailable'});}
  });

  app.post('/api/school/scans',requireAuth,async(req,res)=>{
    if(!hasSchoolModuleAccess(req.user))return res.status(403).json({error:'school_module_not_enabled'});
    const companyId=companyIdFor(req.user,req.body?.companyId),vehicleId=numberId(req.body?.vehicleId),rfidIdentifier=normalizeId(req.body?.rfidIdentifier);
    if(!companyId||!vehicleId||!rfidIdentifier)return res.status(400).json({error:'company_vehicle_and_rfid_required'});
    const scannedAt=clean(req.body?.scannedAt)||new Date().toISOString();if(!Number.isFinite(Date.parse(scannedAt)))return res.status(400).json({error:'invalid_scan_time'});
    try{
      const child=(await pool.query(`SELECT c.id,c.name,c.rfid_identifier,a.vehicle_id,v.name AS vehicle_name FROM school_children c
        JOIN school_bus_assignments a ON a.child_id=c.id AND a.active=TRUE JOIN vehicles v ON v.id=a.vehicle_id
        WHERE c.company_id=$1 AND c.rfid_identifier=$2 AND c.active=TRUE
          AND COALESCE(c.metadata->>'rfidStatus','Active') NOT IN ('Disabled','Lost','Inactive')`,[companyId,rfidIdentifier])).rows[0];
      if(!child)return res.status(404).json({error:'rfid_child_or_assignment_not_found'});
      if(String(child.vehicle_id)!==String(vehicleId))return res.status(409).json({error:'child_not_assigned_to_vehicle'});
      const last=(await pool.query('SELECT event_type FROM school_scan_events WHERE child_id=$1 AND vehicle_id=$2 ORDER BY scanned_at DESC,id DESC LIMIT 1',[child.id,vehicleId])).rows[0];
      const eventType=clean(req.body?.eventType).toLowerCase()||deriveEventType(last?.event_type);if(!['boarded','alighted'].includes(eventType))return res.status(400).json({error:'event_type_must_be_boarded_or_alighted'});
      const dedupeKey=buildDedupeKey({childId:child.id,vehicleId,eventType,scannedAt,scanId:req.body?.scanId});
      const inserted=await pool.query(`INSERT INTO school_scan_events(company_id,child_id,vehicle_id,event_type,rfid_identifier,scanned_at,source,dedupe_key,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(dedupe_key) DO NOTHING
        RETURNING id,company_id AS "companyId",child_id AS "childId",vehicle_id AS "vehicleId",event_type AS "eventType",rfid_identifier AS "rfidIdentifier",scanned_at AS "scannedAt",source`,
        [companyId,child.id,vehicleId,eventType,rfidIdentifier,scannedAt,clean(req.body?.source)||'rfid',dedupeKey,JSON.stringify(req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{})]);
      if(!inserted.rows[0]){
        const existing=(await pool.query('SELECT id,company_id AS "companyId",child_id AS "childId",vehicle_id AS "vehicleId",event_type AS "eventType",rfid_identifier AS "rfidIdentifier",scanned_at AS "scannedAt",source FROM school_scan_events WHERE dedupe_key=$1',[dedupeKey])).rows[0];
        return res.json({duplicate:true,event:existing});
      }
      const event=inserted.rows[0],parents=(await pool.query(`SELECT cp.parent_user_id
        FROM school_child_parents cp JOIN auth_users u ON u.id=cp.parent_user_id
        WHERE cp.child_id=$1
          AND COALESCE(u.metadata->'notificationPreferences'->>'enabled','true')<>'false'
          AND (($2='boarded' AND COALESCE(u.metadata->'notificationPreferences'->>'boarding','true')<>'false')
            OR ($2='alighted' AND COALESCE(u.metadata->'notificationPreferences'->>'dropoff','true')<>'false'))`,[child.id,eventType])).rows.map(row=>row.parent_user_id);
      const content=schoolPushContent({childName:child.name,eventType,vehicleName:child.vehicle_name,scannedAt});
      const push=await enqueueUserPushes(pool,{userIds:parents,companyId,alertId:`school:${event.id}`,semanticKey:`school:${child.id}:${event.id}`,payload:{...content,childId:String(child.id),vehicleId:String(vehicleId),scanId:String(event.id)}});
      res.status(201).json({duplicate:false,event,push});
    }catch(error){console.error('School scan failed:',error.message);res.status(503).json({error:'school_scan_failed'});}
  });

  getMobile('/school/scans',requireAuth,requireParentOrAdmin,async(req,res)=>{
    try{
      const companyId=companyIdFor(req.user,req.query.companyId);if(!companyId)return res.status(400).json({error:'company_id_required'});
      const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50));const parentClause=isParent(req.user)?'AND EXISTS (SELECT 1 FROM school_child_parents cp WHERE cp.child_id=e.child_id AND cp.parent_user_id=$2)':'';const params=isParent(req.user)?[companyId,req.user.id,limit]:[companyId,limit];
      const {rows}=await pool.query(`SELECT e.id,e.child_id AS "childId",c.name AS "childName",e.vehicle_id AS "vehicleId",v.name AS "vehicleName",e.event_type AS "eventType",e.rfid_identifier AS "rfidIdentifier",e.scanned_at AS "scannedAt",e.source
        FROM school_scan_events e JOIN school_children c ON c.id=e.child_id JOIN vehicles v ON v.id=e.vehicle_id WHERE e.company_id=$1 ${parentClause} ORDER BY e.scanned_at DESC,e.id DESC LIMIT $${params.length}`,params);
      res.set('Cache-Control','private,no-store').json(rows);
    }catch(error){res.status(503).json({error:'school_scans_unavailable'});}
  });

  app.delete('/api/school/scans/:id',requireAuth,requireSchoolAdmin,async(req,res)=>{
    const companyId=companyIdFor(req.user,req.body?.companyId),scanId=numberId(req.params.id);
    if(!companyId||!scanId)return res.status(400).json({error:'company_and_scan_required'});
    try{
      const deleted=await pool.query('DELETE FROM school_scan_events WHERE id=$1 AND company_id=$2 RETURNING id',[scanId,companyId]);
      if(!deleted.rowCount)return res.status(404).json({error:'school_scan_not_found'});
      res.json({ok:true,id:scanId});
    }catch(error){console.error('School scan delete failed:',error.message);res.status(500).json({error:'school_scan_delete_failed'});}
  });
}
