import React,{useEffect,useRef,useState}from"react";
import{
 ArrowRight,
 CheckCircle2,
 Crown,
 CreditCard,
 ExternalLink,
 Gift,
 Loader2,
 LockKeyhole,
 Server,
 Shield,
 X,
 Zap
}from"lucide-react";
import"./balticm-premium-shop.css";

const VIP_FEATURES=[
 ["Custom Bot Identity","Use your own bot nickname and custom bot image."],
 ["Unlimited Reaction Roles","Create as many Reaction Role panels as your community needs."],
 ["Advanced Direct Messages","Multi-select recipients, bulk send, templates, embeds and preview."],
 ["Voice Create","Configure up to 5 temporary Voice Create channels."],
 ["Premium Server Features","Unlock additional management features inside BalticM Control Center."],
 ["Per-server Premium","Premium is isolated to the Discord server you choose."]
];

const FREE_FEATURES=[
 "Core bot commands",
 "Moderation & activity logs",
 "Reaction Roles up to 4",
 "Voice Create 1 channel",
 "Direct Messages to 1 member",
 "BalticM.Eu bot identity"
];

function money(value,currency="EUR"){
 const n=Number(value);

 if(!Number.isFinite(n)){
  return null;
 }

 try{
  return new Intl.NumberFormat(undefined,{
   style:"currency",
   currency:String(currency||"EUR")
  }).format(n);
 }catch{
  return`${n.toFixed(2)} ${currency||"EUR"}`;
 }
}

function expiryLabel(value){
 if(!value){
  return"";
 }

 const d=new Date(value);

 if(Number.isNaN(d.getTime())){
  return"";
 }

 return d.toLocaleDateString(undefined,{
  year:"numeric",
  month:"short",
  day:"numeric"
 });
}

function DiscordLogo(){
 return(
  <svg
   className="bmDiscordLogo"
   viewBox="0 0 127.14 96.36"
   aria-hidden="true"
  >
   <path
    fill="currentColor"
    d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83A97.68 97.68 0 0 0 49 6.83 72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21A105.73 105.73 0 0 0 32.71 96.36a77.7 77.7 0 0 0 6.89-8.76 68.42 68.42 0 0 1-10.86-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.67 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 8.75A105.25 105.25 0 0 0 126.6 80.22C129.24 52.84 122.09 29.11 107.7 8.07ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.72 11.43-12.72S54 46 53.89 53 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.72 11.44-12.72S96.23 46 96.12 53 91.08 65.69 84.69 65.69Z"
   />
  </svg>
 );
}

function loadTebex(){
 if(window.Tebex?.checkout){
  return Promise.resolve(window.Tebex);
 }

 const existing=document.querySelector(
  "script[data-balticm-tebex],script[data-tebex-js]"
 );

 if(existing){
  return new Promise((resolve,reject)=>{
   let ticks=0;

   const wait=()=>{
    if(window.Tebex?.checkout){
     return resolve(window.Tebex);
    }

    if(++ticks>160){
     return reject(
      new Error("Tebex checkout timed out")
     );
    }

    setTimeout(wait,50);
   };

   wait();
  });
 }

 return new Promise((resolve,reject)=>{
  const s=document.createElement("script");

  s.src="https://js.tebex.io/v/1.js";
  s.async=true;
  s.dataset.balticmTebex="1";

  s.onload=()=>{
   window.Tebex?.checkout
    ?resolve(window.Tebex)
    :reject(
     new Error("Tebex checkout did not load")
    );
  };

  s.onerror=()=>{
   reject(
    new Error("Could not load Tebex checkout")
   );
  };

  document.head.appendChild(s);
 });
}

