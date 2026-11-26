/* ===== SkyClear UI ===== */
const LIMITS={wind:17,gust:22,minVis:3,tempLo:40,tempHi:95};
const DEV_FIXED_LOCATION=false; // false: ask the device GPS on load, fall back to the first preset (LAX). true: always start on the first preset.
const WX_PROXY="/api/wx"; // server-side relay (api/wx.js on Vercel). Browsers cannot call aviationweather.gov directly (CORS).
const MANUAL=[
 {g:"Pilot confirmations",items:[
  ["cert","Remote Pilot Certificate (Part 107) in my possession","Carry it on the flight. Show it to the FAA or law enforcement on request."],
  ["trn","Recurrent training current (every 24 calendar months)","Free online course at faasafety.gov."],
  ["fit","Fit to fly (IMSAFE)","Illness, medication, stress, alcohol, fatigue, eating."]]},
 {g:"Registration and Remote ID confirmations",items:[
  ["reg","Drone registered in FAA DroneZone, number marked on the outside of the aircraft","Part 107 aircraft use the commercial registration. It lasts 3 years."],
  ["rid","Remote ID broadcast is on and working","Standard Remote ID, or a broadcast module attached to the aircraft."],
  ["ridm","Remote ID serial or session ID matches the registration record","The ID in the broadcast must match what DroneZone shows."]]},
 {g:"Aircraft",items:[
  ["batt","Batteries charged and healthy, spares ready",""],
  ["prop","Propellers, frame, gimbal and arms inspected",""],
  ["fw","Firmware, SD card, compass and GPS lock confirmed","Wait for a solid satellite count before launch."],
  ["rth","Return-to-home altitude set above obstacles, failsafe checked",""]]},
 {g:"Operation",items:[
  ["tfr","TFRs checked for this location and time","Open tfr.faa.gov or the FAA B4UFLY map. This app does not read TFRs yet."],
  ["sua","Restricted, warning, MOA and prohibited areas checked on the chart","Shown shaded on the sectional. None are modeled in this preview."],
  ["notam","NOTAMs reviewed for the area and time","Use the FAA NOTAM search for the launch point."],
  ["area","Launch area surveyed for obstacles, wires and people",""],
  ["ppl","No flight over uninvolved people, area kept clear","Unless the operation qualifies under the over-people rules."],
  ["los","Visual line of sight kept, visual observer briefed if used",""],
  ["perm","Landowner permission and state or local rules checked","Parks, schools and private property often have their own rules."],
  ["plan","Flight plan and emergency landing area agreed",""]]}
];
const RIDNAME={std:"Standard Remote ID",mod:"Broadcast module",fria:"FRIA"};
const MANUAL_IDS=MANUAL.flatMap(g=>g.items.map(i=>i[0]));

const $=s=>document.querySelector(s);
const esc=t=>String(t==null?"":t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ICON={pass:"✓",caution:"!",fail:"✕",hold:"…"};
const fmt1=n=>n.toFixed(1);
const p=n=>String(n).padStart(2,"0");
const tfmt=d=>d?d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):"n/a";

const S={
  loc:{lat:PRESETS[0].lat,lon:PRESETS[0].lon,acc:null,alt:null,src:"preset",label:PRESETS[0].name,presetElev:PRESETS[0].elev},
  radius:5,wxSel:0,manual:{},laanc:"",pilot:"",cert:"",certDate:"",trnDate:"",model:"",reg:"",regExp:"",ridType:"",ridId:"",
  scanAt:new Date(),scanId:newId(),
  gps:{state:"idle",msg:""},
  wx:{mode:"loading",at:null,stations:[],metar:{},taf:{},err:""},
  elev:{ft:null,src:""},place:{text:"",src:""},faa:{state:"none",surface:[],grid:null},
  token:0
};
function newId(){const d=new Date();return "SC-"+String(d.getFullYear()).slice(2)+p(d.getMonth()+1)+p(d.getDate())+"-"+p(d.getHours())+p(d.getMinutes())+"-"+Math.floor(Math.random()*65536).toString(16).toUpperCase().padStart(4,"0")}

/* ---- network helpers ---- */
async function fetchTxt(url,ms){
  const ac=new AbortController();const to=setTimeout(()=>ac.abort(),ms||7000);
  try{const r=await fetch(url,{signal:ac.signal});if(!r.ok)throw new Error("HTTP "+r.status);return await r.text()}finally{clearTimeout(to)}
}
async function fetchJson(url,ms){return JSON.parse(await fetchTxt(url,ms))}

function awc(kind,qs){return WX_PROXY?WX_PROXY+"?path="+kind+"&"+qs:"https://aviationweather.gov/api/data/"+kind+"?"+qs}

/* ---- derived ---- */
function derived(){
  const list=around(S.loc.lat,S.loc.lon);
  const nearB=list.find(a=>a.cls==="B"),nearC=list.find(a=>a.cls==="C"),nearD=list.find(a=>a.cls==="D");
  const towered=list.filter(a=>a.twr).slice(0,3);
  const inRadius=list.filter(a=>a.dist<=S.radius);
  const wxStations=list.filter(a=>a.icao&&a.wx).slice(0,3);
  const sun=sunTimes(S.loc.lat,S.loc.lon,new Date());
  return {list,nearB,nearC,nearD,towered,inRadius,wxStations,sun};
}
/* METAR age (roadmap 4): over 75 min old = stale (amber), over 2 h = red. */
const WX_STALE_MIN=75,WX_OLD_MIN=120;
function obsInfo(icao){
  const o=S.wx.mode==="live"&&S.wx.obs&&S.wx.obs[icao];if(!o||!isFinite(o.obsTime))return null;
  const at=new Date(o.obsTime*1000),min=Math.max(0,Math.round((Date.now()-at.getTime())/60000));
  return {at,min,k:min>WX_OLD_MIN?"old":min>WX_STALE_MIN?"stale":"ok"};
}
const zfmt=d=>d?p(d.getUTCHours())+p(d.getUTCMinutes())+"Z":"n/a";
const agoTxt=m=>m<60?m+" min ago":Math.floor(m/60)+" h "+(m%60)+" min ago";
const stamp=d=>d?tfmt(d)+" local · "+zfmt(d):"not loaded";
function currentWx(D){
  const st=D.wxStations[Math.min(S.wxSel,D.wxStations.length-1)];if(!st)return null;
  const raw=S.wx.metar[st.icao];if(!raw)return {st,m:null};
  return {st,m:decodeMetar(raw),raw,tafRaw:S.wx.taf[st.icao]};
}
function groundElev(){
  if(S.elev.ft!=null)return {ft:S.elev.ft,src:S.elev.src};
  if(S.loc.presetElev!=null)return {ft:S.loc.presetElev,src:"approximate, from the location preset"};
  if(S.loc.alt!=null)return {ft:Math.round(S.loc.alt*3.281),src:"device GPS altitude"};
  return {ft:null,src:"unavailable"};
}

/* ---- checks ---- */
/* GPS rule (roadmap 1). Weak accuracy alone never blocks:
   - fail: no usable fix, or the fix is older than GPS_MAX_AGE
   - caution: accuracy worse than GPS_GOOD_M (likely Wi-Fi/network location), or the accuracy circle
     crosses an approximate ring edge, an FAA airspace boundary or a LAANC grid cell edge,
     or the FAA boundary check could not run
   - pass: a close fix whose accuracy circle stays inside one airspace and one grid ceiling */
const GPS_GOOD_M=50,GPS_MAX_AGE=5*60000;
function ringEdges(D,acc){const out=[];D.list.forEach(a=>{const r=a.cls==="B"?6:a.cls==="C"?RING.C:a.cls==="D"?RING.D:null;if(r==null)return;const m=Math.abs(a.nm-r)*NM*1609.344;if(m<=acc)out.push(a.id+" ring edge "+Math.round(m)+" m away")});return out}
function gpsCheck(D){
  const L=S.loc,acc=L.acc;
  if(acc==null||!isFinite(acc)||!isFinite(L.lat)||!isFinite(L.lon))return {s:"fail",d:"No usable GPS fix. Press Use my GPS again, drop a pin, or type coordinates."};
  const age=L.fixAt?Date.now()-L.fixAt:0;
  if(age>GPS_MAX_AGE)return {s:"fail",d:"This GPS fix is "+Math.round(age/60000)+" min old. Press Use my GPS again at the launch point."};
  const hint=" Approximate location. Drop a pin on your launch spot.";
  const why=ringEdges(D,acc),E=S.faa.edge;
  if(E&&E.checked){if(E.air)why.push("an FAA airspace boundary ("+E.air+")");if(E.grid)why.push("a LAANC grid edge (ceilings "+E.ceilings.join(" / ")+" ft within your accuracy)")}
  if(why.length)return {s:"caution",d:"Your ±"+Math.round(acc)+" m accuracy circle crosses "+why.join("; ")+". You could be on either side."+hint,src:"FAA layers"+(E&&E.checked?" · checked within ±"+Math.round(acc)+" m":"")};
  if(acc>GPS_GOOD_M)return {s:"caution",d:"Accuracy ±"+Math.round(acc)+" m is typical of a computer or indoor phone (Wi-Fi or network location)."+hint};
  if(!E||!E.checked)return {s:"caution",d:S.faa.state==="none"?"Checking FAA airspace near your position…":"The FAA boundary check within your accuracy did not run. Drop a pin to confirm the launch spot."};
  return {s:"pass",d:"Your ±"+Math.round(acc)+" m accuracy circle stays inside one airspace and one LAANC grid ceiling."};
}
// The LAANC grid ceiling to fly by: the point value, or the lowest cell inside a GPS accuracy circle that crosses a grid edge.
function effGrid(){const g=S.faa.grid,E=S.faa.edge;if(S.loc.src==="gps"&&E&&E.checked&&E.grid&&E.gridMin!=null)return g==null?E.gridMin:Math.min(g,E.gridMin);return g}
/* Ceiling to fly by (roadmap 2). Source: FAA UAS Facility Map (FAA AIS ArcGIS org, verified 2026-11-25).
   k: "ok" (ft known) · "zero" (grid 0 = no automatic LAANC) · "checking" (FAA layer still loading)
      · "nogrid" (controlled airspace but no UAS Facility Map cell here) · "unk" (FAA lookup failed). */
