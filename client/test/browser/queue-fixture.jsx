// Local browser test fixture. This entry is outside the production build graph.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../src/LanguageContext';
import { AppErrorBoundary } from '../../src/AppErrorBoundary';
import { useLiveQueue } from '../../src/useLiveQueue';
import QueueConnectionStatus from '../../src/QueueConnectionStatus';
import '../../src/styles.css';
function Crash() { throw new Error('SYNTHETIC_PRIVATE_RENDER_VALUE'); }
function Probe() {
 const state=useLiveQueue('staff');
 return <section><QueueConnectionStatus state={state}/><output data-testid="queue-state">{state.status}</output><output data-testid="queue-count">{state.tokens.length}</output>
 <button onClick={state.retry}>Refresh queue probe</button>{state.status==='ready'&&state.tokens.length===0&&<p>Confirmed empty queue</p>}</section>;
}
function Fixture() {
 const [crash,setCrash]=useState(false),[mounted,setMounted]=useState(true);
 return <LanguageProvider><AppErrorBoundary><button onClick={()=>setCrash(true)}>Crash fixture</button><button onClick={()=>setMounted(false)}>Unmount queue</button>{crash?<Crash/>:mounted?<Probe/>:null}</AppErrorBoundary></LanguageProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
