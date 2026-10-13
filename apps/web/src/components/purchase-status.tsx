import { purchaseJourney,type SubscriptionState } from "@gold-revenue-os/domain";
export default function PurchaseStatus({now,mode,paymentVerified,state,endsAt,graceUntil,accessStatus,invite,inviteExpires}:{now:number;mode:"test"|"live";paymentVerified:boolean;state:SubscriptionState;endsAt:string;graceUntil:string;accessStatus?:string|undefined;invite?:string|null|undefined;inviteExpires?:string|null|undefined}){
 const entitled=["ACTIVE","RENEWAL_DUE"].includes(state)&&Date.parse(graceUntil)>now;
 const validInvite=mode==="live"&&Boolean(invite&&/^https:\/\/t\.me\/\+[A-Za-z0-9_-]+$/u.test(invite)&&inviteExpires&&Date.parse(inviteExpires)>now);
 const view=purchaseJourney({paymentVerified,paymentState:paymentVerified?"CONFIRMED":"PENDING",subscriptionState:state,entitled,membershipVerified:accessStatus==="MEMBER"&&entitled,inviteAvailable:validInvite,mode});
 return <section className="panel"><h2>Membership status</h2><p role="status">{view.message}</p><p>Valid until {endsAt}</p>{validInvite&&view.action==="join"&&<a href={invite!} rel="noreferrer">Join VIP</a>}{mode==="test"&&<p>This preview creates no real membership, payment or Telegram access.</p>}</section>;
}
