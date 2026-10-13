import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PurchasingPanel} from '../../src/purchasing';
import {repository,demo} from '../../src/data';
import {localAction} from '../../src/services/logistics-local';
import {demoProfile} from '../../src/services/types';
import '../../src/suite-colors.css';import '../../src/design-system.css';import '../../src/style.css';
if(!repository.existing())repository.save(localAction(demo(),'enable',{}));
function Harness(){const [db,setDb]=useState(repository.load);return <main style={{maxWidth:1200,margin:'0 auto'}}><PurchasingPanel db={db} profile={demoProfile} refresh={async()=>setDb(repository.load())}/></main>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