export default function BalticMPremiumShop({
 user,
 selectedGuild
}){
 const guild=(user?.guilds||[]).find(
  g=>String(g.id)===String(selectedGuild||"")
 )||null;

 const[plan,setPlan]=useState({
  loading:!!user,
  premium:false,
  status:"FREE",
  displayPlan:"FREE",
  expiresAt:"",
  remaining:""
 });

 const[notice,setNotice]=useState("");
 const[starting,setStarting]=useState(false);
 const[checkout,setCheckout]=useState(null);
 const[checkoutError,setCheckoutError]=useState("");

 const hostRef=useRef(null);
 const cleanupsRef=useRef([]);

 const refreshPlan=()=>{
  if(!user||!selectedGuild){
   setPlan({
    loading:false,
    premium:false,
    status:"FREE",
    displayPlan:"FREE",
    expiresAt:"",
    remaining:""
   });

   return Promise.resolve();
  }

  setPlan(p=>({
   ...p,
   loading:true
  }));

  return fetch(
   `/api/premium?guildId=${encodeURIComponent(selectedGuild)}`,
   {
    cache:"no-store"
   }
  )
   .then(async r=>{
    const j=await r.json().catch(()=>({}));

    if(!r.ok){
     throw new Error(
      j.error||
      "Could not load Premium status"
     );
    }

    return j;
   })
   .then(j=>{
    setPlan({
     loading:false,
     premium:!!j.premium,
     status:j.status||(j.premium?"ACTIVE":"FREE"),
     displayPlan:j.displayPlan||(j.premium?"VIP":"FREE"),
     expiresAt:j.expiresAt||"",
     remaining:j.remaining||""
    });
   })
   .catch(()=>{
    setPlan(p=>({
     ...p,
     loading:false
    }));
   });
 };

 useEffect(()=>{
  refreshPlan();
 },[
  user,
  selectedGuild
 ]);

 useEffect(()=>{
  const fn=()=>refreshPlan();

  window.addEventListener(
   "balticm-premium-refresh",
   fn
  );

  return()=>{
   window.removeEventListener(
    "balticm-premium-refresh",
    fn
   );
  };
 },[
  user,
  selectedGuild
 ]);

 const closeCheckout=()=>{
  try{
   cleanupsRef.current.forEach(
    fn=>typeof fn==="function"&&fn()
   );
  }catch{}

  cleanupsRef.current=[];

  try{
   if(hostRef.current){
    hostRef.current.innerHTML="";
   }
  }catch{}

  setCheckout(null);
  setCheckoutError("");
 };

 useEffect(()=>{
  if(
   !checkout?.basketIdent||
   !hostRef.current
  ){
   return;
  }

  let cancelled=false;

  const mount=async()=>{
   setCheckoutError("");

   try{
    const Tebex=await loadTebex();

    if(
     cancelled||
     !hostRef.current
    ){
     return;
    }

    cleanupsRef.current.forEach(fn=>{
     try{
      fn?.();
     }catch{}
    });

    cleanupsRef.current=[];

    hostRef.current.innerHTML="";

    Tebex.checkout.init({
     ident:checkout.basketIdent,
     theme:"dark",
     locale:"en_US",
     popupOnMobile:false,
     closeOnPaymentComplete:true,
     colors:[
      {
       name:"primary",
       color:"#e8892c"
      },
      {
       name:"secondary",
       color:"#f3a35b"
      },
      {
       name:"surface",
       color:"#12100e"
      }
     ]
    });

    try{
     const offComplete=Tebex.checkout.on?.(
      "payment:complete",
      ()=>{
       setNotice(
        "Payment received — Premium activates when Tebex confirms the payment."
       );

       closeCheckout();

       setTimeout(()=>{
        refreshPlan();

        try{
         window.dispatchEvent(
          new CustomEvent(
           "balticm-premium-refresh",
           {
            detail:{
             guildId:selectedGuild
            }
           }
          )
         );
        }catch{}
       },1200);
      }
     );

     const offClose=Tebex.checkout.on?.(
      "close",
      ()=>closeCheckout()
     );

     if(
      typeof offComplete==="function"
     ){
      cleanupsRef.current.push(
       offComplete
      );
     }

     if(
      typeof offClose==="function"
     ){
      cleanupsRef.current.push(
       offClose
      );
     }
    }catch{}

    const width=Math.max(
     760,
     hostRef.current.clientWidth||760
    );

    const height=Math.max(
     720,
     hostRef.current.clientHeight||720
    );

    await Tebex.checkout.render(
     hostRef.current,
     width,
     height,
     false
    );
   }catch(e){
    if(!cancelled){
     setCheckoutError(
      e?.message||
      "Payment form did not load"
     );
    }
   }
  };

  requestAnimationFrame(
   ()=>requestAnimationFrame(
    mount
   )
  );

  return()=>{
   cancelled=true;
  };
 },[
  checkout?.basketIdent
 ]);

 const startCheckout=async()=>{
  if(!user){
   window.location.href=
    "/api/auth/login?return=/premium";

   return;
  }

  if(
   !selectedGuild||
   starting
  ){
   return;
  }

  setStarting(true);
  setNotice("");
  setCheckoutError("");

  try{
   const r=await fetch(
    `/api/premium/tebex/checkout?guildId=${encodeURIComponent(selectedGuild)}`,
    {
     method:"POST",
     headers:{
      "Content-Type":"application/json"
     },
     cache:"no-store"
    }
   );

   const j=await r.json().catch(
    ()=>({})
   );

   if(!r.ok){
    throw new Error(
     j.error||
     "Could not start checkout"
    );
   }

   if(!j.basketIdent){
    throw new Error(
     "Checkout basket missing"
    );
   }

   setCheckout({
    basketIdent:String(
     j.basketIdent
    ),
    checkoutUrl:String(
     j.checkoutUrl||""
    ),
    basket:j.basket||{}
   });
  }catch(e){
   setNotice(
    e?.message||
    "Checkout failed"
   );
  }finally{
   setStarting(false);
  }
 };

 const vipActive=!!plan.premium;
 const expires=expiryLabel(
  plan.expiresAt
 );

 return(
  <div className="bmShop">

   <div className="bmShopHero">

    <div
     className="bmShopHeroGlow"
     aria-hidden="true"
    />

    <div className="bmShopHeroCopy">

     <span className="bmShopKicker">
      <Crown/>
      BALTICM PREMIUM
     </span>

     <h3>
      Upgrade the server.

      <span>
       Keep the Control Center.
      </span>
     </h3>

     <p>
      Unlock the complete BalticM Bot experience for one Discord server.
      No separate store theme, no disconnected flow.
     </p>

     <div className="bmShopTrust">

      <span>
       <LockKeyhole/>
       Secure Tebex checkout
      </span>

      <span>
       <Shield/>
       Premium per server
      </span>

      <span>
       <Zap/>
       Automatic activation
      </span>

     </div>

    </div>

    <div className="bmShopPriceCard">

     <span>
      VIP ACCESS
     </span>

     <div className="bmShopPrice">

      <strong>
       €7.99
      </strong>

      <small>
       / 30 days
      </small>

     </div>

     <p>
      {
       vipActive
        ?(
         expires
          ?`Active until ${expires}`
          :"Premium is active"
        )
        :(
         guild
          ?`For ${guild.name}`
          :"Choose a Discord server after login"
        )
      }
     </p>

     <button
      type="button"
      className="bmShopCta"
      onClick={startCheckout}
      disabled={
       starting||
       (!selectedGuild&&!!user)
      }
     >

      {
       starting
        ?(
         <>
          <Loader2 className="spin"/>
          OPENING…
         </>
        )
        :(
         <>
          <Crown/>

          {
           vipActive
            ?"EXTEND VIP"
            :"BUY VIP"
          }

          <ArrowRight/>
         </>
        )
      }

     </button>

     {
      !user
       ?(
        <a
         className="bmShopLogin"
         href="/api/auth/login?return=/premium"
        >
         <DiscordLogo/>
         <span>
          LOGIN WITH DISCORD
         </span>
        </a>
       )
       :null
     }

    </div>

   </div>

   {
    user&&(
     <div className="bmShopServerBar">

      <div className="bmShopServerIdentity">

       <div className="bmShopServerIcon">

        {
         guild?.icon
          ?(
           <img
            src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`}
            alt=""
           />
          )
          :<Server/>
        }

       </div>

       <div>

        <span>
         SELECTED SERVER
        </span>

        <b>
         {
          guild?.name||
          "Select a server"
         }
        </b>

        <small>
         {
          selectedGuild
           ?`Guild ID: ${selectedGuild}`
           :"Choose a server from the top-right server selector."
         }
        </small>

       </div>

      </div>

      <div
       className={`bmShopStatus ${
        vipActive
         ?"active"
         :"free"
       }`}
      >

       <CheckCircle2/>

       <span>
        {
         plan.loading
          ?"CHECKING"
          :(
           vipActive
            ?"VIP ACTIVE"
            :"FREE PLAN"
          )
        }
       </span>

       {
        vipActive&&plan.remaining
         ?(
          <small>
           {plan.remaining} left
          </small>
         )
         :null
       }

      </div>

     </div>
    )
   }

   <div className="bmShopCompare">

    <div className="bmShopPlan free">

     <div className="bmShopPlanHead">

      <span>
       COMMUNITY
      </span>

      <b>
       Free
      </b>

      <strong>
       €0
      </strong>

      <small>
       Always available
      </small>

     </div>

     <ul>

      {
       FREE_FEATURES.map(
        x=>(
         <li key={x}>
          <CheckCircle2/>
          <span>{x}</span>
         </li>
        )
       )
      }

     </ul>

    </div>

    <div className="bmShopPlan vip">

     <div className="bmShopRibbon">
      MOST COMPLETE
     </div>

     <div className="bmShopPlanHead">

      <span>
       PREMIUM
      </span>

      <b>
       VIP
      </b>

      <strong>
       €7.99
      </strong>

      <small>
       30 days · one Discord server
      </small>

     </div>

     <ul>

      {
       VIP_FEATURES
        .slice(0,6)
        .map(
         ([title])=>(
          <li key={title}>
           <CheckCircle2/>
           <span>
            {title}
           </span>
          </li>
         )
        )
      }

     </ul>

     <button
      type="button"
      className="bmShopCta wide"
      onClick={startCheckout}
      disabled={
       starting||
       (!selectedGuild&&!!user)
      }
     >

      <Crown/>

      {
       vipActive
        ?"EXTEND VIP"
        :"GET VIP"
      }

     </button>

    </div>

   </div>

   <div className="bmShopFeatures">

    <div className="bmShopSectionHead">

     <div>

      <span>
       WHAT VIP UNLOCKS
      </span>

      <h4>
       Everything that makes BalticM easier to run
      </h4>

     </div>

     <Crown/>

    </div>

    <div className="bmShopFeatureGrid">

     {
      VIP_FEATURES.map(
       ([title,copy],i)=>(
        <article key={title}>

         <div className="bmShopFeatureIcon">

          {
           i===0
            ?<Crown/>
            :i===1
             ?<Zap/>
             :i===2
              ?<CreditCard/>
              :i===3
               ?<Server/>
               :i===4
                ?<Shield/>
                :<Gift/>
          }

         </div>

         <b>
          {title}
         </b>

         <p>
          {copy}
         </p>

        </article>
       )
      )
     }

    </div>

   </div>

   <div className="bmShopFooterNote">

    <LockKeyhole/>

    <div>

     <b>
      Checkout and billing are handled by Tebex
     </b>

     <span>
      BalticM creates the basket for the selected server.
      Premium activates only after Tebex confirms the successful payment.
     </span>

    </div>

   </div>

   {
    notice&&(
     <div className="bmShopNotice">
      <Shield/>
      <span>
       {notice}
      </span>
     </div>
    )
   }

   {
    checkout&&(
     <div
      className="bmCheckoutBackdrop"
      role="presentation"
     >

      <div
       className="bmCheckoutModal"
       role="dialog"
       aria-modal="true"
       aria-label="BalticM Premium checkout"
      >

       <div className="bmCheckoutHeader">

        <div>

         <span>
          BALTICM PREMIUM
         </span>

         <b>
          Secure checkout
         </b>

        </div>

        <button
         type="button"
         onClick={closeCheckout}
         aria-label="Close checkout"
        >
         <X/>
        </button>

       </div>

       <div className="bmCheckoutGrid">

        <div className="bmCheckoutPayment">

         {
          checkoutError
           ?(
            <div className="bmCheckoutError">

             <Shield/>

             <b>
              Payment form did not load
             </b>

             <span>
              {checkoutError}
             </span>

             {
              checkout.checkoutUrl
               ?(
                <a
                 href={checkout.checkoutUrl}
                 target="_blank"
                 rel="noreferrer"
                >
                 Open Tebex checkout
                 <ExternalLink/>
                </a>
               )
               :null
             }

            </div>
           )
           :(
            <div
             className="bmTebexHost"
             ref={hostRef}
            />
           )
         }

        </div>

       </div>

      </div>

     </div>
    )
   }

  </div>
 );
}
