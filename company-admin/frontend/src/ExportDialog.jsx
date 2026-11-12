import React,{useEffect,useMemo,useState} from 'react';
import {Download,Search,X} from 'lucide-react';

const EVENT='inviha-export';
const safeName=value=>String(value||'export').replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'export';
const labelFor=key=>String(key).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase());
const cell=value=>Array.isArray(value)?value.join(' | '):value&&typeof value==='object'?JSON.stringify(value):value??'';
const download=(name,body,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(body instanceof Blob?body:new Blob([body],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
const csvCell=value=>'"'+String(cell(value)).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
const htmlCell=value=>String(cell(value)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function requestExport(name,rows,options={}){
 window.dispatchEvent(new CustomEvent(EVENT,{detail:{name,rows:Array.isArray(rows)?rows:[],formats:['csv','xlsx','json'],...options}}));
}

async function genericExport({name,rows,format,columns,labels={}}){
 const base=safeName(name),picked=rows.map(row=>Object.fromEntries(columns.map(key=>[key,cell(row?.[key])])));
 const headers=columns.map(key=>labels[key]||labelFor(key));
 if(format==='json'){download(base+'.json',JSON.stringify(picked,null,2),'application/json');return}
 if(format==='html'){
  const head=headers.map(value=>`<th>${htmlCell(value)}</th>`).join('');
  const body=picked.map(row=>`<tr>${columns.map(key=>`<td>${htmlCell(row[key])}</td>`).join('')}</tr>`).join('');
  const title=base.replace(/[-_]+/g,' ');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlCell(title)}</title><style>body{font:14px Arial,sans-serif;color:#173b57;margin:28px}h1{font-size:22px;margin:0 0 8px;text-transform:capitalize}p{color:#617b94;margin:0 0 20px}div{overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7e3ec;padding:8px;text-align:left;vertical-align:top}th{background:#edf4f9;color:#173b57}tr:nth-child(even){background:#f8fbfd}@media print{body{margin:12mm}}</style></head><body><h1>${htmlCell(title)}</h1><p>${picked.length} records · Exported ${htmlCell(new Date().toLocaleString())}</p><div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></body></html>`;
  download(base+'.html',html,'text/html;charset=utf-8');return;
 }
 if(format==='pdf'){
  const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')]);
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'}),title=base.replace(/[-_]+/g,' ');
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(23,59,87);doc.text(title,32,34,{maxWidth:doc.internal.pageSize.getWidth()-64});
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(95,119,145);doc.text(`${picked.length} records · Exported ${new Date().toLocaleString()}`,32,49);
  autoTable(doc,{startY:62,head:[headers],body:picked.map(row=>columns.map(key=>String(row[key]??''))),margin:{left:32,right:32,bottom:32},styles:{font:'helvetica',fontSize:8,cellPadding:5,overflow:'linebreak',valign:'top'},headStyles:{fillColor:[23,59,87],textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[244,248,251]},horizontalPageBreak:columns.length>9,horizontalPageBreakRepeat:0,showHead:'everyPage'});
  doc.save(base+'.pdf');return;
 }
 if(format==='xlsx'){
  const {default:ExcelJS}=await import('exceljs'),workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Export');
  sheet.addRow(headers);
  picked.forEach(row=>sheet.addRow(columns.map(key=>row[key])));
  sheet.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173B57'}}});
  sheet.columns.forEach(column=>column.width=24);
  download(base+'.xlsx',new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return;
 }
 if(format!=='csv')throw new Error(`Unsupported export format: ${format}`);
 const csv='\ufeff'+[headers,...picked.map(row=>columns.map(key=>row[key]))].map(row=>row.map(csvCell).join(',')).join('\r\n');
 download(base+'.csv',csv,'text/csv;charset=utf-8');
}

export function ExportDialogHost(){
 const [request,setRequest]=useState(null),[format,setFormat]=useState('csv'),[selected,setSelected]=useState([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const open=event=>{const next=event.detail||{},first=next.formats?.[0];setRequest(next);setFormat(typeof first==='string'?first:first?.value||'csv');setSelected([...new Set((next.rows||[]).flatMap(row=>Object.keys(row||{})))]);setQuery('');setError('')};window.addEventListener(EVENT,open);return()=>window.removeEventListener(EVENT,open)},[]);
 const columns=useMemo(()=>[...new Set((request?.rows||[]).flatMap(row=>Object.keys(row||{})))],[request]),visible=columns.filter(key=>(request?.labels?.[key]||labelFor(key)).toLowerCase().includes(query.toLowerCase()));
 if(!request)return null;
 const formats=request.formats?.length?request.formats:['csv'];
 async function run(){if(!request.rows?.length){setError('No rows to export.');return}if(!selected.length){setError('Select at least one field.');return}setBusy(true);setError('');try{if(request.onExport)await request.onExport(format,selected);else await genericExport({name:request.name,rows:request.rows,format,columns:selected,labels:request.labels});setRequest(null)}catch(e){setError('Export failed: '+e.message)}finally{setBusy(false)}}
 return <div className="exportDialogShade" onMouseDown={event=>event.target===event.currentTarget&&!busy&&setRequest(null)}><section className="exportDialog" role="dialog" aria-modal="true" aria-label="Export"><header><h2><Download/>Export</h2><button aria-label="Close export" disabled={busy} onClick={()=>setRequest(null)}><X/></button></header><div className="exportDialogBody"><label>Format<select value={format} onChange={event=>setFormat(event.target.value)}>{formats.map(item=>{const value=typeof item==='string'?item:item.value,label=typeof item==='string'?({csv:'CSV',xlsx:'Excel (.xlsx)',json:'JSON',pdf:'PDF',html:'HTML',print:'Print / Save PDF'}[item]||item.toUpperCase()):item.label;return <option key={value} value={value}>{label}</option>})}</select></label><div className="exportFieldHeading">Fields <b>*</b></div><div className="exportFieldTools"><button type="button" onClick={()=>setSelected(columns)}>Select all</button><button type="button" onClick={()=>setSelected([])}>Deselect all</button><label><Search/><input aria-label="Search export fields" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search fields"/></label></div><div className="exportFieldList">{visible.map(key=><label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={event=>setSelected(current=>event.target.checked?[...current,key]:current.filter(item=>item!==key))}/><span>{request.labels?.[key]||labelFor(key)}</span></label>)}</div>{error&&<p role="alert">{error}</p>}</div><footer><button className="exportConfirm" disabled={busy} onClick={run}>{busy?'Exporting…':'Export'}</button><button disabled={busy} onClick={()=>setRequest(null)}>Cancel</button></footer></section></div>;
}
