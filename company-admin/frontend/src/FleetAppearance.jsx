import {useText} from './LanguagePreferences.jsx';
import React,{useEffect,useLayoutEffect,useState} from 'react';
import {Search,Check,Upload,Image,Car,ShieldCheck} from 'lucide-react';
import {mapVehicleSvg} from './vehicle-icon.mjs';
import {vehicleCategories} from './vehicle-catalog.mjs';
import masarLogo from './assets/ui/masar-tracking-logo.png';
import googlePlayBadgeImage from './assets/ui/google-play-badge.png';
import appStoreBadgeImage from './assets/ui/app-store-badge.png';
import './fleet-design.css';
const BRANDING_KEY='inviha_global_branding';
const readCachedBranding=()=>{try{return JSON.parse(localStorage.getItem(BRANDING_KEY)||'{}')||{}}catch{return{}}};
const saveCachedBranding=value=>{try{localStorage.setItem(BRANDING_KEY,JSON.stringify({...readCachedBranding(),...value}))}catch{}};
let publicBrandingRequest;
function loadPublicBranding(){
 if(!publicBrandingRequest)publicBrandingRequest=fetch('/inviha-api/api/public/branding',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('branding_unavailable');return response.json()}).then(value=>{saveCachedBranding(value);return value}).catch(error=>{publicBrandingRequest=null;throw error});
 return publicBrandingRequest;
}
export function FormSection({title,icon:Icon=Car,children,className=''}){const t=useText();return <section className={'fleetFormSection '+className}><h3><Icon/>{t(title)}</h3><div className="formGrid">{children}</div></section>}
export function VehicleSymbol({category='Car'}){return <span className="vehicleSymbol" dangerouslySetInnerHTML={{__html:mapVehicleSvg(category)}}/>}
export function LoginVisual(){
 const [branding,setBranding]=useState(readCachedBranding);
 const apply=value=>{const page=document.querySelector('.productionLogin,.productionAdminLogin');if(!page)return;const src=String(value?.loginBackgroundData||value?.loginBackgroundUrl||'').trim(),transparency=Math.max(0,Math.min(70,Number(value?.loginPanelTransparency??18))),panel=String(value?.loginPanelColor||'#ffffff'),match=/^#([0-9a-f]{6})$/i.exec(panel),rgb=match?[0,2,4].map(index=>parseInt(match[1].slice(index,index+2),16)).join(','):'255,255,255';page.style.setProperty('--login-custom-background',src?`url(${JSON.stringify(src)})`:'none');page.style.setProperty('--login-panel-opacity',String((100-transparency)/100));page.style.setProperty('--login-panel-rgb',rgb);page.style.setProperty('--login-accent',String(value?.templateColor||'#0a75df'));page.style.setProperty('--login-text',String(value?.loginTextColor||'#0b2748'));page.style.setProperty('--login-background',String(value?.loginBackgroundColor||'#f4f8fb'))};
 useLayoutEffect(()=>apply(branding),[branding.loginBackgroundData,branding.loginBackgroundUrl,branding.loginPanelTransparency,branding.templateColor,branding.loginTextColor,branding.loginBackgroundColor,branding.loginPanelColor]);
 useEffect(()=>{let alive=true;loadPublicBranding().then(value=>{if(alive)setBranding(value)}).catch(()=>{});return()=>{alive=false}},[]);
 return null;
}
export function readLoginCaptchaToken(){return String(window.turnstile?.getResponse?.()||window.grecaptcha?.getResponse?.()||'')}
export function LoginCaptcha(){
 const [config,setConfig]=useState(()=>{const x=readCachedBranding();return{provider:x.captchaProvider||'None',siteKey:x.captchaSiteKey||''}});
 useEffect(()=>{let alive=true;loadPublicBranding().then(x=>{if(alive)setConfig({provider:x.captchaProvider||'None',siteKey:x.captchaSiteKey||''})}).catch(()=>{});return()=>{alive=false}},[]);
 useEffect(()=>{if(!config.siteKey||config.provider==='None')return;const id=config.provider==='Cloudflare Turnstile'?'inviha-turnstile-script':'inviha-recaptcha-script';if(document.getElementById(id))return;const script=document.createElement('script');script.id=id;script.async=true;script.defer=true;script.src=config.provider==='Cloudflare Turnstile'?'https://challenges.cloudflare.com/turnstile/v0/api.js':'https://www.google.com/recaptcha/api.js';document.head.appendChild(script)},[config.provider,config.siteKey]);
 if(!config.siteKey||config.provider==='None')return null;
 return <div className="loginCaptcha">{config.provider==='Cloudflare Turnstile'?<div className="cf-turnstile" data-sitekey={config.siteKey}/>:<div className="g-recaptcha" data-sitekey={config.siteKey}/>}</div>;
}
export function LoginBadge(){
 return <div className="loginBrandIdentity"><img className="loginOriginalLogo" src={masarLogo} alt="MASAR TRACKING"/></div>
}
function GmailIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M4.1 3.8h15.8A2.1 2.1 0 0 1 22 5.9v12.2a2.1 2.1 0 0 1-2.1 2.1H4.1A2.1 2.1 0 0 1 2 18.1V5.9a2.1 2.1 0 0 1 2.1-2.1Z"/><path fill="#34a853" d="M2 6.3c0-1 .8-1.9 1.8-2.1l4.4 3.4v12.6H4.1A2.1 2.1 0 0 1 2 18.1V6.3Z"/><path fill="#4285f4" d="M16 7.6l4.2-3.3A2.1 2.1 0 0 1 22 6.3v11.8a2.1 2.1 0 0 1-2.1 2.1H16V7.6Z"/><path fill="#ea4335" d="M3.8 4.2 12 10.5l8.2-6.3c.6.4 1.1 1.1 1.1 1.9v.2L12 14 2.7 6.3v-.2c0-.8.5-1.5 1.1-1.9Z"/><path fill="#fbbc04" d="M2 6.3v1.1l4.2 3.3V7.6L3.8 4.2C2.8 4.4 2 5.3 2 6.3Z"/></svg>}
function PhoneIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02z"/></svg>}
function WhatsAppIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25d366" d="M12 1.4a10.45 10.45 0 0 0-9.05 15.68L1.6 22.4l5.45-1.31A10.46 10.46 0 1 0 12 1.4Z"/><path fill="#fff" d="M16.72 13.9c-.26-.13-1.55-.77-1.79-.86-.24-.09-.41-.13-.59.13-.17.26-.68.86-.83 1.03-.15.17-.3.2-.56.07-.26-.13-1.11-.41-2.11-1.3-.78-.69-1.3-1.55-1.45-1.81-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.45.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.07-.13-.59-1.43-.81-1.96-.21-.51-.43-.44-.59-.45h-.5c-.17 0-.45.06-.69.32-.24.26-.91.89-.91 2.17s.93 2.51 1.06 2.68c.13.17 1.83 2.78 4.42 3.9.62.27 1.1.43 1.47.54.62.2 1.18.17 1.62.1.49-.07 1.55-.63 1.77-1.24.22-.62.22-1.14.15-1.25-.06-.11-.24-.17-.5-.3Z"/></svg>}
export function LoginAppLinks(){
 const [links,setLinks]=useState(()=>{const x=readCachedBranding();return{googlePlayUrl:x.googlePlayUrl||'',appStoreUrl:x.appStoreUrl||''}});
 useEffect(()=>{let alive=true;loadPublicBranding().then(x=>{if(alive)setLinks({googlePlayUrl:x.googlePlayUrl||'',appStoreUrl:x.appStoreUrl||''})}).catch(()=>{});return()=>{alive=false}},[]);
 if(!links.googlePlayUrl&&!links.appStoreUrl)return null;
 return <div className="loginAppsBlock" aria-label="Mobile apps"><div className="loginAppsHeading"><span/>Get the mobile app<span/></div><div className="loginAppLinks">{links.googlePlayUrl&&<a href={links.googlePlayUrl} target="_blank" rel="noreferrer" className="appStoreBadge" aria-label="Get it on Google Play"><img src={googlePlayBadgeImage} alt="Get it on Google Play" /></a>}{links.appStoreUrl&&<a href={links.appStoreUrl} target="_blank" rel="noreferrer" className="appStoreBadge" aria-label="Download on the App Store"><img src={appStoreBadgeImage} alt="Download on the App Store" /></a>}</div></div>
}
export function LoginSupportLinks(){
 const [support,setSupport]=useState(()=>{const x=readCachedBranding();return{supportEmail:x.supportEmail||'',supportPhone:x.supportPhone||'',whatsappNumber:x.whatsappNumber||''}});
 useEffect(()=>{let alive=true;loadPublicBranding().then(x=>{if(alive)setSupport({supportEmail:x.supportEmail||'',supportPhone:x.supportPhone||'',whatsappNumber:x.whatsappNumber||''})}).catch(()=>{});return()=>{alive=false}},[]);
 const phone=String(support.supportPhone||'').replace(/[^0-9]/g,'');
 const whatsappNumber=String(support.whatsappNumber||'').replace(/[^0-9]/g,'');
 const whatsappHref=whatsappNumber.length>=7?`https://wa.me/${whatsappNumber}`:'';
 const callHref=phone.length>=7?`tel:+${phone}`:'';
 const preventUnconfigured=e=>e.preventDefault();
 return <div className="loginSupportLinks" aria-label="Support links">
  <a className="supportIconLink emailSupportLink" href={support.supportEmail?`mailto:${support.supportEmail}?subject=Tracking%20support`:'#email-not-configured'} aria-label="Email support" aria-disabled={!support.supportEmail} data-tooltip="Email support" onClick={support.supportEmail?undefined:preventUnconfigured}><GmailIcon/></a>
  <a className="supportIconLink phoneSupportLink" href={callHref||'#call-not-configured'} aria-label="Call support" aria-disabled={!callHref} data-tooltip="Phone support" onClick={callHref?undefined:preventUnconfigured}><PhoneIcon/></a>
  <a className="supportIconLink whatsappSupportLink" href={whatsappHref||'#whatsapp-not-configured'} aria-label="WhatsApp support" aria-disabled={!whatsappHref} data-tooltip="WhatsApp" onClick={whatsappHref?undefined:preventUnconfigured}><WhatsAppIcon/></a>
  <a className="supportIconLink privacyPolicyLink" href="/privacy-policy" aria-label="Privacy policy" data-tooltip="Privacy policy"><ShieldCheck/></a>
 </div>
}
export function LoginRecoveryLink(){
 const [whatsapp,setWhatsapp]=useState(()=>readCachedBranding().whatsappNumber||'');
 useEffect(()=>{let alive=true;loadPublicBranding().then(x=>{if(alive)setWhatsapp(x.whatsappNumber||'')}).catch(()=>{});return()=>{alive=false}},[]);
 const number=String(whatsapp||'').replace(/[^0-9]/g,'');
 const href=number.length>=7?`https://wa.me/${number}?text=${encodeURIComponent('Hello, I need help resetting my password.')}`:'';
 return <a className="loginRecoveryLink" href={href||'#whatsapp-not-configured'} aria-disabled={!href} onClick={href?undefined:e=>e.preventDefault()} target={href?'_blank':undefined} rel={href?'noopener noreferrer':undefined}>Forgot password?</a>
}
export function VehicleAppearance({value,onChange}){
 const [query,setQuery]=useState(''),[more,setMore]=useState(false),[url,setUrl]=useState(value.imageUrl?.startsWith('data:')?'':value.imageUrl||''),[error,setError]=useState('');
 const choices=vehicleCategories.filter(c=>c.toLowerCase().includes(query.toLowerCase())),selected=value.category||'Car';
 function fileSelected(file){if(!file)return;setError('');if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>250000){setError('Choose a PNG, JPEG or WebP image under 250 KB.');return}const r=new FileReader();r.onerror=()=>setError('Unable to read this image.');r.onload=()=>onChange({...value,imageUrl:String(r.result)});r.readAsDataURL(file)}
 function loadUrl(){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error();onChange({...value,imageUrl:u.href});setError('')}catch{setError('Enter a valid HTTP or HTTPS image URL.')}}
 return <div className="vehicleAppearance"><div className="appearanceHead"><div><h3><Car/>Vehicle icon</h3><p>Choose the symbol shown for this vehicle on the live map.</p></div><label className="appearanceSearch"><Search/><input aria-label="Search vehicle icons" placeholder="Search icons…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="fleetIconGrid">{(query||more?choices:choices.slice(0,22)).map(c=><button type="button" aria-pressed={c===selected} key={c} className={c===selected?'selected':''} onClick={()=>onChange({...value,category:c})}><VehicleSymbol category={c}/><span>{c}</span>{c===selected&&<Check className="iconSelectedCheck"/>}</button>)}</div>{!choices.length&&<p>No matching vehicle icons.</p>}{!query&&<button type="button" className="viewMoreIcons" onClick={()=>setMore(!more)}>{more?'Show fewer icons':'View all '+vehicleCategories.length+' icons'}</button>}<h3><Image/>Vehicle image / logo</h3><div className="fleetImageGrid"><label className="fleetDropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();fileSelected(e.dataTransfer.files[0])}}><Upload/><b>Drop your image here</b><span>or click to browse</span><small>PNG, JPEG or WebP · up to 250 KB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>fileSelected(e.target.files[0])}/></label><div className="fleetImageUrl"><label>Image URL<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label><button type="button" onClick={loadUrl}>Load image</button><div className="fleetImagePreview">{value.imageUrl?<img src={value.imageUrl} alt="Vehicle image preview" onError={()=>setError('The image could not be loaded. Check the URL or upload a file.')}/>:<VehicleSymbol category={selected}/>}</div>{value.imageUrl&&<button type="button" onClick={()=>{onChange({...value,imageUrl:''});setUrl('');setError('')}}>Remove image</button>}</div></div>{error&&<p className="fleetFormError" role="alert">{error}</p>}</div>
}