const faaWhy=()=>S.faa.reason?" ("+S.faa.reason+")":"";
function gridCellsTxt(){const c=S.faa.cells||[];if(!c.length)return "";return c.map(x=>x.ceil+" ft"+(x.apts.length?" ("+x.apts.map(a=>a.id+" "+a.name+(a.laanc?"":", LAANC not enabled")).join("; ")+")":"")).join(" · ")+(c.length>1?". The lowest is used.":"")}
function ceilState(controlled){
  if(S.faa.state==="none")return {k:"checking",ft:null};
  if(S.faa.state!=="live"||(controlled&&S.faa.gridErr))return {k:"unk",ft:null};
  const g=effGrid();
  if(controlled){if(g==null)return {k:"nogrid",ft:null};if(g<=0)return {k:"zero",ft:0};return {k:"ok",ft:Math.min(400,g)}}
  return {k:"ok",ft:g!=null?Math.min(400,g):400};
}
function buildChecks(D){
  const C=[];const add=(group,id,label,status,value,detail,src)=>C.push({group,id,label,status,value,detail:detail||"",src:src||""});
  const L=S.loc,now=new Date();
  // location
  if(L.src==="gps"){const g=gpsCheck(D);add("Location","gps","GPS position",g.s,L.lat.toFixed(4)+", "+L.lon.toFixed(4)+"  ±"+Math.round(L.acc)+" m",g.d,"Device GPS"+(g.src?" · "+g.src:""))}
  else if(L.pin)add("Location","gps","Position",L.pinOk?"pass":"caution",L.lat.toFixed(4)+", "+L.lon.toFixed(4)+(L.pinOk?"  pin confirmed":"  pin not confirmed"),L.pinOk?"You confirmed this pin is your launch spot.":"Check the pin is exactly on your launch spot, then press Confirm pin under the map.","Dropped pin");
  else if(L.src==="address")add("Location","gps","Position","caution",L.lat.toFixed(4)+", "+L.lon.toFixed(4),"Looked up from an address: "+(L.label||"")+". An address point can be off by a building or more, so check the pin on the map, and use the GPS button at the launch point.","Address lookup · "+(L.geoSrc||""));
  else add("Location","gps","Position","caution",L.lat.toFixed(4)+", "+L.lon.toFixed(4),"Entered by hand or picked from a preset, not read from a GPS. Use the GPS button when you are at the launch point.","Manual entry");
  const cd=new Date(CHART.to+"T23:59:59"),cf=new Date(CHART.from+"T00:00:00");
  const okc=now>=cf&&now<=cd;
  if(typeof NASR_EFF!=="undefined"){const ne=new Date(NASR_EFF+"T00:00:00"),nx=new Date(ne.getTime()+28*86400000),okn=now>=ne&&now<nx;
    add("Location","nasr","Airport data currency",okn?"pass":"caution","FAA NASR · effective "+NASR_EFF,okn?"Airport frequencies and classes come from this 28-day FAA cycle.":now<ne?"This FAA data cycle starts "+NASR_EFF+"; the frequencies shown are the upcoming ones.":"This FAA data cycle has ended. Regenerate src/airports_nasr.js from the current NASR edition.","FAA NASR")}
  add("Location","chart","Chart currency",okc?"pass":"caution",CHART.name+" · valid "+CHART.from+" to "+CHART.to,okc?"Frequencies and airport data come from this chart cycle.":"The chart cycle has ended. Load the new Los Angeles Sectional.","Uploaded sectional");
  // airspace
  const hits=approxAir(D.list);let controlled=false,clsTxt,clsStatus,clsDetail,src;
  if(S.faa.state==="live"){
    controlled=S.faa.surface.length>0;
    clsTxt=controlled?S.faa.surface.map(f=>"Class "+f.cls+(f.name?" · "+f.name:"")).join(" · "):"No controlled surface airspace";
    clsStatus=controlled&&S.laanc.trim().length<6?"caution":"pass";clsDetail=controlled?"The FAA airspace layer reports controlled airspace reaching the ground here. Authorization is required.":"The FAA airspace layer shows no controlled airspace at the surface here.";src="FAA airspace layer · live";
  } else {
    controlled=hits.length>0;const order={B:0,C:1,D:2};hits.sort((a,b)=>order[a.cls]-order[b.cls]);
    if(controlled){clsTxt=hits.map(h=>"Class "+h.cls+" ("+h.a.id+")").join(" · ");clsStatus=S.laanc.trim().length<6?"caution":"pass";clsDetail="Approximate: you are "+hits.map(h=>h.why).join("; ")+". Treat this as controlled airspace and request authorization.";}
    else{clsTxt="No controlled surface area in the approximate model";clsStatus="caution";clsDetail="Rings are approximate. Confirm on the sectional chart or the FAA UAS Facility Map before flying.";}
    src="Approximate rings from the chart airport list";
  }
  add("Airspace","class","Airspace at launch point",clsStatus,clsTxt,clsDetail,src);
  if(controlled){
    const have=S.laanc.trim().length>=6;
    add("Airspace","laanc","Authorization (LAANC)",have?"pass":"hold",have?"Auth "+S.laanc.trim().toUpperCase():"Needed before launch",
      (effGrid()!=null?"Facility-map grid ceiling here: "+effGrid()+" ft AGL. ":"Look up the grid ceiling in your LAANC app. ")+"Request authorization, then enter the number below.","FAA UAS Facility Map / LAANC");
  }
  const near=D.list.filter(a=>a.dist<=3);
  add("Airspace","apt","Airports within 3 mi",near.length&&!controlled?"caution":"pass",near.length?near.map(a=>a.id+" "+fmt1(a.dist)+" mi").join(" · "):"None",near.length?"Manned aircraft may be low and close. "+(controlled?"Your authorization covers the controlled airspace, not the traffic.":"Consider calling the airport operator."):"No charted airports inside the 3 mi ring.","Chart airport list");
  // altitude
  const ge=groundElev();const gridUse=effGrid();const CS=ceilState(controlled),cap=CS.ft;
  add("Altitude","elev","Ground elevation (MSL)",ge.ft==null?"caution":"pass",ge.ft==null?"Not available":ge.ft+" ft MSL",
    (S.loc.alt!=null&&ge.ft!=null?"Device GPS reports "+Math.round(S.loc.alt*3.281)+" ft. ":"")+"AGL is height above the ground at your feet. MSL is height above sea level.",ge.src);
  const haveAuth=S.laanc.trim().length>=6;
  if(CS.k==="checking")add("Altitude","ceil","Maximum legal altitude","caution","Checking the FAA UAS Facility Map…","","FAA UAS Facility Map");
  else if(CS.k==="nogrid")add("Altitude","ceil","Maximum legal altitude","caution","No UAS Facility Map grid here","The FAA lookup worked but has no LAANC grid cell at this point inside controlled airspace, so LAANC can't approve it automatically. Use an FAA authorization from DroneZone; do not assume 400 ft.","FAA UAS Facility Map");
  else if(CS.k==="unk")add("Altitude","ceil","Maximum legal altitude","caution","Ceiling not confirmed","The FAA data could not be loaded"+faaWhy()+". Do not assume 400 ft: check the FAA UAS Facility Map or your LAANC app, or press Refresh.","FAA UAS Facility Map");
  else if(CS.k==="zero")add("Altitude","ceil","Maximum legal altitude",haveAuth?"caution":"fail","0 ft AGL · no automatic LAANC",(haveAuth?"The LAANC grid is 0 ft here. Fly only as your FAA authorization allows.":"No automatic LAANC here: further coordination or waiver needed.")+(gridCellsTxt()?" Grid: "+gridCellsTxt():""),"FAA UAS Facility Map");
  else add("Altitude","ceil","Maximum legal altitude","pass",cap+" ft AGL"+(ge.ft!=null?" = "+(ge.ft+cap)+" ft MSL":""),gridUse!==S.faa.grid?"Limited by the lowest LAANC grid cell inside your GPS accuracy circle ("+(S.faa.grid==null?"no grid value":S.faa.grid+" ft")+" at the exact point). Drop and confirm a pin to use the exact cell.":gridUse!=null&&gridUse<400?"Limited by the LAANC grid: "+gridCellsTxt():(S.faa.cells&&S.faa.cells.length?"LAANC grid: "+gridCellsTxt():"No UAS Facility Map grid here; outside controlled airspace the standard limit applies.")+" 400 ft AGL is the Part 107 limit (or within 400 ft of a structure).",gridUse!=null?"FAA UAS Facility Map · 14 CFR 107.51":"14 CFR 107.51");
  // weather
  const W=currentWx(D);
  if(W&&W.m){
    const m=W.m,sta=W.st.icao,ago=S.wx.mode==="live"?"live":"SAMPLE";
    const src="METAR "+sta+" · "+ago;
    const oi=obsInfo(sta);
    if(S.wx.mode==="live")add("Weather","wxage","Report age",oi?(oi.k==="old"?"fail":oi.k==="stale"?"caution":"pass"):"caution",oi?"Observed "+zfmt(oi.at)+" · "+agoTxt(oi.min):"Observation time not reported",oi&&oi.k!=="ok"?"This METAR is "+(oi.k==="old"?"over 2 hours":"over 75 minutes")+" old. Press Refresh, try another station, or get a current briefing before flying.":"METARs are issued about once an hour.",src);
    const sp=m.wind?m.wind.spd:0,gs=m.wind&&m.wind.gust?m.wind.gust:null;
    add("Weather","wind","Wind",sp>LIMITS.wind?"fail":sp>=LIMITS.wind*0.8?"caution":"pass",m.wind?(m.wind.dir==="VRB"?"Variable":m.wind.dir+"°")+" at "+sp+" kt":"Not reported","Aircraft limit set to "+LIMITS.wind+" kt sustained (about 20 mph).",src);
    add("Weather","gust","Gusts",gs==null?"pass":gs>LIMITS.gust?"fail":gs>=LIMITS.gust*0.8?"caution":"pass",gs==null?"None reported":gs+" kt","Aircraft limit set to "+LIMITS.gust+" kt gusts.",src);
    const v=m.vis;add("Weather","vis","Visibility",v==null?"caution":v<LIMITS.minVis?"fail":v<5?"caution":"pass",v==null?"Not reported":(v>=10?"10+":v)+" SM","Part 107 minimum is 3 statute miles.",src);
    const cap2=cap;let cs="pass",cv=m.sky.length?"":"No ceiling",cd="";
    if(m.ceiling){const room=m.ceiling-500;cv="Ceiling "+m.ceiling.toLocaleString()+" ft AGL";if(room<=0){cs="fail";cd="Leaves no room for the required 500 ft below clouds."}else if(room<cap2){cs="caution";cd="Stay under "+room+" ft AGL to keep 500 ft below the clouds."}else cd="500 ft below clouds holds up to your maximum altitude."} else cd="No broken or overcast layer reported.";
    add("Weather","cloud","Cloud clearance",cs,cv,cd,src);
    const tf=m.temp==null?null:Math.round(m.temp*9/5+32);
    add("Weather","temp","Temperature",tf==null?"caution":tf<LIMITS.tempLo||tf>LIMITS.tempHi?"caution":"pass",tf==null?"Not reported":tf+" °F ("+m.temp+" °C)",tf!=null&&(tf<LIMITS.tempLo||tf>LIMITS.tempHi)?"Outside the typical battery range of "+LIMITS.tempLo+" to "+LIMITS.tempHi+" °F.":"Within battery range.",src);
    const wxs=m.wx.join(" ");const wet=/(RA|DZ|SN|PL|SG|IC|UP|GR|GS|TS|FC)/.test(wxs);const bad=/(TS|FC|GR|GS|\+)/.test(wxs);
    add("Weather","precip","Precipitation",wet?(bad?"fail":"caution"):"pass",wet?m.wx.join(" "):"None reported",wet?"Most consumer drones are not rated for rain or snow.":"",src);
  } else add("Weather","wx","Weather report","caution","Not loaded","Press Refresh to pull METAR and TAF.","");
  // daylight
  const s=D.sun;let ds="pass",dv="",dd="";
  if(s.sunrise&&s.sunset){
    if(now>=s.sunrise&&now<=s.sunset){const mins=Math.round((s.sunset-now)/60000);dv="Daylight · sunset "+tfmt(s.sunset)+" ("+Math.floor(mins/60)+" h "+mins%60+" min)"}
    else if((now>s.sunset&&now<=s.civilEnd)||(now>=s.civilBegin&&now<s.sunrise)){ds="caution";dv="Civil twilight · sunrise "+tfmt(s.sunrise)+", sunset "+tfmt(s.sunset);dd="Anti-collision lights visible for 3 SM are required."}
    else{ds="caution";dv="Night · sunrise "+tfmt(s.sunrise)+", sunset "+tfmt(s.sunset);dd="Night flight needs anti-collision lights visible for 3 SM and current night training."}
  } else dv="Sun times unavailable";
  add("Weather","sun","Daylight",ds,dv,dd,"Computed for your position");
  return {C,controlled};
}
function overall(C){
  const f=C.filter(c=>c.status==="fail"),h=C.filter(c=>c.status==="hold"),w=C.filter(c=>c.status==="caution");
  const left=MANUAL_IDS.filter(id=>!S.manual[id]).length;
  if(f.length)return {k:"stop",t:"No-go",d:f.length+" blocking condition"+(f.length>1?"s":"")+": "+f.map(c=>c.label.toLowerCase()).join(", ")+"."};
  if(h.length)return {k:"hold",t:"Hold",d:"Authorization is needed before launch. Enter the LAANC authorization number below."};
  if(left)return {k:"info",t:"Incomplete",d:left+" pilot confirmation"+(left>1?"s":"")+" remaining."+(w.length?" "+w.length+" caution"+(w.length>1?"s":"")+" noted.":"")};
  if(w.length)return {k:"warn",t:"Go with cautions",d:w.length+" caution"+(w.length>1?"s":"")+": "+w.map(c=>c.label.toLowerCase()).join(", ")+"."};
  return {k:"go",t:"Go",d:"All checks passed and the pilot confirmed every item."};
}

/* ---- graphics ---- */
function altViz(){
  const ge=groundElev(),CS=ceilState(LAST.controlled),cap=CS.ft==null?0:CS.ft,k=70/400,gy=104,top=gy-400*k,cy=gy-cap*k;
  const capTxt=CS.k==="ok"?cap+" ft AGL max":CS.k==="zero"?"0 ft: no automatic LAANC":CS.k==="nogrid"?"no grid here":"ceiling not confirmed",capCol=CS.k==="ok"?"#3fcf8e":CS.k==="zero"?"#ff6161":"#f5b83d";
  return `<svg viewBox="0 0 300 130" role="img" aria-label="Altitude diagram"><rect x="0" y="${gy}" width="300" height="26" fill="#27405a"/>
  <text x="8" y="${gy+17}" font-size="11" fill="#e8f0f7" font-family="IBM Plex Mono,monospace">Ground ${ge.ft==null?"?":ge.ft} ft MSL</text>
  <line x1="0" y1="${top}" x2="300" y2="${top}" stroke="#8fa6ba" stroke-dasharray="4 4"/><text x="8" y="${top-4}" font-size="10" fill="#8fa6ba" font-family="IBM Plex Mono,monospace">400 ft AGL standard limit</text>
  ${CS.k==="ok"?`<rect x="190" y="${cy}" width="40" height="${gy-cy}" fill="#3fcf8e" fill-opacity=".25" stroke="#3fcf8e"/>`:""}<line x1="150" y1="${cy}" x2="300" y2="${cy}" stroke="${capCol}" stroke-width="2"${CS.k==="ok"?"":' stroke-dasharray="3 3"'}/>
  <text x="152" y="${cy+(cap<150?-5:14)}" font-size="11" fill="${capCol}" font-family="IBM Plex Mono,monospace">${capTxt}</text>
  ${ge.ft!=null&&CS.k==="ok"?`<text x="236" y="${gy-6}" font-size="10" fill="#e8f0f7" font-family="IBM Plex Mono,monospace">${ge.ft+cap} MSL</text>`:""}</svg>`;
}

