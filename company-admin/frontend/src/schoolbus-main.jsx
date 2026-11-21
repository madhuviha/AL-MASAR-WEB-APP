import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolPortalApp } from './App.jsx';
import './styles.css';
import './fleet-design.css';
import './modern-login.css';
import './company-sidebar-final.css';
import './school-buses.css';
import './login-page-final.css';

class SchoolPortalErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,color:'#0b2a4a',fontFamily:'Arial,sans-serif'}}><section style={{maxWidth:520,padding:32,background:'#fff',border:'1px solid #d8e3ec',textAlign:'center'}}><h1>School Bus page could not be displayed</h1><p>Your data is safe. Refresh the page or contact support if this continues.</p><button onClick={()=>location.reload()}>Reload page</button></section></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SchoolPortalErrorBoundary><SchoolPortalApp /></SchoolPortalErrorBoundary>
  </React.StrictMode>
);
