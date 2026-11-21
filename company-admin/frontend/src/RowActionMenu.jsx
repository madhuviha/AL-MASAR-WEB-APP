import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MoreVertical,Settings} from 'lucide-react';
import './row-action-menu.css';

const MENU_WIDTH=176;

export default function RowActionMenu({label='Row actions',items=[],trigger='gear',className=''}){
  const id=useId();
  const [open,setOpen]=useState(false);
  const [confirming,setConfirming]=useState(null);
  const [position,setPosition]=useState({left:8,top:8});
  const triggerRef=useRef(null);
  const menuRef=useRef(null);
  const Icon=trigger==='dots'?MoreVertical:Settings;

  useEffect(()=>{
    const onOtherMenu=event=>{if(event.detail!==id)setOpen(false)};
    window.addEventListener('company-row-action-open',onOtherMenu);
    return()=>window.removeEventListener('company-row-action-open',onOtherMenu);
  },[id]);

  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const anchor=triggerRef.current?.getBoundingClientRect();
      if(!anchor)return;
      const width=Math.min(MENU_WIDTH,window.innerWidth-16);
      const left=Math.max(8,Math.min(anchor.right-width,window.innerWidth-width-8));
      const measuredHeight=menuRef.current?.getBoundingClientRect().height||items.length*35+12;
      const below=window.innerHeight-anchor.bottom-12;
      const top=below>=measuredHeight?anchor.bottom+8:Math.max(8,anchor.top-measuredHeight-8);
      setPosition({left,top});
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
  },[open,items.length]);

  useEffect(()=>{
    if(!open)return;
    const closeOutside=event=>{
      if(triggerRef.current?.contains(event.target)||menuRef.current?.contains(event.target))return;
      setOpen(false);
    };
    const onKeyDown=event=>{
      if(event.key==='Escape'){
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown',closeOutside,true);
    document.addEventListener('keydown',onKeyDown,true);
    return()=>{
      document.removeEventListener('pointerdown',closeOutside,true);
      document.removeEventListener('keydown',onKeyDown,true);
    };
  },[open]);

  useEffect(()=>{
    if(!confirming)return;
    const onKeyDown=event=>{
      if(event.key==='Escape')setConfirming(null);
    };
    document.addEventListener('keydown',onKeyDown,true);
    return()=>document.removeEventListener('keydown',onKeyDown,true);
  },[confirming]);

  const toggle=event=>{
    event.stopPropagation();
    if(open){setOpen(false);return}
    window.dispatchEvent(new CustomEvent('company-row-action-open',{detail:id}));
    const anchor=triggerRef.current?.getBoundingClientRect();
    if(anchor){
      const width=Math.min(MENU_WIDTH,window.innerWidth-16);
      setPosition({left:Math.max(8,Math.min(anchor.right-width,window.innerWidth-width-8)),top:anchor.bottom+8});
    }
    setOpen(true);
  };

  const chooseItem=item=>{
    setOpen(false);
    if(item.tone==='danger'&&item.confirmation!==false){setConfirming(item);return}
    item.onSelect?.();
  };

  const subject=label.replace(/^Actions for\s*/i,'').trim()||'this item';
  const confirmation=confirming?.confirmation&&typeof confirming.confirmation==='object'?confirming.confirmation:{};
  const isDeactivate=/deactivat/i.test(confirming?.label||'');

  return <>
    <button ref={triggerRef} type="button" className={`rowActionTrigger ${className}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
      <Icon aria-hidden="true"/>
    </button>
    {open&&createPortal(<div ref={menuRef} className="rowActionPopover" style={{left:position.left,top:position.top}} role="menu" aria-label={label} onClick={event=>event.stopPropagation()}>
      <div className="rowActionContext" aria-hidden="true"><small>Actions for</small><strong title={subject}>{subject}</strong></div>
      {items.map((item,index)=>{
        const ItemIcon=item.icon;
        return <button key={`${item.label}-${index}`} type="button" role="menuitem" className={item.tone==='danger'?'danger':''} disabled={item.disabled} onClick={()=>chooseItem(item)}>
          {ItemIcon&&<ItemIcon aria-hidden="true"/>}<span>{item.label}</span>
        </button>;
      })}
    </div>,document.body)}
    {confirming&&createPortal(<div className="deleteConfirmOverlay" onMouseDown={event=>event.target===event.currentTarget&&setConfirming(null)}>
      <div className="deleteConfirmDialog" role="alertdialog" aria-modal="true" aria-labelledby={`rowConfirmTitle-${id}`} aria-describedby={`rowConfirmBody-${id}`}>
        <div className="deleteConfirmMessage">
          <p id={`rowConfirmTitle-${id}`}>{confirmation.message||`Do you really want to ${String(confirming.label||'continue').toLowerCase()} ${subject}?`}</p>
          <p id={`rowConfirmBody-${id}`}>{confirmation.description||(isDeactivate?'This account will be disabled. You can enable it again later.':'This item will be removed from the company account.')}</p>
        </div>
        <div className="deleteConfirmActions">
          <button type="button" className="confirmDeleteAction" onClick={()=>{const action=confirming.onSelect;setConfirming(null);action?.()}}>{confirmation.actionLabel||confirming.label||'Confirm'}</button>
          <button type="button" onClick={()=>setConfirming(null)}>Cancel</button>
        </div>
      </div>
    </div>,document.body)}
  </>;
}
