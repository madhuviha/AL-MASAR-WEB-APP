import React from 'react';

const token=()=>location.pathname.startsWith('/admin')?localStorage.getItem('inviha_super_token'):sessionStorage.getItem('inviha_company_support_token')||localStorage.getItem('inviha_company_token');

export default class AppErrorBoundary extends React.Component{
 constructor(props){super(props);this.state={failed:false,detail:''}}
 static getDerivedStateFromError(){return{failed:true}}
 componentDidCatch(error,info){
  this.setState({detail:[String(error?.name||'Error')+': '+String(error?.message||error||'Unknown render error'),String(info?.componentStack||'')].filter(Boolean).join('\n')});
  const auth=token();
  if(!auth)return;
  fetch('/inviha-api/api/diagnostics/client-error',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify({portal:this.props.portal||'company',message:String(error?.message||error||'Browser application error'),stack:String(error?.stack||info?.componentStack||''),path:location.pathname+location.search})}).catch(()=>{});
 }
 render(){
  if(!this.state.failed)return this.props.children;
  const localOnly=typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname);
  return <main role="alert" style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f4f8fb',color:'#0b2a4a',fontFamily:'Arial,sans-serif'}}><section style={{width:'min(760px,100%)',maxHeight:'90vh',overflow:'auto',padding:32,border:'1px solid #d8e3ec',borderRadius:16,background:'#fff',boxShadow:'0 18px 50px #173b5718',textAlign:'center'}}><h1 style={{marginTop:0}}>This page could not be displayed</h1><p>Your data is safe. The error was recorded for support.</p>{localOnly&&this.state.detail&&<details open style={{margin:'20px 0',textAlign:'left'}}><summary style={{cursor:'pointer',fontWeight:700}}>Local troubleshooting details</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'45vh',overflow:'auto',padding:16,background:'#f4f8fb',border:'1px solid #d8e3ec',fontSize:12}}>{this.state.detail}</pre></details>}<button type="button" onClick={()=>location.reload()} style={{border:0,borderRadius:8,padding:'12px 20px',background:'#08a85a',color:'#fff',fontWeight:700,cursor:'pointer'}}>Reload page</button></section></main>;
 }
}