/* ---- render pieces ---- */
function rowHTML(c){return `<div class="row"><div class="chip s-${c.status}" aria-label="${c.status}">${ICON[c.status]}</div><div><div class="l">${esc(c.label)}</div><div class="v">${esc(c.value)}</div>${c.detail?`<div class="d">${esc(c.detail)}</div>`:""}<div class="src">${esc(c.src)}</div></div></div>`}
function pill(c){return `<span class="cat cat-${c}">${c}</span>`}
function classPill(a){return a.cls?`<span class="cls cls-${a.cls}">Class ${a.cls}</span>`:`<span class="cls cls-0">No tower</span>`}
function wherePanel(D){
  const L=S.loc,ge=groundElev(),s=D.sun,n=D.list[0];
  const kv=(k,v)=>`<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const place=S.place.text||(n.id+" "+fmt1(n.dist)+" mi "+compass(bearing(n.lat,n.lon,L.lat,L.lon))+" of the airport");
  return `<section class="grp"><h2>Where you are standing<small>${L.src==="gps"?"GPS fix":L.src==="preset"?"preset location":L.src==="address"?"address lookup":"manual position"}</small></h2>
  <div class="kvs">
   ${kv("Position",L.lat.toFixed(5)+", "+L.lon.toFixed(5))}
   ${kv("Degrees",dms(L.lat,"N","S")+"<br>"+dms(L.lon,"E","W"))}
   ${kv("Near",esc(place))}
   ${kv("Ground elevation",ge.ft==null?"n/a":ge.ft+" ft MSL<small>"+esc(ge.src)+"</small>")}
   ${kv("GPS accuracy",L.acc==null?"n/a":"±"+Math.round(L.acc)+" m"+(L.alt!=null?"<small>device altitude "+Math.round(L.alt*3.281)+" ft</small>":""))}
   ${kv("Chart",CHART.name+"<small>"+CHART.from+" to "+CHART.to+"</small>")}
   ${kv("Sunrise / sunset",tfmt(s.sunrise)+" / "+tfmt(s.sunset)+"<small>civil twilight ends "+tfmt(s.civilEnd)+"</small>")}
   ${kv("Nearest tower",esc(D.towered[0].id)+" · "+fmt1(D.towered[0].dist)+" mi "+compass(D.towered[0].brg))}
  </div></section>`;
}
function aroundPanel(D){
  const tile=(label,a)=>a?`<div class="tile"><div class="tl">${label}</div><div class="tn">${esc(a.id)} · ${esc(a.name)}</div><div class="tv">${fmt1(a.dist)} mi <small>${fmt1(a.nm)} NM · ${compass(a.brg)} (${Math.round(a.brg)}°)</small></div>${ringInfo(a)?`<div class="td">${a.nm<=ringInfo(a).r?"Inside the approximate surface area":"About "+fmt1(Math.max(0,(a.nm-ringInfo(a).r)*NM))+" mi to the approximate edge"}</div>`:`<div class="td">Class B tiers reach about 30 NM. Check floors on the chart.</div>`}</div>`:`<div class="tile"><div class="tl">${label}</div><div class="tn">None on this chart</div></div>`;
  const rows=D.inRadius.map(a=>`<tr><td><b>${esc(a.id)}</b></td><td>${esc(a.name)}</td><td>${classPill(a)}</td><td class="n">${fmt1(a.dist)} mi<small>${fmt1(a.nm)} NM</small></td><td class="n">${compass(a.brg)} ${Math.round(a.brg)}°</td></tr>`).join("");
  return `<section class="grp"><h2>Around you<small>${S.radius} mile radius</small></h2>
  <div class="seg" role="group" aria-label="Radius">${[3,5,10].map(r=>`<button data-r="${r}" aria-pressed="${S.radius===r}">${r} mi</button>`).join("")}</div>
  <p class="d2 pad">The map above shows these on the sectional chart. Shaded circles are approximations of the surface areas. Real shapes are irregular, so the chart and the FAA map decide.</p>
  <div class="tiles">${tile("Nearest Class B (Bravo)",D.nearB)}${tile("Nearest Class C (Charlie)",D.nearC)}${tile("Nearest Class D (Delta)",D.nearD)}</div>
  <div class="scroll"><table class="tb"><thead><tr><th>ID</th><th>Airport</th><th>Class</th><th>Distance</th><th>Bearing</th></tr></thead><tbody>${rows||`<tr><td colspan="5" class="muted">No charted airports inside ${S.radius} miles.</td></tr>`}</tbody></table></div></section>`;
}
function aptSrc(a){return a.src==="chart"?"Source: "+esc(CHART.name):"Source: FAA NASR, effective "+esc(typeof NASR_EFF!=="undefined"?NASR_EFF:"n/a")}
function facilitiesPanel(D){
  const cards=D.towered.map(a=>`<div class="fac"><div class="fh"><b>${esc(a.id)}</b> ${esc(a.name)} ${classPill(a)}<span class="fd">${fmt1(a.dist)} mi ${compass(a.brg)}</span></div>
   <dl><dt>Tower hours</dt><dd>${esc(a.hrs||"not listed")}</dd><dt>Tower</dt><dd>${esc(a.twr)}</dd><dt>Ground</dt><dd>${esc(a.gnd||"not listed")}</dd>${a.cd?`<dt>Clearance</dt><dd>${esc(a.cd)}</dd>`:""}<dt>ATIS</dt><dd>${esc(a.atis||(a.wx&&/\d/.test(a.wx)?a.wx:"not listed"))}</dd><dt>Approach</dt><dd>${esc(a.app||"not listed")}</dd>${a.ctaf?`<dt>CTAF</dt><dd>${esc(a.ctaf)}</dd>`:""}</dl><div class="fsrc">${aptSrc(a)}</div></div>`).join("");
  return `<section class="grp"><h2>Nearby towers and frequencies<small>3 nearest, for reference</small></h2><div class="facs">${cards}</div>
  <p class="foot2">Frequencies come from the margin tables of the ${CHART.name} (${CHART.from} to ${CHART.to}) for the airports SkyClear read off that chart, and from FAA NASR airport data (effective ${typeof NASR_EFF!=="undefined"?NASR_EFF:"n/a"}) for the rest. Tower hours are local time, and outside those hours the airspace may revert to Class E or G. Drone pilots do not check in with a tower or an FAA office. Request authorization through LAANC where the airspace needs it.</p></section>`;
}
function bdRows(items){return items.map(i=>`<tr><td class="tk">${esc(i.tok)}</td><td class="lb">${esc(i.label)}</td><td>${esc(i.text)}</td></tr>`).join("")}
function wxPanel(D){
  const mode=S.wx.mode,st=D.wxStations;
  const tabs=st.map((a,i)=>{const oi=obsInfo(a.icao);return `<button data-w="${i}" aria-pressed="${i===S.wxSel}">${esc(a.icao)}<small>${fmt1(a.dist)} mi${oi?` · <span class="age-${oi.k}">${oi.min<60?oi.min+"m":Math.floor(oi.min/60)+"h"+(oi.min%60?p(oi.min%60):"")}</span>`:""}</small></button>`}).join("");
  const W=currentWx(D);let body="";
  const banner=mode==="live"?`<div class="srcbar live">Live · aviationweather.gov · fetched ${tfmt(S.wx.at)}</div>`:mode==="loading"?`<div class="srcbar">Loading METAR and TAF…</div>`:`<div class="srcbar sample">Sample text. Live METAR and TAF need the weather proxy turned on (Requirements tab, Data sources).${S.wx.err?" ("+esc(S.wx.err)+")":""}</div>`;
  if(W&&W.m){
    const m=W.m;
    body+=`<div class="wxh"><b>${esc(W.st.icao)}</b> ${esc(W.st.name)} ${pill(m.cat)}</div>
    ${(()=>{const oi=obsInfo(W.st.icao);return oi?`<div class="obs obs-${oi.k}">Observed ${zfmt(oi.at)} (${tfmt(oi.at)} local) · <b>${agoTxt(oi.min)}</b>${oi.k==="old"?" · OLD, over 2 hours":oi.k==="stale"?" · STALE, over 75 min":""}</div>`:S.wx.mode==="live"?`<div class="obs obs-stale">Observation time not reported</div>`:""})()}
    <div class="lbl">METAR, standard format</div><pre class="raw">${esc(W.raw)}</pre>
    <div class="lbl">METAR, element by element</div><div class="scroll"><table class="bd">${bdRows(m.items)}</table></div>`;
    if(W.tafRaw){const t=decodeTaf(W.tafRaw);
      const ti=S.wx.tafAt&&S.wx.tafAt[W.st.icao];
      body+=`<div class="lbl">TAF, standard format</div>${ti?`<div class="obs">Issued ${zfmt(ti)} (${tfmt(ti)} local) · ${agoTxt(Math.max(0,Math.round((Date.now()-ti.getTime())/60000)))}</div>`:""}<pre class="raw">${esc(W.tafRaw)}</pre><div class="lbl">TAF, element by element</div>`;
      body+=`<div class="scroll"><table class="bd">${bdRows(t.head)}</table></div>`;
      t.groups.forEach(g=>{body+=`<div class="gh">${esc(g.head)} ${pill(g.cat)}</div><div class="scroll"><table class="bd">${bdRows(g.items)}</table></div>`});
    } else body+=`<p class="muted pad">No TAF is issued for this station.</p>`;
  } else body+=`<p class="muted pad">No report loaded yet.</p>`;
  return `<section class="grp"><h2>METAR and TAF<small>3 nearest reporting stations</small></h2>${banner}<div class="seg" role="group" aria-label="Station">${tabs}<button id="wxrefresh" class="rf">Refresh</button></div>${body}</section>`;
}

/* ---- main render ---- */
let LAST={};
function render(){
  const D=derived();const {C,controlled}=buildChecks(D);const ov=overall(C);LAST={D,C,ov,controlled};
  const loading=S.wx.mode==="loading";
  const ge0=groundElev(),CS0=ceilState(controlled),gridOk=CS0.k==="ok"||CS0.k==="zero",cap0=CS0.ft;
  const flyTxt=CS0.k==="ok"?cap0+" ft AGL":CS0.k==="zero"?"0 ft AGL":CS0.k==="checking"?"Checking…":CS0.k==="nogrid"?"No grid here":"Not confirmed",flyCls=CS0.k==="ok"?"":CS0.k==="zero"?" ceil-zero":" ceil-unk";
  const altNote=CS0.k==="zero"?`<p class="altwarn zero">No automatic LAANC here: further coordination or waiver needed. The FAA LAANC grid is 0 ft at this spot.</p>`:CS0.k==="nogrid"?`<p class="altwarn">No UAS Facility Map grid here, inside controlled airspace: LAANC can't approve this spot automatically. Use an FAA authorization from DroneZone; do not assume 400 ft.</p>`:CS0.k==="unk"?`<p class="altwarn">Ceiling not confirmed. The FAA data could not be loaded${esc(faaWhy())}. Do not assume 400 ft; use the altitude in your LAANC approval, or press Refresh.</p>`:"";
  const altl=`<div class="altline"><div class="flyup${flyCls}"><span>Fly up to</span><b>${flyTxt}</b></div><div><span>Equals</span><b>${ge0.ft==null||cap0==null?"? ft MSL":(ge0.ft+cap0)+" ft MSL"}</b></div><div><span>Ground here</span><b>${ge0.ft==null?"?":ge0.ft} ft MSL</b></div><div class="authl ${controlled?"need":"none"}"><span>Authorization</span><b>${controlled?(S.laanc?"LAANC "+esc(S.laanc.toUpperCase()):"LAANC needed"):"None needed"}</b></div></div>${altNote}`;
  laancNow(loading,controlled,cap0,gridOk,ge0,CS0);resWxLink(D);
  $("#banner").innerHTML=loading?`<div class="banner b-info"><div class="big">Scanning…</div><p>Reading position, airspace and weather.</p></div>`:`<div class="banner b-${ov.k}"><div class="big">${ov.t}</div><p>${esc(ov.d)}</p></div>${altl}`;
  $("#badge").textContent=S.wx.mode==="live"?"Live weather":S.wx.mode==="loading"?"Loading":"Preview · sample weather";
  $("#badge").className="badge "+(S.wx.mode==="live"?"ok":"");
  let html=wherePanel(D)+aroundPanel(D)+facilitiesPanel(D)+wxPanel(D);
  ["Airspace","Altitude","Weather","Location"].forEach(g=>{
    const rows=C.filter(c=>c.group===g);if(!rows.length)return;
    let body="";
    if(g==="Altitude")body+=`<div class="viz"><div>${altViz()}</div><div><div class="l">Height above ground and above sea level</div><p class="d2">The aircraft altitude readout is usually height above the takeoff point. Add ground elevation to compare with MSL charts.</p></div></div>`;
    body+=rows.map(rowHTML).join("");
    if(g==="Airspace"&&controlled)body+=fileLaancHTML(ceilState(controlled).k==="zero");
    if(g==="Airspace")body+=`<div class="fields"><div><label for="laanc">LAANC authorization number</label><input id="laanc" autocomplete="off" placeholder="${controlled?"Enter after approval":"Not required here"}" value="${esc(S.laanc)}" ${controlled?"":"disabled"}></div></div>`;
    html+=`<section class="grp"><h2>${g==="Location"?"Position and chart":g}<small>${rows.filter(c=>c.status==="pass").length}/${rows.length} clear</small></h2>${body}</section>`;
  });
  const done=MANUAL_IDS.filter(id=>S.manual[id]).length;
  const today=new Date();today.setHours(0,0,0,0);
  const addM=(ds,n)=>{if(!ds)return null;const d=new Date(ds+"T00:00:00");if(isNaN(d))return null;d.setMonth(d.getMonth()+n);return d};
  const dstat=(d,okTxt)=>d?(d<today?`<small class="bad">Expired ${d.toLocaleDateString()}</small>`:`<small class="ok">${okTxt} ${d.toLocaleDateString()}</small>`):"";
  const trnDue=addM(S.trnDate,24)&&(()=>{const d=addM(S.trnDate,25);d.setDate(1);d.setDate(0);return d})(); // end of 24th calendar month
  const regEnd=S.regExp?new Date(S.regExp+"T00:00:00"):null;
  const fld=(id,label,ph,val,extra)=>`<div><label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" placeholder="${ph}" autocomplete="off" ${extra||""}>`;
  let m=`<section class="grp"><h2>Pilot, drone and Remote ID<small>${done}/${MANUAL_IDS.length} confirmed</small></h2><div class="bar"><i style="width:${done/MANUAL_IDS.length*100}%"></i></div>
  <div class="saved">${hasProfile()?`<span>✓ Saved on this device. It fills in automatically next time.</span><button id="profclear" type="button">Clear saved info</button>`:`<span>Fill this in once. SkyClear saves it on this device only and fills it in every time you open the app.</span>`}</div>
  <div class="sub">Remote Pilot Certificate</div>
  <div class="fields"><div><label for="pilot">Pilot name</label><input id="pilot" value="${esc(S.pilot)}" placeholder="Full name" autocomplete="off"></div>
   ${fld("cert","Certificate number","Part 107 certificate no.",S.cert)}</div>
   <div><label for="certDate">Certificate issued</label><input id="certDate" type="date" value="${esc(S.certDate)}"></div>
   <div><label for="trnDate">Last recurrent training</label><input id="trnDate" type="date" value="${esc(S.trnDate)}">${dstat(trnDue,"Current through")}</div></div>
  <div class="sub">Drone registration</div>
  <div class="fields">${fld("model","Aircraft make and model","DJI Mavic 3, Skydio X10…",S.model)}</div>
   ${fld("reg","FAA registration number","FA3xxxxxxx",S.reg)}</div>
   <div><label for="regExp">Registration expires</label><input id="regExp" type="date" value="${esc(S.regExp)}">${dstat(regEnd,"Valid until")}</div></div>
  <div class="sub">Remote ID</div>
  <div class="fields"><div><label for="ridType">Compliance method</label><select id="ridType"><option value="">Choose…</option>${[["std","Standard Remote ID (built in)"],["mod","Broadcast module attached"],["fria","Flying inside an FRIA"]].map(o=>`<option value="${o[0]}" ${S.ridType===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select></div>
   ${fld("ridId","Remote ID serial or session ID","From the aircraft or module label",S.ridId)}</div></div>`;
  MANUAL.forEach(g=>{m+=`<div class="sub">${g.g}</div>`;g.items.forEach(([id,t,s])=>{m+=`<label class="todo"><input type="checkbox" data-id="${id}" ${S.manual[id]?"checked":""}><span><b>${esc(t)}</b>${s?`<small>${esc(s)}</small>`:""}</span></label>`})});
  html+=m+"</section>";
  const ae=document.activeElement,aid=ae&&ae.id,caret=ae&&ae.selectionStart;
  const sy=window.scrollY;$("#groups").innerHTML=html;window.scrollTo(0,sy);
  if(aid&&["laanc","pilot","cert","certDate","trnDate","model","reg","regExp","ridType","ridId"].includes(aid)){const e=document.getElementById(aid);if(e){e.focus();try{e.setSelectionRange(caret,caret)}catch(_){}}}
  const pk=$("#pinok");if(pk)pk.hidden=!(S.loc.pin&&!S.loc.pinOk);
  renderCard();
}
function renderCard(){
  const {D,C,ov}=LAST;const t=S.scanAt,L=S.loc;
  const local=t.getFullYear()+"-"+p(t.getMonth()+1)+"-"+p(t.getDate())+" "+p(t.getHours())+":"+p(t.getMinutes());
  const utc=p(t.getUTCHours())+":"+p(t.getUTCMinutes())+"Z";
  const cls={go:"c-go",warn:"c-warn",stop:"c-stop",hold:"c-hold",info:"c-info"}[ov.k];
  const done=MANUAL_IDS.filter(id=>S.manual[id]).length;const ge=groundElev();const W=currentWx(D);
  const rows=C.map(c=>`<tr><td class="m-${c.status}">${ICON[c.status]}</td><td>${esc(c.label)}</td><td class="v">${esc(c.value)}</td></tr>`).join("");
  const sample=S.wx.mode!=="live";
  $("#card").innerHTML=`<div class="sample ${sample?"":"liveb"}">${sample?"Preview · sample weather · not a real flight record":"Live weather · pilot self-certified record"}</div>
  <div class="head"><h3>Pre-flight<br>record</h3><div class="id">${S.scanId}<br><span id="valid"></span></div></div>
  <div class="st ${cls}">${S.wx.mode==="loading"?"Scanning…":ov.t}</div>
  <dl class="meta">
   <dt>Pilot</dt><dd>${esc(S.pilot||"not entered")}</dd><dt>Remote Pilot Cert</dt><dd>${esc(S.cert||"not entered")}</dd><dt>Aircraft</dt><dd>${esc(S.model||"not entered")}</dd><dt>Registration</dt><dd>${esc(S.reg||"not entered")}${S.regExp?" (exp "+esc(S.regExp)+")":""}</dd><dt>Remote ID</dt><dd>${esc(RIDNAME[S.ridType]||"not entered")}${S.ridId?" · "+esc(S.ridId):""}</dd>
   <dt>Position</dt><dd>${L.lat.toFixed(5)}, ${L.lon.toFixed(5)} (${posSrc(L)})</dd>
   <dt>Scanned</dt><dd>${local} local · ${utc}</dd>
   <dt>Ground / max</dt><dd>${ge.ft==null?"?":ge.ft} ft MSL / ${(()=>{const c=ceilState(LAST.controlled);return c.k==="ok"?c.ft+" ft AGL":c.k==="zero"?"0 ft AGL (no automatic LAANC)":c.k==="nogrid"?"no grid here":"not confirmed"})()}</dd>
   <dt>Nearest Class B</dt><dd>${D.nearB?D.nearB.id+" "+fmt1(D.nearB.dist)+" mi "+compass(D.nearB.brg):"n/a"}</dd>
   <dt>Authorization</dt><dd>${LAST.controlled?esc(S.laanc?"LAANC "+S.laanc.toUpperCase():"required, not yet entered"):"not required"}</dd>
   <dt>Weather</dt><dd>${W&&W.m?esc(W.st.icao)+" "+W.m.cat+(sample?" (sample)":""):"n/a"}</dd>
   <dt>Data times</dt><dd class="dtimes">${srcTimes(W).map(x=>esc(x[0])+": "+esc(x[1])).join("<br>")}</dd>
   <dt>Pilot checks</dt><dd>${done} of ${MANUAL_IDS.length} confirmed</dd></dl>
  <table aria-label="Check results">${rows}</table>
  <div class="foot"><div class="qr">QR to verify page in live build</div><div class="hash"><small>Record fingerprint (SHA-256)</small><span id="hash">…</span><small style="margin-top:4px">Any change to the record changes this code.</small></div></div>
  <div class="actions"><button id="copy">Copy record text</button></div><div class="copybox" id="copybox"></div>
  <div class="legal">Pilot self-certified record. It is not an FAA authorization or approval. The remote pilot in command stays responsible for compliance with 14 CFR Part 107 and for confirming every source before flight.</div>`;
  const rec={id:S.scanId,scanned:t.toISOString(),status:ov.t,pilot:S.pilot||null,cert:S.cert||null,reg:S.reg||null,regExp:S.regExp||null,model:S.model||null,ridType:S.ridType||null,ridId:S.ridId||null,trnDate:S.trnDate||null,laanc:S.laanc||null,lat:L.lat,lon:L.lon,src:L.src,metar:W&&W.raw||null,checks:C.map(c=>[c.id,c.status,c.value]),manual:MANUAL_IDS.map(id=>[id,!!S.manual[id]])};
  sha(JSON.stringify(rec)).then(h=>{const e=$("#hash");if(e)e.textContent=h.slice(0,32).toUpperCase().replace(/(.{8})/g,"$1 ").trim()});
  $("#copy").onclick=()=>copyText(ov,local,utc,W,D);tick();
}
async function sha(txt){try{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(txt));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}catch(e){let h=5381;for(const ch of txt)h=((h<<5)+h+ch.charCodeAt(0))>>>0;return h.toString(16).padStart(8,"0").repeat(8)}}
let LAST_MIN=-1;
function tick(){const mm=Math.floor(Date.now()/60000);if(mm!==LAST_MIN){const first=LAST_MIN<0;LAST_MIN=mm;if(!first&&S.wx.mode==="live")render()}if(S.loc.src==="gps"&&S.loc.fixAt&&!S.loc.stale&&Date.now()-S.loc.fixAt>GPS_MAX_AGE){S.loc.stale=true;render()}const e=$("#valid");if(!e)return;const mins=60-Math.floor((Date.now()-S.scanAt.getTime())/60000);e.textContent=mins>0?"valid "+mins+" min":"EXPIRED, rescan"}
setInterval(tick,15000);
function srcTimes(W){
  const oi=W&&W.st?obsInfo(W.st.icao):null;
  const c=S.faa.cells||[],eff=[...new Set(c.map(x=>x.eff).filter(Boolean))].join(", ");
  const gridTxt=S.faa.state==="none"?"loading":S.faa.state==="error"||S.faa.gridErr?"not confirmed"+faaWhy():c.length?Math.min(...c.map(x=>x.ceil))+" ft"+(c.length>1?" (lowest of "+c.length+" cells)":"")+" · "+[...new Set(c.flatMap(x=>x.apts.map(a=>a.id)))].join(", ")+" · FAA UAS Facility Map, map effective "+eff+", fetched "+stamp(S.faa.at)+(S.faa.viaRelay?" via SkyClear relay":""):"no UAS Facility Map grid here · checked "+stamp(S.faa.at);
  return [["LAANC grid",gridTxt],["METAR",S.wx.mode==="live"?(oi?"observed "+stamp(oi.at)+" ("+agoTxt(oi.min)+")":"time not reported")+", fetched "+stamp(S.wx.at):S.wx.mode==="loading"?"loading":"SAMPLE, not live"],
    ["Airspace",S.faa.state==="live"?"FAA Class Airspace layer, fetched "+stamp(S.faa.at)+(S.faa.viaRelay?" via SkyClear relay":""):S.faa.state==="error"?"FAA, could not load at "+stamp(S.faa.at)+faaWhy():"loading"],
    ["Ground elevation",S.elev.at?"USGS, fetched "+stamp(S.elev.at):S.loc.presetElev!=null&&S.loc.src==="preset"?"preset value":"not loaded"],
    ["TFR","not checked by SkyClear"]];
}
function posSrc(L){return L.src==="gps"?"GPS ±"+Math.round(L.acc)+" m":L.pin?(L.pinOk?"pin, confirmed":"pin, not confirmed"):L.src}
function copyText(ov,local,utc,W,D){
  const L=S.loc;
  const lines=["PRE-FLIGHT RECORD "+(S.wx.mode==="live"?"":"(PREVIEW, SAMPLE WEATHER) ")+S.scanId,"Status: "+ov.t,"Pilot: "+(S.pilot||"-")+" | Remote Pilot Cert: "+(S.cert||"-"),"Aircraft: "+(S.model||"-")+" | Reg: "+(S.reg||"-")+(S.regExp?" (exp "+S.regExp+")":"")+" | Remote ID: "+(RIDNAME[S.ridType]||"-")+" "+(S.ridId||""),"Position: "+L.lat.toFixed(5)+", "+L.lon.toFixed(5)+" ("+posSrc(L)+") | Scanned "+local+" local ("+utc+")","Nearest Class B: "+(D.nearB?D.nearB.id+" "+fmt1(D.nearB.dist)+" mi":"n/a"),""].concat(LAST.C.map(c=>"["+c.status.toUpperCase()+"] "+c.label+": "+c.value));
  if(W&&W.raw){lines.push("","METAR: "+W.raw);if(W.tafRaw)lines.push("TAF: "+W.tafRaw.replace(/\n\s*/g," "))}
  lines.push("","Data times:");srcTimes(W).forEach(x=>lines.push("  "+x[0]+": "+x[1]));
  lines.push("","Pilot checks: "+MANUAL_IDS.filter(id=>S.manual[id]).length+"/"+MANUAL_IDS.length,"Fingerprint: "+($("#hash")?$("#hash").textContent:""));
  const txt=lines.join("\n"),box=$("#copybox");const show=()=>{box.style.display="block";box.textContent=txt};
  try{navigator.clipboard.writeText(txt).then(()=>{$("#copy").textContent="Copied";setTimeout(()=>{const b=$("#copy");if(b)b.textContent="Copy record text"},1600)}).catch(show)}catch(e){show()}
}

/* ---- data loading ---- */
async function loadAll(){
  const tok=++S.token;S.scanAt=new Date();S.scanId=newId();
  S.wx.mode="loading";S.elev={ft:null,src:""};S.place={text:"",src:""};S.faa={state:"none",surface:[],grid:null};
  const D=derived();render();mapUpdate(true);
  const L=S.loc;
  const ids=D.wxStations.map(a=>a.icao);
  const jobs=[];
  jobs.push((async()=>{
    try{
      const [mj,tj]=await Promise.all([fetchJson(awc("metar","ids="+ids.join(",")+"&format=json"),9000),fetchJson(awc("taf","ids="+ids.join(",")+"&format=json"),9000).catch(()=>[])]);
      if(tok!==S.token)return;
      const metar={},taf={},obs={};
      (Array.isArray(mj)?mj:[]).forEach(o=>{const s=o.icaoId;if(s&&o.rawOb&&!metar[s]){metar[s]=o.rawOb;obs[s]=o}});
      const tafAt={};(Array.isArray(tj)?tj:[]).forEach(o=>{const s=o.icaoId;if(s&&o.rawTAF&&!taf[s]){taf[s]=o.rawTAF;const d=o.issueTime?new Date(o.issueTime):null;if(d&&!isNaN(d))tafAt[s]=d}});
      if(!Object.keys(metar).length)throw new Error("no METAR returned");
      S.wx={mode:"live",at:new Date(),stations:ids,metar,taf,obs,tafAt,err:""};
    }catch(e){
      if(tok!==S.token)return;
      const metar={},taf={};ids.forEach(i=>{const s=sampleWx(i);metar[i]=s.metar;taf[i]=s.taf});
      S.wx={mode:"sample",at:new Date(),stations:ids,metar,taf,err:e&&e.name==="AbortError"?"timed out":"blocked or offline"};
    }
    render();
  })());
  jobs.push((async()=>{try{const j=await fetchJson("https://epqs.nationalmap.gov/v1/json?x="+L.lon+"&y="+L.lat+"&units=Feet&wkid=4326&includeDate=false");if(tok!==S.token)return;const v=Number(j.value);if(isFinite(v)&&v>-500){S.elev={ft:Math.round(v),src:"USGS elevation service",at:new Date()};render()}}catch(e){}})());
  jobs.push((async()=>{try{const j=await fetchJson("https://api.weather.gov/points/"+L.lat.toFixed(4)+","+L.lon.toFixed(4));if(tok!==S.token)return;const r=j.properties.relativeLocation.properties;S.place={text:r.city+", "+r.state,src:"NWS"};render()}catch(e){}})());
  jobs.push((async()=>{
    try{
      const q=(svc,fields,r)=>"https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"+svc+"/FeatureServer/0/query?where=1%3D1&geometry="+L.lon+"%2C"+L.lat+"&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects"+(r?"&distance="+r+"&units=esriSRUnit_Meter":"")+"&outFields="+fields+"&returnGeometry=false&f=json";
      // Direct to the FAA (CORS allowed), one retry, then the backup relay /api/laanc. Errors keep their reason.
      const why=e=>e&&e.name==="AbortError"?"timed out":e&&/^HTTP /.test(e.message)?"FAA server "+e.message:e instanceof SyntaxError?"bad response":"network error";
      const faa=async(layer,svc,fields,r)=>{let e1;
        for(const ms of [9000,13000]){try{const j=await fetchJson(q(svc,fields,r),ms);if(!Array.isArray(j.features))throw new Error("no features");return j}catch(e){e1=e}}
        try{const j=await fetchJson("/api/laanc?layer="+layer+"&lat="+L.lat.toFixed(6)+"&lon="+L.lon.toFixed(6)+(r?"&r="+r:""),15000);if(!Array.isArray(j.features))throw new Error("no features");j.viaRelay=true;return j}
        catch(e2){const err=new Error(why(e1));err.reason=why(e1)+(e2&&/^HTTP/.test(e2.message)?"; backup relay "+e2.message:"; backup relay "+why(e2));throw err}};
      let a;try{a=await faa("airspace","Class_Airspace","CLASS,NAME,LOWER_VAL,ICAO_ID")}catch(e){if(tok!==S.token)return;S.faa={state:"error",surface:[],grid:null,cells:[],reason:e.reason||String(e.message||e),at:new Date()};render();return}
      if(tok!==S.token)return;
      const surface=a.features.map(f=>f.attributes).filter(x=>x.CLASS&&["B","C","D","E"].includes(String(x.CLASS).toUpperCase())&&(Number(x.LOWER_VAL)<=0)).map(x=>({cls:String(x.CLASS).toUpperCase(),name:x.NAME||x.ICAO_ID||""}));
      // LAANC grid: every cell at this point (overlapping facility grids happen); fly by the LOWEST ceiling
      let grid=null,gridErr=false,cells=[],reason="",viaRelay=!!a.viaRelay;
      try{const g=await faa("grid","FAA_UAS_FacilityMap_Data","CEILING,UNIT,MAP_EFF,ARPT_COUNT,APT1_FAAID,APT1_NAME,APT1_LAANC,APT2_FAAID,APT2_NAME,APT2_LAANC,APT3_FAAID,APT3_NAME,APT3_LAANC,APT4_FAAID,APT4_NAME,APT4_LAANC,APT5_FAAID,APT5_NAME,APT5_LAANC,AIRSPACE_1,AIRSPACE_2,AIRSPACE_3");
        viaRelay=viaRelay||!!g.viaRelay;
        cells=g.features.map(f=>{const x=f.attributes,apts=[];for(let i=1;i<=5;i++){if(x["APT"+i+"_FAAID"])apts.push({id:x["APT"+i+"_FAAID"],name:x["APT"+i+"_NAME"]||"",laanc:x["APT"+i+"_LAANC"]===1})}
          return {ceil:Number(x.CEILING),unit:x.UNIT||"Feet",eff:x.MAP_EFF||"",apts,air:[x.AIRSPACE_1,x.AIRSPACE_2,x.AIRSPACE_3].filter(Boolean)}}).filter(c=>isFinite(c.ceil));
        if(cells.length)grid=Math.min(...cells.map(c=>c.ceil));
      }catch(e){gridErr=true;reason=e.reason||String(e.message||e)}
      if(tok!==S.token)return;S.faa={state:"live",surface,grid,gridErr,reason,cells,viaRelay,edge:null,at:new Date()};render();
      // GPS: does anything different lie inside the accuracy circle? (one airspace query + one grid query)
      if(L.src==="gps"&&L.acc>0){
        try{
          const r=Math.min(Math.round(L.acc),2000);
          const [an,gn]=await Promise.all([faa("airspace","Class_Airspace","CLASS,NAME,LOWER_VAL",r),faa("grid","FAA_UAS_FacilityMap_Data","CEILING",r)]);
          if(tok!==S.token)return;
          if(!an.features||!gn.features)throw new Error("bad layer");
          const key=x=>x.cls+"|"+x.name;
          const near=an.features.map(f=>f.attributes).filter(x=>x.CLASS&&["B","C","D","E"].includes(String(x.CLASS).toUpperCase())&&Number(x.LOWER_VAL)<=0).map(x=>({cls:String(x.CLASS).toUpperCase(),name:x.NAME||x.ICAO_ID||""}));
          const here=new Set(surface.map(key)),diff=near.filter(x=>!here.has(key(x)));
          const ceil=[...new Set(gn.features.map(f=>Number(f.attributes.CEILING)).filter(n=>isFinite(n)))].sort((a,b)=>a-b);
          const gridX=ceil.length>1||(ceil.length===1&&grid!==ceil[0])||(grid!=null&&!ceil.length);
          S.faa.edge={checked:true,air:diff.length?[...new Set(diff.map(x=>"Class "+x.cls+(x.name?" "+x.name:"")))].join(", "):"",grid:gridX,ceilings:ceil,gridMin:ceil.length?ceil[0]:null};
        }catch(e){if(tok!==S.token)return;S.faa.edge={checked:false}}
        render();
      }
    }catch(e){if(tok!==S.token)return;S.faa={state:"error",surface:[],grid:null,cells:[],reason:String(e&&e.message||e),at:new Date()};render()}
  })());
  await Promise.all(jobs);
}
function syncPreset(){const sel=$("#preset");if(!sel)return;const x=S.loc.src==="preset"&&PRESETS.find(z=>z.name===S.loc.label);sel.value=x?x.k:"";}
function setLoc(lat,lon,src,label,extra){S.loc=Object.assign({lat,lon,acc:null,alt:null,src,label,presetElev:null},extra||{});$("#lat").value=lat.toFixed(5);$("#lon").value=lon.toFixed(5);S.wxSel=0;syncPreset();loadAll()}
function useGps(auto){
  const st=$("#gpsmsg");
  if(!navigator.geolocation){st.textContent="This browser has no GPS access. Pick a preset or type coordinates.";return}
  st.textContent="Waiting for GPS…";
  try{navigator.geolocation.getCurrentPosition(pos=>{const c=pos.coords;st.textContent="GPS fix ±"+Math.round(c.accuracy)+" m"+(c.accuracy>GPS_GOOD_M?". Approximate location. Drop a pin on your launch spot.":"");setLoc(c.latitude,c.longitude,"gps","My position",{acc:c.accuracy,alt:c.altitude,fixAt:pos.timestamp||Date.now()})},err=>{st.textContent=(auto?"Showing "+S.loc.label+" (default). ":"")+(err.code===1?"GPS is blocked or was refused here.":"No GPS fix.")+" Pick a preset, tap the map, or type coordinates."},{enableHighAccuracy:true,timeout:12000,maximumAge:0})}
  catch(e){st.textContent="GPS is not available here. Pick a preset or type coordinates."}
}


/* ---- map (Leaflet) ---- */
let MAP=null,MAPL=null,PIN=false,CHARTL=null,CHARTS=[],YOU=null;
function mapInit(){
  if(typeof L==="undefined"){$("#map").innerHTML='<p class="muted pad">The map library did not load.</p>';return}
  MAP=L.map("map",{zoomControl:true,minZoom:7,maxZoom:17,zoomSnap:0.5,attributionControl:true}).setView([S.loc.lat,S.loc.lon],12);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Tiles © Esri"}).addTo(MAP);
  // FAA Las Vegas Sectional (east of 118 W, north to 40 N), under the LA chart where they overlap.
  const LVT=L.tileLayer("v/{z}/{x}/{y}.webp",{tileSize:512,zoomOffset:-1,minNativeZoom:10,maxNativeZoom:12,maxZoom:17,opacity:.85,bounds:L.latLngBounds([[35.6,-118.0],[40.13,-110.7]]),errorTileUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="}).addTo(MAP);
  // Full FAA Los Angeles Sectional, cut from the FAA's own georeferenced GeoTIFF (legend, tables and Basin inset removed).
  CHARTL=L.tileLayer("l/{z}/{x}/{y}.webp",{tileSize:512,zoomOffset:-1,minNativeZoom:10,maxNativeZoom:12,maxZoom:17,opacity:.85,bounds:L.latLngBounds([[31.99,-122.41],[36.2,-114.5]]),errorTileUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="}).addTo(MAP);
  const SFT=L.tileLayer("s/{z}/{x}/{y}.webp",{tileSize:512,zoomOffset:-1,minNativeZoom:10,maxNativeZoom:11,maxZoom:17,opacity:.85,bounds:L.latLngBounds([[36,-125],[40.21,-118]]),errorTileUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="}).addTo(MAP);
  const SDT=L.tileLayer("d/{z}/{x}/{y}.webp",{tileSize:512,zoomOffset:-1,minNativeZoom:9,maxNativeZoom:11,maxZoom:17,opacity:.85,bounds:L.latLngBounds([[32.49,-117.99],[33.62,-116.29]]),errorTileUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="}).addTo(MAP);
  CHARTS=[LVT,CHARTL,SFT,SDT];
  MAP.attributionControl.addAttribution("Charts: FAA Los Angeles, San Francisco and Las Vegas VFR Sectionals, San Diego VFR Terminal Area Chart");
  L.control.scale({imperial:true,metric:false,position:"bottomleft"}).addTo(MAP);
  MAPL=L.layerGroup().addTo(MAP);
  MAP.on("zoomend",aptLabels);aptLabels();loadAirports();
  MAP.on("click",e=>{if(!PIN)return;setPin(false);setLoc(e.latlng.lat,e.latlng.lng,"manual","Dropped pin",{pin:true,pinOk:false});$("#gpsmsg").textContent="Pin dropped. If it sits exactly on your launch spot, press Confirm pin under the map."});
  $("#pinok").onclick=()=>{if(!S.loc.pin)return;S.loc.pinOk=true;$("#gpsmsg").textContent="Pin confirmed as your launch spot.";render()};
  $("#chartop").oninput=e=>{CHARTS.forEach(c=>c.setOpacity(e.target.value/100));$("#chartopv").textContent=e.target.value+"%"};
  $("#chartvis").onchange=e=>{CHARTS.forEach(c=>{if(e.target.checked)c.addTo(MAP);else MAP.removeLayer(c)})};
  $("#recenter").onclick=()=>mapUpdate(true);
  $("#pinbtn").onclick=()=>setPin(!PIN);
  setTimeout(()=>{MAP.invalidateSize();mapUpdate(true)},150);
  mapUpdate(true);
}
function setPin(on){PIN=on;const b=$("#pinbtn");b.setAttribute("aria-pressed",on);b.textContent=on?"Tap the map to set position…":"Drop pin";$("#map").classList.toggle("pinning",on)}
function mapUpdate(fit){
  if(!MAP)return;
  const Lc=S.loc,D=derived(),MI=1609.344,ll=[Lc.lat,Lc.lon];
  MAPL.clearLayers();
  // approximate controlled-airspace rings
  D.list.forEach(ap=>{
    if(ap.dist>S.radius+30)return;
    const ri=ringInfo(ap);
    if(ap.cls==="B"){L.circle([ap.lat,ap.lon],{radius:6*NM*MI,color:"#7b5cff",weight:2,dashArray:"6 5",fillColor:"#7b5cff",fillOpacity:.08,interactive:false}).addTo(MAPL)}
    else if(ri){const col=ap.cls==="C"?"#c04bff":"#1a9bff";L.circle([ap.lat,ap.lon],{radius:ri.r*NM*MI,color:col,weight:2,fillColor:col,fillOpacity:.1,interactive:false}).addTo(MAPL)}
    if(!AIRL&&ap.dist<=Math.max(S.radius*2.5,12)){ // fallback until the FAA airport layer has loaded
      L.marker([ap.lat,ap.lon],{interactive:true,keyboard:false,icon:L.divIcon({className:"apt",html:'<span class="apd"></span><span class="apl">'+esc(ap.id)+"</span>",iconSize:[16,16],iconAnchor:[8,8]})}).bindTooltip(esc(ap.id)+" · "+esc(ap.name)+(ap.cls?" · Class "+ap.cls:" · no tower")+" · "+fmt1(ap.dist)+" mi",{direction:"top"}).addTo(MAPL)}
  });
  // search radius
  L.circle(ll,{radius:S.radius*MI,color:"#0a7d4d",weight:2,dashArray:"2 6",fill:false,interactive:false}).addTo(MAPL);
  if(S.loc.acc)L.circle(ll,{radius:S.loc.acc,color:"#1f6fe5",weight:1,fillColor:"#1f6fe5",fillOpacity:.15,interactive:false}).addTo(MAPL);
  L.circleMarker(ll,{radius:8,color:"#fff",weight:3,fillColor:"#12b76a",fillOpacity:1}).bindTooltip("You · "+Lc.lat.toFixed(5)+", "+Lc.lon.toFixed(5)).addTo(MAPL);
  if(fit){const dy=S.radius*1.15/69.0,dx=dy/Math.cos(toRad(Lc.lat));MAP.fitBounds([[Lc.lat-dy,Lc.lon-dx],[Lc.lat+dy,Lc.lon+dx]],{animate:false,maxZoom:15})}
}
function mapSize(){if(MAP)setTimeout(()=>MAP.invalidateSize(),50)}

/* ---- airports on the map: every public-use airport, click/tap for details ----
   Source: FAA airport data (US_Airport layer, same FAA ArcGIS org as the airspace layers).
   Frequencies: SkyClear's chart list (tower, ground, ATIS, approach) for the airports it has;
   otherwise the FAA Services/Frequencies layers, which carry weather and ATIS frequencies only.
   Tower and CTAF frequencies are never guessed: the popup points to the Chart Supplement. */
const FAA_ARC="https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/";
let AIRL=null,APTS=[],APTS_OK=false;const APT_INFO={};
const FREQNAME={"ATIS":"ATIS","ATIS-ARR":"ATIS arrival","ATIS-DEP":"ATIS departure","ASOS":"ASOS weather","AWOS1":"AWOS weather","AWOS2":"AWOS weather","AWOS3":"AWOS weather","AWOS3P":"AWOS weather","AWOS3PT":"AWOS weather","AWOS3T":"AWOS weather","AWOSAV":"AWOS weather","FSS":"Flight Service","RCAG":"Center (RCAG)","RCOM":"Flight Service (RCO)","TWEB":"TWEB"};
async function loadAirports(){
  // Every public-use airport in SkyClear's list (FAA NASR + the chart list); no extra network request.
  APTS=AIRPORTS.map(x=>({gid:null,id:x.id,icao:x.icao,name:x.name,city:x.city||"",elev:x.elev!=null?x.elev:null,mil:null,lat:x.lat,lon:x.lon,loc:x}));
  APTS_OK=true;drawAirports();
}
function drawAirports(){
  if(!MAP)return;if(AIRL)AIRL.clearLayers();else AIRL=L.layerGroup().addTo(MAP);
  APTS.forEach(a=>{
    const cls=a.loc&&a.loc.cls?" · Class "+a.loc.cls:"";
    L.marker([a.lat,a.lon],{keyboard:false,title:a.id+" "+a.name,icon:L.divIcon({className:"apt",html:'<span class="apd"></span><span class="apl">'+esc(a.id)+"</span>",iconSize:[16,16],iconAnchor:[8,8]})})
      .bindTooltip(esc(a.id)+" · "+esc(a.name)+cls+" · click for details",{direction:"top"})
      .bindPopup(()=>aptPopup(a),{maxWidth:Math.max(200,Math.min(320,MAP.getSize().x-110)),minWidth:Math.max(200,Math.min(240,MAP.getSize().x-110)),autoPanPaddingTopLeft:[52,10],autoPanPaddingBottomRight:[10,10]})
      .on("popupopen",e=>aptDetails(a,e.popup))
      .addTo(AIRL);
  });
  mapUpdate(false); // drop the fallback markers drawn before the FAA list arrived
}
function aptPopup(a){
  const L0=S.loc,d=distMi(L0.lat,L0.lon,a.lat,a.lon),brg=compass(bearing(L0.lat,L0.lon,a.lat,a.lon)),loc=a.loc,I=APT_INFO[a.id]||{};
  const r=(k,v)=>`<tr><th>${k}</th><td>${v}</td></tr>`;
  let rows=r("Distance",fmt1(d)+" mi "+brg+" of you <small>("+fmt1(d/NM)+" NM)</small>");
  rows+=r("Field elevation",a.elev!=null?Math.round(a.elev)+" ft MSL":"<span class=\"unk\">not confirmed</span>");
  rows+=r("Airspace at field",I.cls===undefined?"<span class=\"muted\">checking FAA layer…</span>":I.cls===null?"<span class=\"unk\">not checked (FAA layer unavailable)</span>":esc(I.cls));
  const nl="<span class=\"muted\">not listed</span>";
  if(loc&&loc.twr){
    rows+=r("Tower hours",esc(loc.hrs||"not listed"))+r("Tower",esc(loc.twr))+r("Ground",loc.gnd?esc(loc.gnd):nl)+(loc.cd?r("Clearance",esc(loc.cd)):"")+r("ATIS",loc.atis?esc(loc.atis):nl)+(loc.app?r("Approach",esc(loc.app)):"")+(loc.ctaf?r("CTAF",esc(loc.ctaf)+(loc.hrs&&loc.hrs!=="Continuous"?" <small>when the tower is closed</small>":"")):"");
  }else if(loc){
    rows+=r("Tower","<span class=\"muted\">none (non-towered)</span>")+r("CTAF",loc.ctaf?esc(loc.ctaf):nl)+(loc.unicom?r("UNICOM",esc(loc.unicom)):"");
  }
  if(loc)rows+=r("Weather station",loc.wx?esc(loc.wx):nl)+(loc.clsHrs?r("Airspace hours",esc(loc.clsHrs)):"");
  const src=loc?(loc.src==="chart"?"Frequencies: "+esc(CHART.name)+" ("+esc(CHART.from)+" to "+esc(CHART.to)+").":"Frequencies and airport data: FAA NASR, effective "+esc(typeof NASR_EFF!=="undefined"?NASR_EFF:"n/a")+"."):"";
  const links=[a.icao?`<a href="https://aviationweather.gov/data/metar/?ids=${encodeURIComponent(a.icao)}" target="_blank" rel="noopener">METAR / TAF ↗</a>`:"",`<a href="https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/" target="_blank" rel="noopener">Chart Supplement ↗</a>`].filter(Boolean).join(" · ");
  return `<div class="apop"><div class="aph"><b>${esc(a.id)}</b>${a.icao&&a.icao!==a.id?` <small>${esc(a.icao)}</small>`:""} ${loc?classPill(loc):""}</div><div class="apn">${esc(a.name)}${a.city?` <small>· ${esc(a.city.replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase()))}</small>`:""}${a.mil&&a.mil!=="CIVIL"?` <small>· ${esc(a.mil.toLowerCase())}</small>`:""}</div><table>${rows}</table><div class="apl2">${links}</div><div class="aps">${src} Check the Chart Supplement before contacting a facility.</div></div>`;
}
async function aptDetails(a,popup){
  const I=APT_INFO[a.id]=APT_INFO[a.id]||{},refresh=()=>{if(popup.isOpen())popup.setContent(aptPopup(a))};
  const jobs=[];
  if(I.cls===undefined)jobs.push((async()=>{try{
    const j=await fetchJson(FAA_ARC+"Class_Airspace/FeatureServer/0/query?where=1%3D1&geometry="+a.lon+"%2C"+a.lat+"&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=CLASS,NAME,LOWER_VAL&returnGeometry=false&f=json",9000);
    if(!j.features)throw 0;
    const s=[...new Set(j.features.map(f=>f.attributes).filter(x=>x.CLASS&&["B","C","D","E"].includes(String(x.CLASS).toUpperCase())&&Number(x.LOWER_VAL)<=0).map(x=>"Class "+String(x.CLASS).toUpperCase()+(x.NAME?" ("+x.NAME+")":"")))];
    I.cls=s.length?s.join(", "):"Class G at the surface (no controlled surface area)";
  }catch(e){I.cls=null}refresh()})());
  if(false)jobs.push((async()=>{try{
    if(!a.gid){I.freq=[];return refresh()}
    const sv=await fetchJson(FAA_ARC+"Services/FeatureServer/0/query?where="+encodeURIComponent("REF_ID='"+a.gid+"'")+"&outFields=GLOBAL_ID,TYPE_CODE,WKHR_CODE,WKHR_RMK&f=json",9000);
    if(!sv.features)throw 0;
    const svc=sv.features.map(f=>f.attributes);
    if(!svc.length){I.freq=[];return refresh()}
    const fr=await fetchJson(FAA_ARC+"Frequencies/FeatureServer/0/query?where="+encodeURIComponent("SERVICE_ID IN ("+svc.map(s=>"'"+s.GLOBAL_ID+"'").join(",")+")")+"&outFields=SERVICE_ID,FREQ_TRANS&f=json",9000);
    if(!fr.features)throw 0;
    I.freq=svc.map(s=>{const f=fr.features.map(x=>x.attributes).filter(x=>x.SERVICE_ID===s.GLOBAL_ID).map(x=>x.FREQ_TRANS).filter(x=>x!=null).map(x=>String(+Number(x).toFixed(3)));if(!f.length)return null;
      const hrs=s.WKHR_CODE==="H24"?" (24 h)":s.WKHR_RMK?" ("+s.WKHR_RMK+")":"";return (FREQNAME[s.TYPE_CODE]||s.TYPE_CODE)+": "+f.join(", ")+hrs}).filter(Boolean);
  }catch(e){I.freq=null}refresh()})());
  await Promise.all(jobs);
}
function aptLabels(){if(MAP)$("#map").classList.toggle("apt-nolabel",MAP.getZoom()<9)}

/* ---- tabs ---- */
const TABS={pre:"preflight",laanc:"laanc",req:"requirements",res:"resources"};
function showTab(){
  const h=(location.hash||"").replace("#",""),t=Object.keys(TABS).find(k=>TABS[k]===h)||"pre";
  $("#view-pre").hidden=t!=="pre";$("#view-req").hidden=t!=="req";$("#view-laanc").hidden=t!=="laanc";$("#view-res").hidden=t!=="res";
  document.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===t?"page":"false"));
  $(".locbar").style.display=t==="pre"?"":"none";$("#gpsmsg").style.display=t==="pre"?"":"none";$("#addrlist").style.display=t==="pre"?"":"none";
  if(t==="pre")mapSize();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange",showTab);
document.addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b){e.preventDefault();location.hash=TABS[b.dataset.tab]||"preflight"}});

function reqHTML(){
  const card=(h,b)=>`<section class="grp"><h2>${h}</h2><div class="req">${b}</div></section>`;
  const offices=[["Los Angeles (El Segundo)","777 S. Aviation Blvd, Suite 150, El Segundo, CA 90245","(424) 405-7870","(424) 405-7866"],["Van Nuys","16501 Sherman Way, Suite 330, Van Nuys, CA 91406","(818) 267-3300","(818) 786-9732"],["Long Beach","5001 Airport Plaza Dr, Suite 100, Long Beach, CA 90815","(562) 377-5400","(562) 377-5448"],["Riverside","6961 Flight Road, Riverside, CA 92504","(951) 276-6701","(951) 689-4309"],["San Diego","9665 Granite Ridge Dr, Suite 200, San Diego, CA 92123","(858) 810-2626","(858) 810-2637"]];
  return `<div class="reqhead"><h1>Requirements</h1><p>What a drone pilot needs in place before flying, and what this app checks for you. None of this needs a visit or a call to an FAA office.</p></div>
  ${card("Remote Pilot Certificate",`<p>The pilot passes the FAA knowledge test and applies through IACRA using FAA Form 8710-13. Part of that application, the identity check, can be done with a certified flight instructor or another authorized person. A FSDO is not needed for it.</p><p class="note">In this app: certificate number, issue date and recurrent training date are recorded on the record card.</p>`)}
  ${card("Drone registration and Remote ID",`<p>The drone is registered on the FAA DroneZone site, and the Remote ID rules apply. The registration number goes on the outside of the aircraft, and the aircraft broadcasts Remote ID (built in, with an attached module, or inside an FRIA).</p><p class="note">In this app: registration number and expiry, the Remote ID method and ID, and a broadcast check.</p>`)}
  ${card("Airspace authorization",`<p>In controlled airspace (Class B, C, D or E surface areas) the pilot gets approval through LAANC. LAANC is built into approved apps and is also available through DroneZone. Much of the LA basin is controlled airspace near LAX, Hawthorne and Torrance, so this comes up often.</p><p class="note">In this app: the airspace checks tell you when authorization is needed, and the record keeps the LAANC number.</p>`)}
  ${card("Waivers",`<p>Night flights are allowed with the right training and lighting. Flying over people, beyond line of sight, or multiple aircraft at once may need a waiver or specific compliance. Those requests go through DroneZone, not a FSDO.</p>`)}
  ${card("Data sources",`<ul><li><b>Airspace, towers and frequencies:</b> ${esc(CHART.name)}, effective ${esc(CHART.from)} to ${esc(CHART.to)}. Map layers: the full Los Angeles Sectional from the FAA's georeferenced chart file (FAA digital VFR charts, same edition), plus the San Francisco Sectional and San Diego Terminal Area Chart from the FAA PDFs.</li><li><b>METAR and TAF:</b> aviationweather.gov data API. It is free with no key, limited to 100 requests a minute, and it does not allow calls straight from a web page, so the live app needs a small server-side proxy. Until then the weather shows labeled sample text.</li><li><b>Ground elevation:</b> USGS elevation service. <b>Place name:</b> National Weather Service.</li><li><b>Address search:</b> OpenStreetMap (Nominatim, © OpenStreetMap contributors), then the US Census Bureau geocoder if OpenStreetMap finds nothing. The address you type is sent to them through SkyClear's server to look it up and is not stored by SkyClear.</li><li><b>Not yet read by this app:</b> TFRs, NOTAMs and special use airspace. Check tfr.faa.gov and the FAA B4UFLY map.</li></ul>`)}
  <section class="grp"><h2>FAA offices, Southern California<small>reference only</small></h2><p class="pad muted" style="padding-bottom:0">Flight Standards District Offices. A drone pilot does not check in with them for a flight. They are listed here so you have the contact details.</p><div class="scroll"><table class="tb"><thead><tr><th>Office</th><th>Address</th><th>Phone</th><th>Fax</th></tr></thead><tbody>${offices.map(o=>`<tr><td><b>${esc(o[0])}</b></td><td>${esc(o[1])}</td><td class="n">${esc(o[2])}</td><td class="n">${esc(o[3])}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ---- saved pilot / drone profile (this device only) ---- */
const PROFILE_KEYS=["pilot","cert","certDate","trnDate","model","reg","regExp","ridType","ridId"];
const PROFILE_STORE="skyclear.profile.v1";
function loadProfile(){try{const o=JSON.parse(localStorage.getItem(PROFILE_STORE)||"{}");PROFILE_KEYS.forEach(k=>{if(typeof o[k]==="string")S[k]=o[k]})}catch(e){}}
function saveProfile(){try{const o={};PROFILE_KEYS.forEach(k=>o[k]=S[k]||"");if(PROFILE_KEYS.some(k=>o[k]))localStorage.setItem(PROFILE_STORE,JSON.stringify(o));else localStorage.removeItem(PROFILE_STORE)}catch(e){}}
function hasProfile(){return PROFILE_KEYS.some(k=>S[k])}
function clearProfile(){if(!confirm("Clear the saved pilot, drone and Remote ID details from this device?"))return;PROFILE_KEYS.forEach(k=>S[k]="");try{localStorage.removeItem(PROFILE_STORE)}catch(e){}render()}

/* ---- File LAANC (roadmap 6) ----
   Providers: the FAA table "Companies Providing Public LAANC Services" on faa.gov/uas/getting_started/laanc,
   read 2026-11-25. Flags in FAA column order: Part 107 near-real-time, Part 107 further coordination,
   recreational (44809), iOS, Android, desktop. Every URL below was checked to load on 2026-11-25; where the
   FAA's own link was broken the company's home page is used. No personal data or location is put in any URL. */
const LAANC_USS=[
 ["AirMatrix","https://airmatrix.ai/products/laanc",[1,1,1,0,0,1]],
 ["Airspace Link","https://airspacelink.com/pilots",[1,1,1,1,1,1]],
 ["Aloft","https://www.aloft.ai/feature/laanc/",[1,1,1,1,1,1]],
 ["AstraUTM",null,[1,1,1,1,1,0],"Website's security certificate had expired when checked, so no link is shown."],
 ["AutoPylot","https://www.autopylot.io/",[1,1,1,1,1,1]],
 ["Avision","https://avision.io/avision-app-for-drones/",[1,1,1,1,1,1]],
 ["Flightloop","https://www.flightloop.co/",[1,0,1,0,0,1]],
 ["FlightReady","https://www.flightready.net/laanc-drone-airspace-authorizations",[1,1,1,1,0,0]],
 ["Flyfreely","https://flyfreely.io/laanc",[1,1,0,0,0,1]],
 ["SkedFlex","https://skedflex.com/",[1,1,1,0,0,1]],
 ["UASidekick","https://uasidekick.com/",[1,1,1,1,1,1]],
 ["Wing (OpenSky)","https://wing.com/opensky/",[1,0,1,1,1,0]]
];
const FAA_LAANC_PAGE="https://www.faa.gov/uas/getting_started/laanc";
function ussTags(f){const t=[];if(f[2])t.push("Recreational");if(f[1])t.push("Further coord.");const pl=[f[3]?"iOS":"",f[4]?"Android":"",f[5]?"Web":""].filter(Boolean);if(pl.length)t.push(pl.join(" · "));return t}
function fileLaancHTML(zero){
  const btn=u=>{const [n,url,f,note]=u,tags=ussTags(f).map(x=>`<i>${esc(x)}</i>`).join("");
    return url?`<a class="uss" href="${url}" target="_blank" rel="noopener"><b>${esc(n)} ↗</b><span>${tags}</span></a>`:`<div class="uss off" title="${esc(note||"")}"><b>${esc(n)}</b><span>${tags}<i class="nolink">${esc(note||"No link")}</i></span></div>`};
  const list=zero?LAANC_USS.filter(u=>u[2][1]):LAANC_USS;
  return `<div class="filelaanc"><div class="flh"><b>File LAANC</b><span>${zero?"The grid is 0 ft here, so near-real-time LAANC can't approve this spot. Part 107 pilots can send a further coordination request (these providers offer it) or apply in FAA DroneZone.":"FAA-approved LAANC providers. Each opens in a new tab; SkyClear sends them nothing."}</span></div>
   <div class="usslist">${list.map(btn).join("")}</div>
   <p class="flf">From the FAA's approved provider list, checked Nov 25, 2026. <a href="${FAA_LAANC_PAGE}" target="_blank" rel="noopener">Current FAA list ↗</a> · Step-by-step guides on the <a href="#laanc">LAANC tab</a>.</p></div>`;
}

/* ---- LAANC tab ---- */
// Contact details checked 2026-11-25 on each company's own website. Only list what the company publishes.
const LAANC_APPS=[
 {name:"Aloft Air Control",by:"Aloft (a Versaterm company)",cost:"Free for individual pilots",
  web:["air.aloft.ai","https://air.aloft.ai"],site:["aloft.ai","https://www.aloft.ai"],help:["Aloft help center","https://www.aloft.ai/help-category/air-control-for-individual-pilots"],
  email:"support@aloft.ai",phone:null,phoneNote:"Aloft does not publish a support phone number. Use email or the Get Support button in its help center.",
  apps:"iPhone and Android: search \"Aloft Air Control\" in the App Store or Google Play.",
  steps:["Install Aloft Air Control and create a free account.","Open your profile and add your phone number. Part 107 pilots also add their certificate number.","Search for your launch location, or use your current position on the map.","Draw the flight area and set the maximum altitude. Stay at or below the grid number (SkyClear shows it as Fly up to).","Choose the date, start time and how long you will fly, then submit the LAANC request.","Approval inside the grid usually comes back within seconds. Copy the authorization number shown on the approved request."]},
 {name:"AirHub Portal",by:"Airspace Link",cost:"Free Personal plan (includes LAANC)",
  web:["portal.airspacelink.com","https://portal.airspacelink.com"],site:["airspacelink.com","https://airspacelink.com"],help:["Airspace Link support","https://support.airspacelink.com"],
  email:"helpdesk@airspacelink.com",phone:"(800) 783-3712",phoneNote:"Main company line from the Airspace Link contact page. For app help, the helpdesk email or support case form is the official route.",
  extra:["Submit a support case","https://airspacelink.com/create-support-case"],
  apps:"iPhone and Android: \"AirHub Portal\" by Airspace Link. Check the publisher name; a look-alike app is not theirs.",
  steps:["Install AirHub Portal or open portal.airspacelink.com and create a free Personal account.","Add your phone number to your profile. It is required for LAANC.","Tap (+) then Operation, or drop a pin on your launch spot and tap Get Approval.","Give it a title, draw a circle or box around the flight area and enter the Max Altitude in feet AGL (at or below the grid number).","Set the start time, duration and time zone, then pick yourself as Pilot in Command and choose the aircraft.","In the Compliance section, submit the LAANC authorization. Copy the authorization number once it is approved."]}
];
function laancNow(loading,controlled,cap0,gridOk,ge0,CS0){CS0=CS0||{};
  const pe=$("#laancprof");
  if(pe){const rid={std:"Standard Remote ID (built in)",mod:"Broadcast module attached",fria:"Flying inside an FRIA"}[S.ridType]||"";
    const r=(l,v)=>`<tr><th>${l}</th><td class="n">${v?esc(v):`<span class="muted">not entered</span>`}</td></tr>`;
    pe.innerHTML=`<table class="tb kv"><tbody>${r("Pilot",S.pilot)}${r("Part 107 cert",S.cert)}${r("Aircraft",S.model)}${r("FAA registration",S.reg)}${r("Remote ID",rid+(S.ridId?(rid?" · ":"")+S.ridId:""))}</tbody></table><p class="note">${hasProfile()?"Saved on this device. Edit it on the Pre-flight tab.":"Fill this in once on the Pre-flight tab (Pilot, drone and Remote ID). It is saved on this device."} Aloft and AirHub ask for the same details when you set up your profile and aircraft.</p>`}
  const e=$("#laancnow");if(!e)return;
  const L=S.loc,pos=L.lat.toFixed(5)+", "+L.lon.toFixed(5);
  e.innerHTML=loading?`<p class="muted">Checking airspace…</p>`:controlled
   ?`<div class="lnow need"><b>LAANC needed here</b><span>${esc(pos)} · ${esc(L.label||"")}</span><span>Ask for <b>${cap0===0?"0 ft: no automatic LAANC here (further coordination or waiver needed)":CS0.k==="nogrid"?"no UAS Facility Map grid here: use FAA DroneZone":gridOk?cap0+" ft AGL or lower":"the altitude in your LAANC app (grid not confirmed here)"}</b>${ge0.ft!=null&&gridOk&&cap0>0?" ("+(ge0.ft+cap0)+" ft MSL)":""}. Use these coordinates in the LAANC app.</span></div>`
   :`<div class="lnow ok"><b>No LAANC needed here</b><span>${esc(pos)} · ${esc(L.label||"")}</span><span>The FAA layer does not show controlled airspace at the surface here. Still check TFRs before flying.</span></div>`;
}
function laancHTML(){
  const a=t=>`<a href="${t[1]}" target="_blank" rel="noopener">${esc(t[0])}</a>`;
  const card=x=>`<section class="grp"><h2>${esc(x.name)}<small>${esc(x.by)}</small></h2><div class="req">
   <table class="tb kv"><tbody>
    <tr><th>Cost</th><td>${esc(x.cost)}</td></tr>
    <tr><th>Web app</th><td>${a(x.web)}</td></tr>
    <tr><th>Phone apps</th><td>${esc(x.apps)}</td></tr>
    <tr><th>Support email</th><td class="n"><a href="mailto:${x.email}">${esc(x.email)}</a></td></tr>
    <tr><th>Phone</th><td>${x.phone?`<a class="n" href="tel:+1${x.phone.replace(/\D/g,"")}">${esc(x.phone)}</a><small>${esc(x.phoneNote)}</small>`:`<span class="muted">Not published</span><small>${esc(x.phoneNote)}</small>`}</td></tr>
    <tr><th>Help</th><td>${a(x.help)}${x.extra?" · "+a(x.extra):""} · ${a(x.site)}</td></tr>
   </tbody></table>
   <h3>How to request</h3><ol class="steps">${x.steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol></div></section>`;
  return `<div class="reqhead"><h1>LAANC</h1><p>LAANC is the FAA's automatic approval for flying in controlled airspace near airports. You don't call anyone: you ask through an FAA-approved app, and at or below the grid altitude the answer usually comes back in seconds.</p></div>
  <section class="grp"><h2>Your spot right now<small>from the Pre-flight scan</small></h2><div class="req" id="laancnow"></div></section>
  <section class="grp"><h2>Your pilot and drone info<small>for the LAANC app</small></h2><div class="req" id="laancprof"></div></section>
  <section class="grp"><h2>Authorization number<small>after approval</small></h2><div class="fields"><div><label for="laanc2">LAANC authorization number</label><input id="laanc2" autocomplete="off" placeholder="Paste it here after approval" value="${esc(S.laanc)}"></div></div><p class="muted lsmall">Same field as on the Pre-flight tab. Once entered, the Airspace check passes and the number goes on your pre-flight record.</p></section>
  ${LAANC_APPS.map(card).join("")}
  <section class="grp"><h2>All FAA-approved LAANC providers<small>from faa.gov</small></h2>${fileLaancHTML(false).replace('<b>File LAANC</b>','<b>Providers</b>')}</section>
  <section class="grp"><h2>Good to know</h2><div class="req"><ul>
   <li><b>Part 107 or recreational:</b> both can use LAANC. Recreational flyers need their TRUST certificate and pick recreational in the app.</li>
   <li><b>Altitude:</b> ask at or below the grid number for fast approval. Above the grid is "further coordination": a manual FAA review that should be filed days ahead and can take a long time or be declined.</li>
   <li><b>Fly what was approved:</b> stay inside the area, altitude and time window on the authorization.</li>
   <li><b>Not covered by LAANC:</b> TFRs and NOTAMs. Check tfr.faa.gov and the TFRs shown in your LAANC app.</li>
   <li><b>No LAANC grid at a spot:</b> requests there go through the FAA DroneZone instead.</li>
  </ul><p class="note">Contact details were checked on each company's website on Nov 25, 2026. SkyClear is not affiliated with Aloft or Airspace Link.</p></div></section>`;
}

/* ---- Resources tab ---- */
// Every URL and phone number below was checked on 2026-11-25 (FAA UAS Support Center number and
// email from faa.gov/uas/contact_us; NOTAM Search is the link on the FAA's own NOTAM page).
const RES_METAR_IDS="KLAX,KHHR,KBUR,KTOA,KSMO,KLGB";
const RES={
  tfr:"https://tfr.faa.gov/",
  notam:"https://notams.aim.faa.gov/notamSearch/",
  metar:"https://aviationweather.gov/data/metar/?ids="+RES_METAR_IDS,
  parks:"https://www.parks.ca.gov/?page_id=29229"
};
function resHTML(){
  const ext=(u,t)=>`<a href="${u}" target="_blank" rel="noopener">${t}<span class="sr"> (opens in a new tab)</span> ↗</a>`;
  const aloft=LAANC_APPS[0],airhub=LAANC_APPS[1];
  const row=(link,desc)=>`<li><span class="rl">${link}</span><span class="rd">${desc}</span></li>`;
  const sec=(id,h,items)=>`<section class="grp" id="${id}"><h2>${h}</h2><ul class="rlist">${items.join("")}</ul></section>`;
  return `<div class="reqhead"><h1>Drone Pilot Resources</h1><p>Official sources for current restrictions, weather and rules. SkyClear links to them; always check the source itself for the latest information before you fly.</p></div>
  <nav class="quick" aria-label="Quick links">
   <a class="qk" href="${RES.tfr}" target="_blank" rel="noopener"><b>TFRs</b><small>FAA temporary flight restrictions</small></a>
   <a class="qk" href="${RES.notam}" target="_blank" rel="noopener"><b>NOTAMs</b><small>FAA NOTAM Search</small></a>
   <a class="qk" id="qk-wx" href="${RES.metar}" target="_blank" rel="noopener"><b>Weather</b><small id="qk-wx-ids">METARs: ${RES_METAR_IDS.replace(/,/g,", ")}</small></a>
   <a class="qk" href="${RES.parks}" target="_blank" rel="noopener"><b>Launch Site Rules</b><small>California State Parks drone rules</small></a>
  </nav>
  ${sec("res-airspace","Airspace and authorization",[
    row(ext(aloft.web[1],"Aloft Air Control"),"Airspace checks and LAANC authorization. Step-by-step guide on the <a href=\"#laanc\">LAANC tab</a>."),
    row(ext(airhub.web[1],"AirHub Portal (Airspace Link)"),"Airspace checks and authorization. Step-by-step guide on the <a href=\"#laanc\">LAANC tab</a>."),
    row(ext("https://www.faa.gov/uas/getting_started/temporary_flight_restrictions","FAA Temporary Flight Restrictions"),"Check active and upcoming TFRs. Verify the boundaries, altitude and effective times for your flight."),
    row(ext(RES.notam,"FAA NOTAM Search"),"Check notices for the flight area and nearby airports. Example identifiers: KLAX, KHHR, KBUR, KTOA, KSMO, KLGB."),
    row(ext("https://www.faa.gov/uas/commercial_operators/uas_facility_maps","FAA UAS Facility Maps"),"The altitude grid at your exact flight location. Get FAA authorization where it is required.")])}
  ${sec("res-weather","Weather",[
    row(ext(RES.metar,"SoCal METARs"),"Timestamped observations for LAX, Hawthorne, Burbank, Torrance, Santa Monica and Long Beach."),
    row(ext("https://www.weather.gov/","NWS Local Forecast"),"The forecast for the launch site. Verify actual conditions before takeoff."),
    row(ext("https://www.1800wxbrief.com/","Flight Service (1800wxbrief.com)"),"Official flight briefings, also by phone at 1-800-WX-BRIEF.")])}
  ${sec("res-site","Launch site",[
    row(ext(RES.parks,"California State Parks Drone Rules"),"Check the individual park or district's posted rules. For other sites, verify launch and landing rules with the land manager.")])}
  ${sec("res-rules","Registration and rules",[
    row(ext("https://faadronezone-access.faa.gov/","FAA DroneZone"),"Manage registration and submit applicable FAA authorization requests."),
    row(ext("https://www.faa.gov/uas/getting_started/remote_id","FAA Remote ID"),"Remote ID requirements and compliance options."),
    row(ext("https://www.faa.gov/uas/recreational_flyers","FAA Recreational Flying and TRUST"),"Recreational flying requirements and the TRUST test.")])}
  ${sec("res-charts","Charts and communications",[
    row(ext("https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/","FAA Chart Supplement"),"Airport communications, weather sources and procedures. SkyClear's own FAA chart layers are on the <a href=\"#preflight\">Pre-flight map</a>.")])}
  <section class="grp" id="res-phone"><h2>Phone numbers and coordination</h2><div class="scroll"><table class="tb"><thead><tr><th>Contact</th><th>Number</th><th>When</th></tr></thead><tbody>
   <tr><td><b>Emergency services</b></td><td class="n"><a href="tel:911">911</a></td><td>An immediate threat to life or safety.</td></tr>
   <tr><td><b>FAA UAS Support Center</b></td><td class="n"><a href="tel:+18443596982">844-359-6982</a><small><a href="mailto:UASHelp@faa.gov">UASHelp@faa.gov</a></small></td><td>Drone rules, registration and authorization questions.</td></tr>
   <tr><td><b>Flight Service</b></td><td class="n"><a href="tel:+18009927433">1-800-WX-BRIEF</a><small>1-800-992-7433</small></td><td>Official weather and NOTAM briefings.</td></tr>
   <tr><td><b>Site owner or land manager</b></td><td>Varies by site</td><td>Use the contact for the actual launch location.</td></tr>
   <tr><td><b>ATC coordination</b></td><td>See your authorization</td><td>Use the contact in your authorization when coordination is required.</td></tr>
  </tbody></table></div></section>
  <section class="grp" id="res-107"><h2>Part 107 preflight reference<small>${ext("https://www.govinfo.gov/content/pkg/CFR-2025-title14-vol2/xhtml/CFR-2025-title14-vol2-sec107-49.html","14 CFR § 107.49")}</small></h2><div class="req">
   <p>Before flight, the remote pilot in command reviews, as applicable:</p>
   <ul><li>Local weather conditions</li><li>Local airspace and any flight restrictions</li><li>The location of persons and property on the surface, and other ground hazards</li><li>Crew roles, and emergency procedures briefed with everyone involved</li><li>Control links between the control station and the aircraft</li><li>Enough battery power for the planned flight</li><li>Any attached payload secured</li></ul>
   <p class="note">Informational summary. Read the regulation at the link for the exact wording. SkyClear's checklist on the Pre-flight tab covers these items.</p></div></section>`;
}
// The Weather quick link follows the pilot's position: the 3 nearest reporting stations.
function resWxLink(D){const a=$("#qk-wx"),s=$("#qk-wx-ids");if(!a||!D||!D.wxStations||!D.wxStations.length)return;const ids=D.wxStations.map(x=>x.icao).join(",");a.href="https://aviationweather.gov/data/metar/?ids="+ids;s.textContent="METARs near you: "+ids.replace(/,/g,", ")}

/* ---- wiring ---- */
$("#preset").innerHTML=`<option value="" disabled>Custom location</option>`+PRESETS.map(x=>`<option value="${x.k}">${x.name}</option>`).join("");
$("#preset").onchange=e=>{const x=PRESETS.find(z=>z.k===e.target.value);if(!x)return;setLoc(x.lat,x.lon,"preset",x.name,{presetElev:x.elev})};
$("#gps").onclick=useGps;
/* ---- address lookup (via /api/geo: OpenStreetMap, then US Census) ---- */
function pickAddr(r){$("#addrlist").hidden=true;$("#addrlist").innerHTML="";setLoc(r.lat,r.lon,"address",r.label,{geoSrc:r.src});
  $("#gpsmsg").textContent="Found: "+r.label+" · "+(r.src==="OpenStreetMap"?"© OpenStreetMap contributors":"US Census Bureau")+". Check the pin on the map.";}
async function findAddr(){
  const q=$("#addr").value.trim(),msg=$("#gpsmsg"),list=$("#addrlist"),btn=$("#find");
  list.hidden=true;list.innerHTML="";
  if(q.length<3){msg.textContent="Type a street address, city, or place name, then press Find.";return}
  btn.disabled=true;msg.textContent="Looking up the address…";
  try{
    const j=await fetchJson("/api/geo?q="+encodeURIComponent(q),12000);
    const rs=(j&&j.results)||[];
    if(!rs.length){msg.textContent="No match in the United States. Add the city and state, or use GPS or coordinates.";return}
    if(rs.length===1){pickAddr(rs[0]);return}
    window.__addr=rs;msg.textContent="Several matches. Pick the right one:";
    list.innerHTML=rs.map((r,i)=>`<button type="button" data-ai="${i}">${esc(r.label)}<small>${r.lat.toFixed(5)}, ${r.lon.toFixed(5)} · ${r.src==="OpenStreetMap"?"© OpenStreetMap contributors":"US Census Bureau"}</small></button>`).join("");
    list.hidden=false;
  }catch(e){msg.textContent="Address search is unavailable right now. Use GPS, a preset, or type coordinates."}
  finally{btn.disabled=false}
}
$("#find").onclick=findAddr;
$("#addr").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();findAddr()}});
document.addEventListener("click",e=>{const b=e.target.closest("[data-ai]");if(b&&window.__addr){pickAddr(window.__addr[+b.dataset.ai])}});
$("#go").onclick=()=>{const la=parseFloat($("#lat").value),lo=parseFloat($("#lon").value);if(!isFinite(la)||!isFinite(lo)||Math.abs(la)>90||Math.abs(lo)>180){$("#gpsmsg").textContent="Enter latitude and longitude as decimal degrees, for example 33.9164 and -118.3526.";return}$("#gpsmsg").textContent="";setLoc(la,lo,"manual","Manual position")};
document.addEventListener("click",e=>{
  const r=e.target.closest("[data-r]");if(r){S.radius=+r.dataset.r;render();mapUpdate(true);return}
  const w=e.target.closest("[data-w]");if(w){S.wxSel=+w.dataset.w;render();return}
  if(e.target.closest("#wxrefresh")){loadAll();return}
  if(e.target.closest("#profclear")){clearProfile();return}
});
document.addEventListener("change",e=>{if(e.target.matches("input[data-id]")){S.manual[e.target.dataset.id]=e.target.checked;render()}});
document.addEventListener("input",e=>{if(e.target.id==="laanc2"){S.laanc=e.target.value;render();return}if(e.target.id==="laanc"){const o=$("#laanc2");if(o)o.value=e.target.value}const id=e.target.id;if(PROFILE_KEYS.includes(id)){S[id]=e.target.value;saveProfile()}if(["laanc","pilot","cert","certDate","trnDate","model","reg","regExp","ridType","ridId"].includes(id)){S[id]=e.target.value;render()}});
$("#lat").value=S.loc.lat.toFixed(5);$("#lon").value=S.loc.lon.toFixed(5);
loadProfile();
$("#view-req").innerHTML=reqHTML();
$("#view-laanc").innerHTML=laancHTML();
$("#view-res").innerHTML=resHTML();
mapInit();showTab();
$("#gpsmsg").textContent=DEV_FIXED_LOCATION?"Showing "+PRESETS[0].name+". Press Use my GPS, tap the map, or type coordinates.":"";
loadAll();
if(!DEV_FIXED_LOCATION)useGps(true);
// Installable app: register the service worker (it never caches /api weather).
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("/sw.js").catch(()=>{});
