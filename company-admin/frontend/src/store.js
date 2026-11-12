const schoolPortal=typeof window!=='undefined'&&(window.location.hostname.toLowerCase()==='trackschoolbus.masar.qa'||/^\/schoolbus(?:\/|$)/i.test(window.location.pathname));
const KEY=schoolPortal?'inviha_school_portal_v1':'inviha_track_master_v15_production';

export const COMPANY_MODULES=[
  ['dashboard','Dashboard'],['map','Map'],['vehicles','Vehicles'],['drivers','Drivers'],['reports','Reports'],
  ['alerts','Alerts'],['geofences','Geofences'],['maintenance','Maintenance'],['sensors','Sensors'],['users','Users'],['settings','Settings']
];
export const DEFAULT_COMPANY_PERMISSIONS=Object.fromEntries(COMPANY_MODULES.map(([k])=>[k,true]));
export const DEFAULT_VEHICLE_PERMISSIONS={addVehicle:false,editVehicle:false,deleteVehicle:false,changeImei:false,changeTrackerConfiguration:false};

const seed={
  companies:[],drivers:[],vehicles:[],sims:[],installations:[],maintenance:[],subscriptions:[],invoices:[],users:[],localGeofences:[],schoolBuses:[],schoolBranches:[],schoolChildren:[],schoolParents:[],schoolScans:[],schoolRoutes:[],schoolAttenders:[],schoolCoordinators:[],schoolRfidCards:[],schoolRfidReaders:[],pois:[],parkingSlots:[],
  alertRules:[],alerts:[],auditLogs:[],commandRequests:[],savedCustomCommands:[],reportSchedules:[],backupHistory:[],diagnosticCases:[],contentItems:[],adminActions:[],vehicleExpenses:[],sensorConfigs:[],roleTemplates:{},ruleRuntime:{},geofenceRuntime:{},
  settings:{companyName:'Fleet Platform',currency:'QAR',timezone:'Asia/Qatar',offlineMinutes:5,overspeedKmh:120,theme:'light',customerLoginUrl:'http://localhost:5173',defaultCountry:'Qatar',supportEmail:'support@inviha.com',backupLaptopPath:'D:\\INVIHA_BACKUPS',backupRetentionWeeks:8}
};
function clone(v){return typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v))}
function hydrate(parsed={}){const merged={...clone(seed),...parsed,settings:{...clone(seed).settings,...(parsed.settings||{})}};for(const k of ['companies','drivers','vehicles','sims','installations','maintenance','subscriptions','invoices','users','localGeofences','schoolBuses','schoolBranches','schoolChildren','schoolParents','schoolScans','schoolRoutes','schoolAttenders','schoolCoordinators','schoolRfidCards','schoolRfidReaders','alertRules','alerts','auditLogs','commandRequests','savedCustomCommands','reportSchedules','backupHistory','diagnosticCases','contentItems','adminActions','vehicleExpenses','sensorConfigs','pois','parkingSlots'])if(!Array.isArray(merged[k]))merged[k]=[];merged.roleTemplates=merged.roleTemplates||{};merged.ruleRuntime=merged.ruleRuntime||{};merged.geofenceRuntime=merged.geofenceRuntime||{};return merged}
export function loadStore(){try{const raw=typeof localStorage==='undefined'?null:localStorage.getItem(KEY);return hydrate(raw?JSON.parse(raw):seed)}catch{return clone(seed)}}
export function saveStore(s){const next=hydrate(s);try{if(typeof localStorage!=='undefined')localStorage.setItem(KEY,JSON.stringify(next))}catch{}return next}
export function id(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}
export function addRow(s,key,row){return saveStore({...s,[key]:[...(s[key]||[]),{id:id(),createdAt:new Date().toISOString(),...row}]})}
export function updateRow(s,key,rowId,patch){return saveStore({...s,[key]:(s[key]||[]).map(x=>x.id===rowId?{...x,...patch,updatedAt:new Date().toISOString()}:x)})}
export function deleteRow(s,key,rowId){return saveStore({...s,[key]:(s[key]||[]).filter(x=>x.id!==rowId)})}
export function setSettings(s,patch){return saveStore({...s,settings:{...s.settings,...patch}})}
export function addAudit(s,{action,module,recordId='',companyId='',detail='',actor='Company Admin'}){return addRow(s,'auditLogs',{action,module,recordId,companyId,detail,actor,at:new Date().toISOString()})}
export function ensureCompany(s){if(s.companies?.length)return s;const company={id:null,name:'Fleet Portal',tagline:'',contact:'',adminName:'',email:'',phone:'',address:'',country:'Qatar',status:'Active',timezone:'Asia/Qatar',currency:'QAR',logoData:'',permissions:{...DEFAULT_COMPANY_PERMISSIONS},vehiclePermissions:{...DEFAULT_VEHICLE_PERMISSIONS},settings:{refreshSeconds:5,offlineMinutes:10,speedUnit:'km/h',distanceUnit:'km',fuelUnit:'L',mapStyle:'road',dateFormat:'DD-MM-YYYY',timeFormat:'24h',sessionTimeout:60,defaultRole:'Viewer',alertInApp:true,alertEmail:false,geofenceRadius:500,maintenanceReminderDays:7,sensorMissingText:'Not available',offHoursFrom:'17:00',offHoursTo:'07:00',showVehicleLabels:true,clusterMarkers:true,showGeofences:true,showPoiParking:true}};return {...s,companies:[company]}}
