import {useEffect,type ReactNode} from 'react';
import './AuthSurface.css';
export const authGateway='https://team.frc4418.org/';
export function inventorySignInGateway(hash=location.hash){
 const match=/^#location\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
 return match?`${authGateway}?inventory_location=${match[1].toLowerCase()}`:authGateway;
}
export function AuthSurface({children,redirect=false}:{children?:ReactNode;redirect?:boolean}){
 const gateway=inventorySignInGateway();
 useEffect(()=>{document.title='4418 IMPULSE';if(redirect)location.replace(gateway);},[redirect,gateway]);
 return <main className="impulse-auth"><section className="impulse-auth-card"><div className="impulse-auth-brand"><img src={`${import.meta.env.BASE_URL}branding/4418-impulse-emblem.png`} alt=""/><strong>4418 IMPULSE</strong></div>{children||<p role="status">{redirect?'Opening team sign in…':'Connecting securely…'}</p>}{redirect&&<a href={gateway}>Continue to team sign in</a>}</section><footer>FRC Team 4418 · IMPULSE</footer></main>;
}
