/* ===== SkyClear core: data, geometry, sun, METAR/TAF decoders (pure functions, no DOM) ===== */
const CHART={name:"Los Angeles VFR Sectional",from:"2026-10-29",to:"2026-12-24"};
const NM=1.15078; // statute miles per nautical mile

/* Airports, classes and frequencies read from the Los Angeles Sectional margin tables.
   Positions are airport reference points, approximate to about 0.01 degree. */
/* Airports. AIRPORTS_CHART: read from the margin tables of the Los Angeles Sectional (Ky's chart).
   AIRPORTS_NASR (src/airports_nasr.js, generated): official FAA NASR data for every public-use airport in the chart coverage.
   A chart entry keeps its chart frequencies; NASR only adds fields the chart list does not have. */
const AIRPORTS_CHART=[
 {id:"LAX",icao:"KLAX",name:"Los Angeles Intl",lat:33.9425,lon:-118.4081,cls:"B",hrs:"Continuous",
  twr:"133.9 239.3 (N complex) · 120.95 379.1 (S complex) · 119.8 239.3 (heli)",gnd:"121.4 (W) · 121.65 (N complex) · 121.75 (S complex) · 327.0",atis:"133.8 (arrivals) · 135.65 (departures)",
  app:"LA Class B: 124.3 124.5 124.9 125.2 127.4 · 128.75 134.9 235.975 263.025 · 269.0 323.275 346.25 363.2"},
 {id:"HHR",icao:"KHHR",name:"Hawthorne Municipal (Jack Northrop Fld)",lat:33.9228,lon:-118.3352,cls:"D",hrs:"0600-2200",twr:"121.1 257.8",gnd:"125.1",atis:"118.4",app:"SoCal Approach, see LA Class B sectors"},
 {id:"SMO",icao:"KSMO",name:"Santa Monica Municipal",lat:34.0158,lon:-118.4513,cls:"D",hrs:"0700-2100",twr:"120.1 257.8",gnd:"121.9",atis:"119.15",app:"SoCal Approach, see LA Class B sectors"},
 {id:"TOA",icao:"KTOA",name:"Zamperini Field (Torrance)",lat:33.8034,lon:-118.3396,cls:"D",hrs:"0700-2000",twr:"124.0 (S) · 133.075 (N) · 257.8",gnd:"120.9",atis:"125.6",app:"SoCal Approach, see LA Class B sectors"},
 {id:"VNY",icao:"KVNY",name:"Van Nuys",lat:34.2098,lon:-118.4899,cls:"D",hrs:"0600-2245",twr:"119.3 (162°-345° and RWY 16R/34L dep) · 120.2 (346°-161° and RWY 16L/34R dep) · 239.0",gnd:"121.7",atis:"127.55",app:"Burbank Class C sectors cover Van Nuys: 120.4 360.6 · 134.2 338.2"},
 {id:"BUR",icao:"KBUR",name:"Hollywood Burbank",lat:34.2007,lon:-118.3587,cls:"C",hrs:"Continuous",twr:"118.7 254.3",gnd:"123.9 348.6 (heli 132.325)",atis:"135.125",
  app:"Burbank Class C: 120.4 360.6 (VNY 280°-BUR 050°) · 134.2 338.2 (VNY 160°-280°) · 135.05 317.5 (BUR 050°-150°) · 124.6 298.85 (BUR 150°-VNY 160°)"},
 {id:"LGB",icao:"KLGB",name:"Long Beach (Daugherty Fld)",lat:33.8180,lon:-118.1518,cls:"D",hrs:"0615-2345",twr:"119.4 (RWY 08R/26L; 30 arr, 12 dep) · 120.5 (RWY 08L/26R; 12 arr, 30 dep) · 257.6",gnd:"133.0 257.6",atis:"127.75",app:"SoCal Approach 125.35 316.125 (Chart Supplement)"},
 {id:"SLI",icao:"KSLI",name:"Los Alamitos AAF",lat:33.7900,lon:-118.0519,cls:"D",hrs:"0700-2200 Mon-Thu, 0700-1600 Fri-Sun, closed federal holidays",twr:"123.85 251.15",gnd:"126.95 257.95",atis:"118.875 379.975",app:"SoCal Approach"},
 {id:"FUL",icao:"KFUL",name:"Fullerton Municipal",lat:33.8720,lon:-117.9801,cls:"D",hrs:"0700-2100",twr:"119.1",gnd:"121.8",atis:"125.05",app:"SoCal Approach"},
 {id:"SNA",icao:"KSNA",name:"John Wayne / Orange County",lat:33.6757,lon:-117.8682,cls:"C",hrs:"0615-2300",twr:"119.9 (RWY 02R/20L) · 126.8 (RWY 02L/20R) · 343.625",gnd:"120.8 (E) · 125.25 (W)",atis:"126.0",
  app:"Santa Ana Class C: 121.3 263.1 (315°-045°) · 121.1 132.7 279.575 350.325 (045°-130°) · 128.1 281.4 (130°-190°) · 125.35 316.125 (190°-315° above 3000) · 127.2 269.6 (190°-315°). Service 0615-2300, other times Class G"},
 {id:"ONT",icao:"KONT",name:"Ontario Intl",lat:34.0560,lon:-117.6012,cls:"C",hrs:"0600-2300",twr:"120.6 360.775",gnd:"121.9 257.8",atis:"124.25",
  app:"Ontario Class C: 127.0 318.2 (N-NE) · 379.25 (NE-E) · 134.0 278.3 (NE-S) · 278.3 (E-S) · 135.4 377.125 (S-SW) · 125.5 349.0 (SW-N)"},
 {id:"CNO",icao:"KCNO",name:"Chino",lat:33.9747,lon:-117.6366,cls:"D",hrs:"0700-2100",twr:"118.5",gnd:"121.6",atis:"125.8",app:"SoCal Approach"},
 {id:"POC",icao:"KPOC",name:"Brackett Field (La Verne)",lat:34.0916,lon:-117.7818,cls:"D",hrs:"0700-2100",twr:"118.2 (RWY 08R/26L) · 133.3 (RWY 08L/26R)",gnd:"125.0",atis:"126.4",app:"SoCal Approach"},
 {id:"RAL",icao:"KRAL",name:"Riverside Municipal",lat:33.9519,lon:-117.4451,cls:"D",hrs:"0700-2000",twr:"121.0 257.8",gnd:"121.7",atis:"128.8",app:"SoCal Approach"},
 {id:"RIV",icao:"KRIV",name:"March ARB / Riverside",lat:33.8807,lon:-117.2595,cls:"C",hrs:"Continuous",twr:"127.65 253.5",gnd:"121.75 335.8",atis:"134.75 239.05",app:"March Class C: 119.25 133.5 270.275 306.975 (0700-2300 Mon-Fri, 0700-1800 Sat-Sun; other times SoCal 134.0 278.3)"},
 {id:"SBD",icao:"KSBD",name:"San Bernardino Intl",lat:34.0954,lon:-117.2349,cls:"D",hrs:"0700-2100",twr:"119.45",gnd:"121.8",atis:"124.175",app:"SoCal Approach"},
 {id:"OXR",icao:"KOXR",name:"Oxnard",lat:34.2008,lon:-119.2072,cls:"D",hrs:"0700-2100",twr:"134.95 257.8",gnd:"121.9",atis:"118.05",app:"SoCal Approach"},
 {id:"CMA",icao:"KCMA",name:"Camarillo",lat:34.2138,lon:-119.0943,cls:"D",hrs:"0700-2100",twr:"128.2 269.4",gnd:"121.8",atis:"126.025",app:"SoCal Approach"},
 {id:"SBA",icao:"KSBA",name:"Santa Barbara Municipal",lat:34.4262,lon:-119.8404,cls:"C",hrs:"0600-2300",twr:"119.7 254.35",gnd:"121.7",atis:"132.65",app:"Santa Barbara Class C: 120.55 319.15 (151°-329°) · 125.4 291.1 (330°-150°)"},
 {id:"SAN",icao:"KSAN",name:"San Diego Intl",lat:32.7336,lon:-117.1897,cls:"B",hrs:"Continuous",twr:"118.3 338.225",gnd:"123.9",atis:"134.8",app:"San Diego Class B: 132.2 269.1 (029°-061°) · 124.35 279.625 (062°-109°) · 125.15 317.55 (110°-224°) · 119.6 363.1 (225°-293°) · 127.3 323.0 (294°-028°)"},
 {id:"MYF",icao:"KMYF",name:"Montgomery-Gibbs Exec",lat:32.8157,lon:-117.1396,cls:"D",hrs:"0600-2100",twr:"119.2 (RWY 10R/28L) · 125.7 (RWY 10L/28R) · 269.4",gnd:"118.225",atis:"126.9",app:"SoCal Approach"},
 {id:"CRQ",icao:"KCRQ",name:"McClellan-Palomar (Carlsbad)",lat:33.1283,lon:-117.2803,cls:"D",hrs:"0700-2200",twr:"118.6 276.4",gnd:"121.8",atis:"120.15",app:"SoCal Approach"},
 {id:"SEE",icao:"KSEE",name:"Gillespie Field",lat:32.8262,lon:-116.9724,cls:"D",hrs:"0700-2100",twr:"120.7 257.8",gnd:"121.7",atis:"125.45",app:"SoCal Approach"},
 /* no tower: shown on the radar, class and frequencies must be confirmed on the chart */
 {id:"CPM",icao:null,name:"Compton/Woodley",lat:33.8900,lon:-118.2437,cls:null},
 {id:"EMT",icao:null,name:"San Gabriel Valley (El Monte)",lat:34.0861,lon:-118.0347,cls:null},
 {id:"WHP",icao:null,name:"Whiteman (Pacoima)",lat:34.2593,lon:-118.4134,cls:null},
 {id:"CCB",icao:null,name:"Cable (Upland)",lat:34.1116,lon:-117.6883,cls:null},
 {id:"AJO",icao:null,name:"Corona Municipal",lat:33.8978,lon:-117.6026,cls:null}
];
const AIRPORTS=(()=>{
  const N=typeof AIRPORTS_NASR!=="undefined"?AIRPORTS_NASR:[];
  const out=AIRPORTS_CHART.map(c=>{const n=N.find(x=>x.id===c.id);const o=Object.assign({},n||{});Object.keys(c).forEach(k=>{if(c[k]!=null)o[k]=c[k]});if(n&&c.cls==null)o.cls=n.cls;return Object.assign(o,{src:"chart",nasr:!!n})});
  N.forEach(n=>{if(!out.some(o=>o.id===n.id))out.push(Object.assign({src:"nasr"},n))});
  return out;
})();
const PRESETS=[
 {k:"lax",name:"LAX (Los Angeles)",lat:33.9425,lon:-118.4081,elev:128},
 {k:"smo",name:"Santa Monica",lat:34.0100,lon:-118.4960,elev:90},
 {k:"vny",name:"Van Nuys",lat:34.1900,lon:-118.4500,elev:720},
 {k:"lgb",name:"Long Beach",lat:33.7700,lon:-118.1900,elev:25},
 {k:"sna",name:"Santa Ana",lat:33.7460,lon:-117.8670,elev:135},
 {k:"ont",name:"Ontario",lat:34.0640,lon:-117.6500,elev:960},
 {k:"hhr",name:"Hawthorne",lat:33.9164,lon:-118.3526,elev:70}
];

/* ---- geometry ---- */
const toRad=d=>d*Math.PI/180, toDeg=r=>r*180/Math.PI;
function distMi(lat1,lon1,lat2,lon2){const R=3958.8;const dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1);const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(a))}
function bearing(lat1,lon1,lat2,lon2){const y=Math.sin(toRad(lon2-lon1))*Math.cos(toRad(lat2));const x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2))-Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));return (toDeg(Math.atan2(y,x))+360)%360}
const COMP=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass=b=>COMP[Math.round(b/22.5)%16];
function dms(v,pos,neg){const h=v>=0?pos:neg;v=Math.abs(v);const d=Math.floor(v);const m=Math.floor((v-d)*60);const s=((v-d)*60-m)*60;return d+"°"+String(m).padStart(2,"0")+"'"+s.toFixed(1).padStart(4,"0")+'" '+h}
function around(lat,lon){return AIRPORTS.map(a=>{const d=distMi(lat,lon,a.lat,a.lon);return Object.assign({},a,{dist:d,nm:d/NM,brg:bearing(lat,lon,a.lat,a.lon)})}).sort((a,b)=>a.dist-b.dist)}
/* Approximate controlled-surface rings. Real boundaries are irregular: the FAA layer or the chart decides. */
const RING={D:4,C:5}; // NM, surface area radius
function ringInfo(a){ if(a.cls==="D")return {r:RING.D,label:"Class D surface area, about 4 NM"}; if(a.cls==="C")return {r:RING.C,label:"Class C surface area, about 5 NM (shelf to about 10 NM)"}; return null }
function approxAir(list){
  const hits=[];
  list.forEach(a=>{
    if(a.cls==="D"&&a.nm<=RING.D)hits.push({cls:"D",a,why:"inside the approximate 4 NM Class D surface area of "+a.id});
    if(a.cls==="C"&&a.nm<=RING.C)hits.push({cls:"C",a,why:"inside the approximate 5 NM Class C surface area of "+a.id});
    if(a.cls==="B"&&a.nm<=6)hits.push({cls:"B",a,why:"within about 6 NM of "+a.id+", where Class B starts at or near the surface"});
  });
  return hits;
}

/* ---- sun (NOAA sunrise equation) ---- */
function sunTimes(lat,lon,date){
  const jd=date.getTime()/86400000+2440587.5;
  // Solar day nearest to this moment at this longitude (the old Math.ceil on the UTC Julian date jumped to TOMORROW every afternoon in the western US).
  const n=Math.round(jd-2451545.0-0.0009+lon/360);
  const Js=n-lon/360, M=(357.5291+0.98560028*Js)%360, Mr=toRad(M);
  const C=1.9148*Math.sin(Mr)+0.02*Math.sin(2*Mr)+0.0003*Math.sin(3*Mr);
  const lam=(M+C+180+102.9372)%360, lr=toRad(lam);
  const Jt=2451545.0+Js+0.0053*Math.sin(Mr)-0.0069*Math.sin(2*lr);
  const sd=Math.sin(lr)*Math.sin(toRad(23.4397)), cd=Math.cos(Math.asin(sd));
  const f=a=>{const c=(Math.sin(toRad(a))-Math.sin(toRad(lat))*sd)/(Math.cos(toRad(lat))*cd);if(c>1||c<-1)return null;return toDeg(Math.acos(c))};
  const toDate=j=>new Date((j-2440587.5)*86400000);
  const w=f(-0.833), c=f(-6);
  return {sunrise:w==null?null:toDate(Jt-w/360),sunset:w==null?null:toDate(Jt+w/360),civilBegin:c==null?null:toDate(Jt-c/360),civilEnd:c==null?null:toDate(Jt+c/360)};
}

/* ---- METAR / TAF decoding ---- */
const WXD={MI:"shallow",PR:"partial",BC:"patches of",DR:"low drifting",BL:"blowing",SH:"showers of",TS:"thunderstorm with",FZ:"freezing"};
const WXP={DZ:"drizzle",RA:"rain",SN:"snow",SG:"snow grains",IC:"ice crystals",PL:"ice pellets",GR:"hail",GS:"small hail",UP:"unknown precipitation",BR:"mist",FG:"fog",FU:"smoke",VA:"volcanic ash",DU:"dust",SA:"sand",HZ:"haze",PY:"spray",PO:"dust whirls",SQ:"squalls",FC:"funnel cloud",SS:"sandstorm",DS:"duststorm"};
const COVER={FEW:"Few clouds",SCT:"Scattered clouds",BKN:"Broken clouds",OVC:"Overcast"};
const WXRE=/^(\+|-|VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+|TS|SH|FZ)$/;
function decWx(t){const m=t.match(WXRE);if(!m)return null;let s="";const pre=m[1]||"";let body=m[2];if(pre==="+")s="Heavy ";else if(pre==="-")s="Light ";else if(pre==="VC")s="In the vicinity: ";const parts=[];while(body.length){const d=body.slice(0,2);if(WXD[d]){parts.push(WXD[d]);body=body.slice(2)}else if(WXP[d]){parts.push(WXP[d]);body=body.slice(2)}else break}return s+parts.join(" ")}
const cToF=c=>Math.round(c*9/5+32);
const tnum=s=>s[0]==="M"?-parseInt(s.slice(1),10):parseInt(s,10);
function hhmmLocal(day,hh,mm,now){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),day,hh,mm));if(d.getTime()-now.getTime()>2*86400000)d.setUTCMonth(d.getUTCMonth()-1);return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})+" local"}
/* decode one weather token shared by METAR and TAF; returns {label,text,data} or null */
function decCommon(t,ctx){
  let m;
  if((m=t.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT$/))){const calm=+m[2]===0;return {label:"Wind",text:calm?"Calm":(m[1]==="VRB"?"Variable":"From "+m[1]+"°")+" at "+(+m[2])+" kt"+(m[3]?", gusting "+(+m[3])+" kt":""),data:{wind:{dir:m[1],spd:+m[2],gust:m[3]?+m[3]:null}}}}
  if((m=t.match(/^(\d{3})V(\d{3})$/)))return {label:"Variable wind",text:"Direction varying between "+m[1]+"° and "+m[2]+"°"};
  if(/^(P|M)?\d+(\/\d+)?SM$/.test(t)){const x=t.replace("SM","");const p=x[0]==="P"?"more than ":x[0]==="M"?"less than ":"";const v=x.replace(/^[PM]/,"");let n=v.includes("/")?(+v.split("/")[0])/(+v.split("/")[1]):+v;return {label:"Visibility",text:p+v+" statute mile"+(n===1?"":"s"),data:{vis:p==="more than "?Math.max(n,6.1):n}}}
  if(/^\d{4}$/.test(t)&&ctx&&ctx.allowMeters){const n=+t;const sm=n>=9999?10:n/1609.34;return {label:"Visibility",text:(n>=9999?"10 km or more":n+" m")+" (about "+sm.toFixed(1)+" SM)",data:{vis:sm}}}
  if(t==="CAVOK")return {label:"CAVOK",text:"Visibility 10 km or more, no significant cloud",data:{vis:10,sky:[]}};
  if((m=t.match(/^R(\d{2}[LCR]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?FT$/)))return {label:"Runway visual range",text:"Runway "+m[1]+": "+(m[2]==="P"?"more than ":m[2]==="M"?"less than ":"")+m[3]+" ft"+(m[5]?" varying to "+m[5]+" ft":"")};
  if(t==="NSW")return {label:"Weather",text:"No significant weather"};
  const wx=decWx(t);if(wx&&!/^(TS|SH|FZ)$/.test(t)||(wx&&t.length>2))return {label:"Weather",text:wx,data:{wx:t}};
  if((m=t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/)))return {label:"Sky",text:COVER[m[1]]+" at "+(+m[2]*100).toLocaleString()+" ft above ground"+(m[3]?" ("+(m[3]==="CB"?"cumulonimbus":"towering cumulus")+")":""),data:{sky:[{c:m[1],h:+m[2]*100}]}};
  if((m=t.match(/^VV(\d{3})$/)))return {label:"Sky",text:"Vertical visibility "+(+m[1]*100).toLocaleString()+" ft (sky obscured)",data:{sky:[{c:"OVC",h:+m[1]*100}]}};
  if(["SKC","CLR","NSC"].includes(t))return {label:"Sky",text:t==="NSC"?"No significant cloud":"Clear skies",data:{sky:[]}};
  if((m=t.match(/^WS(\d{3})\/(\d{3})(\d{2,3})KT$/)))return {label:"Wind shear",text:"At "+(+m[1]*100)+" ft: wind from "+m[2]+"° at "+(+m[3])+" kt"};
  return null;
}
function flightCat(vis,sky){
  const ceil=(sky||[]).filter(s=>s.c==="BKN"||s.c==="OVC").reduce((a,s)=>Math.min(a,s.h),Infinity);
  const v=vis==null?10:vis;
  if(ceil<500||v<1)return "LIFR"; if(ceil<1000||v<3)return "IFR"; if(ceil<=3000||v<=5)return "MVFR"; return "VFR";
}
function decodeMetar(raw,now){
  now=now||new Date();
  const toks=raw.trim().replace(/\s+/g," ").split(" ");const items=[];const out={raw:raw.trim(),sky:[],wx:[],vis:null,wind:null,temp:null,dew:null,alt:null,station:null};
  let i=0,inRmk=false,m;
  while(i<toks.length){
    let t=toks[i];
    if(inRmk){
      let d=t;
      if(t==="AO2")d="Automated station with precipitation sensor";
      else if(t==="AO1")d="Automated station without precipitation sensor";
      else if((m=t.match(/^SLP(\d{3})$/))){const p=+m[1]/10;d="Sea-level pressure "+((p<50?1000+p:900+p)).toFixed(1)+" hPa"}
      else if((m=t.match(/^T([01])(\d{3})([01])(\d{3})$/))){const a=(m[1]==="1"?-1:1)*(+m[2])/10,b=(m[3]==="1"?-1:1)*(+m[4])/10;d="Precise temperature "+a.toFixed(1)+" °C, dew point "+b.toFixed(1)+" °C"}
      else if(t==="$")d="Station needs maintenance";
      else if(/^P\d{4}$/.test(t))d="Precipitation last hour "+(+t.slice(1)/100).toFixed(2)+" in";
      else d="";
      items.push({tok:t,label:"Remark",text:d||"Additional remark (see raw text)"});i++;continue;
    }
    if(t==="METAR"||t==="SPECI"){items.push({tok:t,label:"Report type",text:t==="METAR"?"Routine observation":"Special observation (conditions changed)"});i++;continue}
    if(!out.station&&/^[A-Z][A-Z0-9]{3}$/.test(t)){out.station=t;const ap=AIRPORTS.find(a=>a.icao===t);items.push({tok:t,label:"Station",text:t+(ap?" · "+ap.name:"")});i++;continue}
    if((m=t.match(/^(\d{2})(\d{2})(\d{2})Z$/))){out.time={day:+m[1],hh:+m[2],mm:+m[3]};items.push({tok:t,label:"Observed",text:"Day "+m[1]+" at "+m[2]+":"+m[3]+" UTC ("+hhmmLocal(+m[1],+m[2],+m[3],now)+")"});i++;continue}
    if(t==="AUTO"||t==="COR"){items.push({tok:t,label:t==="AUTO"?"Automated":"Correction",text:t==="AUTO"?"Fully automated report, no human observer":"Corrected report"});i++;continue}
    if(t==="RMK"){inRmk=true;items.push({tok:t,label:"Remarks",text:"Remarks section follows"});i++;continue}
    if(/^\d$/.test(t)&&/^\d\/\dSM$/.test(toks[i+1]||"")){const f=toks[i+1].replace("SM","").split("/");const n=+t+(+f[0])/(+f[1]);out.vis=n;items.push({tok:t+" "+toks[i+1],label:"Visibility",text:t+" "+f[0]+"/"+f[1]+" statute miles"});i+=2;continue}
    if((m=t.match(/^(M?\d{2})\/(M?\d{2})?$/))){out.temp=tnum(m[1]);out.dew=m[2]?tnum(m[2]):null;items.push({tok:t,label:"Temperature / dew point",text:out.temp+" °C ("+cToF(out.temp)+" °F)"+(out.dew!=null?", dew point "+out.dew+" °C ("+cToF(out.dew)+" °F)":"")});i++;continue}
    if((m=t.match(/^A(\d{4})$/))){out.alt=+m[1]/100;items.push({tok:t,label:"Altimeter",text:(+m[1]/100).toFixed(2)+" inHg"});i++;continue}
    if((m=t.match(/^Q(\d{4})$/))){out.alt=+m[1]*0.02953;items.push({tok:t,label:"Altimeter",text:m[1]+" hPa"});i++;continue}
    const d=decCommon(t,{allowMeters:true});
    if(d){if(d.data){const x=d.data;if(x.wind)out.wind=x.wind;if(x.vis!=null)out.vis=x.vis;if(x.sky)out.sky=out.sky.concat(x.sky);if(x.wx)out.wx.push(x.wx)}items.push({tok:t,label:d.label,text:d.text});i++;continue}
    items.push({tok:t,label:"Other",text:"Not decoded"});i++;
  }
  out.items=items;out.cat=flightCat(out.vis,out.sky);
  out.ceiling=out.sky.filter(s=>s.c==="BKN"||s.c==="OVC").reduce((a,s)=>Math.min(a,s.h),Infinity);if(out.ceiling===Infinity)out.ceiling=null;
  return out;
}
function decodeTaf(raw,now){
  now=now||new Date();
  const lines=raw.trim().split(/\n+/).map(s=>s.trim()).filter(Boolean);const flat=lines.join(" ").replace(/\s+/g," ");const toks=flat.split(" ");
  const groups=[];let cur={head:"Base forecast",tokens:[],items:[]};let i=0,m;
  const out={raw:raw.trim(),station:null,issued:null,valid:null,groups:groups,head:[]};
  while(i<toks.length){
    const t=toks[i];
    if(t==="TAF"||t==="AMD"||t==="COR"){out.head.push({tok:t,label:"Report type",text:t==="TAF"?"Terminal aerodrome forecast":t==="AMD"?"Amended forecast":"Corrected forecast"});i++;continue}
    if(!out.station&&/^[A-Z][A-Z0-9]{3}$/.test(t)){out.station=t;const ap=AIRPORTS.find(a=>a.icao===t);out.head.push({tok:t,label:"Station",text:t+(ap?" · "+ap.name:"")});i++;continue}
    if(!out.issued&&(m=t.match(/^(\d{2})(\d{2})(\d{2})Z$/))){out.issued=t;out.head.push({tok:t,label:"Issued",text:"Day "+m[1]+" at "+m[2]+":"+m[3]+" UTC ("+hhmmLocal(+m[1],+m[2],+m[3],now)+")"});i++;continue}
    if(!out.valid&&(m=t.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/))){out.valid=t;out.head.push({tok:t,label:"Valid",text:"Day "+m[1]+" "+m[2]+":00 UTC through day "+m[3]+" "+m[4]+":00 UTC"});i++;continue}
    if((m=t.match(/^FM(\d{2})(\d{2})(\d{2})$/))){groups.push(cur);cur={head:"FM "+t.slice(2),tokens:[t],items:[{tok:t,label:"From",text:"Conditions change permanently from day "+m[1]+" at "+m[2]+":"+m[3]+" UTC"}]};i++;continue}
    if(t==="TEMPO"||t==="BECMG"||/^PROB\d{2}$/.test(t)){
      groups.push(cur);let hd=t,txt;
      if(/^PROB/.test(t)){txt=t.slice(4)+"% chance of";if(toks[i+1]==="TEMPO"){hd=t+" TEMPO";txt+=" temporary fluctuations";i++}else txt+=" conditions"}
      else txt=t==="TEMPO"?"Temporary fluctuations (under an hour at a time)":"Gradual change";
      i++;let per="";if((m=(toks[i]||"").match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/))){per=toks[i];txt+=" between day "+m[1]+" "+m[2]+":00 and day "+m[3]+" "+m[4]+":00 UTC";i++}
      cur={head:hd+(per?" "+per:""),tokens:[],items:[{tok:hd+(per?" "+per:""),label:"Change group",text:txt}]};continue}
    if(/^T[XN]M?\d{2}\/\d{4}Z$/.test(t)){cur.items.push({tok:t,label:t[1]==="X"?"Max temperature":"Min temperature",text:t.slice(2).split("/")[0].replace("M","-")+" °C expected"});i++;continue}
    if(/^\d$/.test(t)&&/^\d\/\dSM$/.test(toks[i+1]||"")){const f=toks[i+1].replace("SM","").split("/");cur.items.push({tok:t+" "+toks[i+1],label:"Visibility",text:t+" "+f[0]+"/"+f[1]+" statute miles"});cur.vis=+t+(+f[0])/(+f[1]);i+=2;continue}
    const d=decCommon(t,{});
    if(d){if(d.data){if(d.data.vis!=null)cur.vis=d.data.vis;if(d.data.sky){cur.sky=(cur.sky||[]).concat(d.data.sky)}if(d.data.wind)cur.wind=d.data.wind}cur.items.push({tok:t,label:d.label,text:d.text});i++;continue}
    cur.items.push({tok:t,label:"Other",text:"Not decoded"});i++;
  }
  groups.push(cur);out.groups=groups.filter(g=>g.items.length);
  out.groups.forEach(g=>{g.cat=flightCat(g.vis,g.sky||[])});
  return out;
}

/* ---- parsing fetched/sample text ---- */
function splitMetars(txt){return txt.split(/\n+/).map(s=>s.trim()).filter(l=>/^(METAR |SPECI )?[A-Z][A-Z0-9]{3} \d{6}Z/.test(l))}
function splitTafs(txt){const blocks=[];let cur=null;txt.split(/\n/).forEach(l=>{if(!l.trim())return;if(/^\S/.test(l)){if(cur)blocks.push(cur);cur=l.trim()}else if(cur)cur+="\n  "+l.trim()});if(cur)blocks.push(cur);return blocks.filter(b=>/^(TAF )?[A-Z][A-Z0-9]{3} \d{6}Z|^TAF /.test(b))}
function stationOf(rawLine){const m=rawLine.replace(/^(METAR|SPECI|TAF)( AMD| COR)? /,"").match(/^([A-Z][A-Z0-9]{3})/);return m?m[1]:null}

/* ---- sample weather for the offline preview ---- */
const COASTAL=["KLAX","KHHR","KSMO","KTOA","KLGB","KSLI","KSNA","KFUL","KSAN","KMYF","KCRQ","KOXR","KCMA"];
function p2(n){return String(n).padStart(2,"0")}
function sampleWx(icao,now){
  now=now||new Date();let h=0;for(const c of icao)h=(h*31+c.charCodeAt(0))>>>0;
  const t=new Date(now.getTime()-7*60000);const day=p2(t.getUTCDate()),hh=p2(t.getUTCHours()),mm=p2(Math.floor(t.getUTCMinutes()/10)*10+3>59?53:Math.floor(t.getUTCMinutes()/10)*10+3);
  const coastal=COASTAL.includes(icao);const dir=240+(h%5)*10,spd=5+(h%7),gust=h%3===0?spd+7:null;
  const sky=coastal?"FEW008 BKN014":"FEW200";const vis=coastal?"6SM HZ":"10SM";const temp=coastal?14+(h%4):10+(h%5),dew=coastal?temp-3:temp-9;
  const metar="METAR "+icao+" "+day+hh+mm+"Z "+(p2(dir)+"").padStart(3,"0").slice(-3)+p2(spd)+(gust?"G"+p2(gust):"")+"KT "+vis+" "+sky+" "+p2(temp)+"/"+p2(dew)+" A"+(2995+(h%6))+" RMK AO2 SLP"+(150+(h%9))+" T0"+p2(temp)+"0"+"0"+p2(dew)+"0";
  const st=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate(),t.getUTCHours()));st.setUTCMinutes(0);
  const f=(o)=>{const d=new Date(st.getTime()+o*3600000);return p2(d.getUTCDate())+p2(d.getUTCHours())};
  const taf="TAF "+icao+" "+f(0)+"20Z "+f(0)+"/"+f(24)+" "+p2(dir)+p2(spd)+"KT P6SM "+sky+"\n  FM"+f(6)+"00 27010KT P6SM SCT025\n  TEMPO "+f(10)+"/"+f(14)+" 3SM BR BKN008\n  BECMG "+f(15)+"/"+f(17)+" 25006KT P6SM FEW010\n  PROB30 "+f(20)+"/"+f(23)+" 2SM BR OVC005";
  return {metar:metar,taf:taf};
}

/* ---- Plain-language status and LAANC request rules (pure: no DOM, testable in Node) ----
   explainStatus(st) -> {status, action, why, learnMoreAnchor}. Built from the same state the Airspace
   section uses, so the banner and the checks can't disagree. Missing values are left out, never guessed.
   validateRequest(req, ctx) follows LAANC-claude.md (Ky's LAANC reference): it wins where the two files differ. */
const CLASS_DEF={
  B:"the controlled airspace around the busiest airports",
  C:"controlled airspace around busy airports with a control tower and radar",
  D:"controlled airspace around an airport with a control tower",
  E:"controlled airspace that reaches the ground around some airports"
};
const ABBR={Intl:"International",Muni:"Municipal",Fld:"Field",Rgnl:"Regional",Arpt:"Airport",Exec:"Executive",Afb:"AFB",Aaf:"AAF",Mcas:"MCAS",Nas:"NAS"};
function niceAptName(n){return String(n||"").replace(/\b[A-Za-z]+\b/g,w=>ABBR[w]||w)}
// Label for the banner: the name without any bracketed alternate name, then the code, e.g. "Hawthorne Municipal (HHR)"
function aptLabel(a){const n=niceAptName(a.name).replace(/\s*\([^)]*\)\s*/g," ").trim();return n?n+" ("+a.id+")":a.id}
function listAnd(xs){xs=xs.filter(Boolean);return xs.length<2?(xs[0]||""):xs.slice(0,-1).join(", ")+" and "+xs[xs.length-1]}
const fmtTimeLocal=d=>d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})+" on "+d.toLocaleDateString([], {month:"short",day:"numeric"});
function ceilPhrase(ft,ground){return ft+" ft above the ground (AGL)"+(ground!=null?", which is "+(ground+ft)+" ft above sea level (MSL)":"")}
function savedSentence(c){return c&&(c.src==="saved"||c.src==="saved-lower")?"This uses saved FAA data from "+(c.eff||"an earlier date")+". Confirm in your LAANC app before you fly.":""}
/* st: {ov:{k,t,d}, fails:[{id,label,value}], cautions:[{id,label,value}], controlled, classes:["B"], airports:[{id,name}],
        ceil:{k,ft,src,eff}, groundFt, auth:{state,num,alt,to,from}, left, now} */
const CAUTION_TXT={
  gps:x=>/pin/.test(x.value)?"your launch pin isn't confirmed yet":/±/.test(x.value)?"your GPS position is approximate":"your position was typed in or picked from a preset, not read from GPS",
  notam:()=>"NOTAMs aren't checked by SkyClear, so check them yourself",
  sun:x=>/Night/.test(x.value)?"it's dark, so night rules apply (lights visible for 3 miles and night training)":"it's twilight, so anti-collision lights are required",
  tfr:x=>"a temporary flight restriction is nearby ("+x.value+")",
  apt:()=>"an airport is within 3 miles, so watch for low aircraft",
  ceil:()=>"the altitude limit here isn't confirmed",
  wxage:()=>"the weather report is getting old",
  saved:()=>"the saved FAA ceiling data is more than 30 days old"
};
function cautionTxt(x){const f=CAUTION_TXT[x.id];return f?f(x):String(x.label||"").toLowerCase()+" ("+x.value+")"}
function explainStatus(st){
  const out={status:st.ov.t,action:st.ov.d,why:"",learnMoreAnchor:"#sec-airspace",fixLink:null};
  const c=st.ceil||{},g=st.groundFt,why=[];
  const where=st.airports&&st.airports.length?" near "+listAnd(st.airports.slice(0,3).map(aptLabel)):"";
  const cls=[...new Set(st.classes||[])].filter(k=>CLASS_DEF[k]).sort();
  const clsTxt=cls.length?"Class "+listAnd(cls):"";
  const est=st.approx?"SkyClear's rough airport circles (the FAA airspace data didn't load) put you in ":"You are in ";
  const airspaceIntro=()=>clsTxt?est+clsTxt+" airspace"+where+". "+(cls.length===1?"Class "+cls[0]+" is "+CLASS_DEF[cls[0]]:"These are controlled airspace around airports")+", and drones need FAA permission to fly there.":est+"controlled airspace"+where+", and drones need FAA permission to fly there.";
  const k=st.ov.k;
  if(k==="hold"){
    const a=st.auth||{};
    if(a.state==="expired"){out.action="Your authorization has expired. Get a new one before launch.";why.push("Your authorization expired at "+fmtTimeLocal(a.to)+".");why.push("Enter a new LAANC authorization number, with its approved altitude and time window, to change this to GO.")}
    else if(a.state==="incomplete"){out.action="Finish entering your LAANC authorization.";why.push("You entered an authorization number. Add the approved altitude and the approved start and end time from your LAANC app, so SkyClear can check that it covers this flight.")}
    else if(a.state==="window"){out.action="Your authorization doesn't cover this flight's time.";why.push("Your LAANC authorization runs "+(a.from?"from "+fmtTimeLocal(a.from)+" ":"")+"until "+fmtTimeLocal(a.to)+", which doesn't cover the planned flight time. Change the planned time or get a new authorization.")}
    else if(a.state==="low"){out.action="Your authorization doesn't cover the planned altitude.";why.push("Your LAANC authorization allows up to "+a.alt+" ft AGL, which is lower than the "+a.planned+" ft AGL you planned. Lower the planned altitude or get a new authorization.")}
    else{
      why.push(airspaceIntro());
      why.push("LAANC is the FAA's quick online approval for drone flights near airports.");
      if(c.k==="ok"||c.k==="saved")why.push("Once LAANC approves you, you can fly up to "+ceilPhrase(c.ft,g)+" at this spot, and no higher than what was approved.");
      else if(c.k==="nogrid")why.push("The FAA has no LAANC grid at this spot, so LAANC can't approve it automatically. You would need an FAA authorization through DroneZone instead.");
      else if(c.k==="unk")why.push("The highest altitude LAANC allows here couldn't be confirmed right now.");
      why.push("Enter your LAANC authorization number to change this to GO.");
    }
  }else if(k==="stop"){
    out.action="Do not fly here right now. "+st.ov.d;
    const f=(st.fails||[]).slice(0,2);
    f.forEach(x=>{
      if(x.id==="tfr")why.push("You are inside an active temporary flight restriction (TFR), an area where the FAA has limited flying for now. Check the TFR on tfr.faa.gov before you fly.");
      else if(x.id==="ceil")why.push("The FAA's LAANC grid is 0 ft here"+where+", so LAANC can't approve a drone flight at this spot. Flying here needs extra coordination with the FAA or a waiver.");
      else if(x.id==="gps")why.push("Your GPS position is missing or more than 5 minutes old, so SkyClear can't be sure where you are. Press Use my GPS again at the launch spot.");
      else if(["wind","gust","vis","cloud","precip","wxage"].includes(x.id))why.push("The weather is outside safe or legal limits: "+x.label.toLowerCase()+" is "+x.value+".");
      else why.push(x.label+": "+x.value+".");
    });
    why.push("This changes to GO only when "+(f.length>1?"these are":"this is")+" fixed.");
  }else if(k==="info"){
    why.push("The checks SkyClear can do on its own"+(st.cautions&&st.cautions.length?" are done, with "+st.cautions.length+" caution"+(st.cautions.length>1?"s":"")+" to read":" passed")+". "+st.left+" pilot confirmation"+(st.left>1?"s":"")+" in the Pre-flight checklist on the Pilot & LAANC tab "+(st.left>1?"are":"is")+" still not ticked.");
    if(st.auth&&st.auth.state==="ok")why.push("Your LAANC authorization "+st.auth.num+" covers this flight up to "+st.auth.alt+" ft AGL until "+fmtTimeLocal(st.auth.to)+".");
    else if(!st.controlled&&c.ft!=null)why.push("No FAA airspace permission is needed here. Stay at or below "+ceilPhrase(c.ft,g)+".");
  }else if(k==="warn"){
    why.push("You may fly, but read these first: "+(st.cautions||[]).slice(0,3).map(cautionTxt).join("; ")+".");
    if(st.auth&&st.auth.state==="ok")why.push("Your LAANC authorization "+st.auth.num+" covers this flight up to "+st.auth.alt+" ft AGL until "+fmtTimeLocal(st.auth.to)+".");
  }else if(k==="go"){
    if(st.auth&&st.auth.state==="ok")why.push("Your LAANC authorization "+st.auth.num+" covers this flight. Fly no higher than "+st.auth.alt+" ft AGL"+(g!=null?" ("+(g+st.auth.alt)+" ft MSL)":"")+", and land by "+fmtTimeLocal(st.auth.to)+".");
    else if(c.ft!=null)why.push("No FAA airspace permission is needed here. Stay at or below "+ceilPhrase(c.ft,g)+".");
  }
  // Pilot tab fix button (Pilot tab brief section 4): LAANC first when that is the hold, then missing profile items
  const miss=st.missing||{};
  const laancHold=k==="hold"&&(!st.auth||["none","incomplete","expired","window","low"].includes(st.auth.state));
  if(laancHold)out.fixLink={label:"Go to LAANC request",tab:"pilot",section:"laanc"};
  else if(k!=="stop"){
    if(miss.cert){out.fixLink={label:"Add your pilot certificate",tab:"pilot",section:"pilot"};why.push("Your pilot certificate number is missing. Add it on the Pilot & LAANC tab.")}
    else if(miss.reg){out.fixLink={label:"Add your aircraft details",tab:"pilot",section:"aircraft"};why.push("Your aircraft registration number is missing. Add it on the Pilot & LAANC tab.")}
    else if(miss.rid){out.fixLink={label:"Add your Remote ID",tab:"pilot",section:"rid"};why.push("Your Remote ID is missing. Add it on the Pilot & LAANC tab.")}
    else if(k==="info"&&st.left>0)out.fixLink={label:"Finish the pre-flight checklist",tab:"pilot",section:"checklist"};
  }
  const sv=savedSentence(c);if(sv&&k!=="stop"||sv&&(st.fails||[]).some(x=>x.id==="ceil"))why.push(sv);
  out.why=why.join(" ");
  return out;
}

/* Tabs and hash routing (Pilot tab brief). "#pilot:laanc" = Pilot tab scrolled to a section.
   Old links keep working: "#laanc" opens the Pilot & LAANC tab at the LAANC request; "#flight" = "#preflight". */
const TAB_HASH={pre:"preflight",pilot:"pilot",req:"requirements",res:"resources"};
const PILOT_SECTIONS=["pilot","aircraft","rid","checklist","laanc","guides"];
function parseHash(h){
  h=String(h||"").replace(/^#/,"").toLowerCase();
  const [a,b]=h.split(":");
  if(a==="laanc")return {tab:"pilot",section:"laanc"};
  if(a==="flight"||a==="preflight"||a==="")return {tab:"pre",section:null};
  const tab=Object.keys(TAB_HASH).find(k=>TAB_HASH[k]===a);
  if(!tab)return {tab:"pre",section:null};
  return {tab,section:tab==="pilot"&&PILOT_SECTIONS.includes(b)?b:null};
}
function tabHash(tab,section){return "#"+(TAB_HASH[tab]||"preflight")+(section?":"+section:"")}
/* What the Pilot tab still needs. p = profile fields; laanc = {needed, done} (needed: LAANC applies here; done: request
   complete or a covering authorization is entered). Returns [{id, section, msg}] in plain words. */
function pilotIssues(p,laanc){
  const out=[];
  if(!String(p.pilot||"").trim())out.push({id:"pilot",section:"pilot",msg:"Your name is missing."});
  if(!String(p.cert||"").trim())out.push({id:"cert",section:"pilot",msg:"Your pilot certificate number is missing."});
  if(!String(p.model||"").trim())out.push({id:"model",section:"aircraft",msg:"The aircraft make and model is missing."});
  if(!String(p.reg||"").trim())out.push({id:"reg",section:"aircraft",msg:"The aircraft registration number is missing."});
  if(!p.ridType||(p.ridType!=="fria"&&!String(p.ridId||"").trim()))out.push({id:"rid",section:"rid",msg:"Remote ID is missing."});
  if(laanc&&laanc.needed&&!laanc.done)out.push({id:"laanc",section:"laanc",msg:"Your LAANC request isn't finished."});
  return out;
}

/* LAANC request rules (LAANC-claude.md sections 6-8). req: {start:Date|null, durMin, alt, purpose, phone, email}
   ctx: {pilot, cert, certDate, trnDate, model, reg, regExp, ridType, ridId, lat, lon, groundFt, classes, ceil:{k,ft,src,eff}, wxOk, now, sunrise, sunset} */
function validateRequest(req,ctx){
  const missing=[],errors=[],warnings=[],now=ctx.now||new Date();
  const need=(ok,field,where)=>{if(!ok)missing.push({field,where})};
  const nm=String(ctx.pilot||"").trim().split(/\s+/);
  need(nm.length>=2,"Pilot first and last name","the Pilot section on the Pilot & LAANC tab");
  need(!!ctx.cert,"Remote Pilot Certificate number","the Pilot section on the Pilot & LAANC tab");
  need(!!ctx.certDate,"Certificate issue date","the Pilot section on the Pilot & LAANC tab");
  need(!!ctx.model,"Aircraft make and model","the Aircraft section on the Pilot & LAANC tab");
  need(!!ctx.reg,"FAA registration number","the Aircraft section on the Pilot & LAANC tab");
  need(!!ctx.ridType,"Remote ID method","the Remote ID section on the Pilot & LAANC tab");
  need(isFinite(ctx.lat)&&isFinite(ctx.lon),"Launch position","the location bar at the top");
  need(ctx.groundFt!=null,"Ground elevation","wait for it to load, or press Refresh");
  need(ctx.classes&&ctx.classes.length>0,"Airspace class","wait for the FAA airspace lookup, or press Refresh");
  need(ctx.ceil&&ctx.ceil.ft!=null||ctx.ceil&&ctx.ceil.k==="nogrid","LAANC grid ceiling","it could not be loaded; press Refresh");
  need(!!ctx.wxOk,"Live weather summary","the weather is not live right now; press Refresh");
  need(req.start instanceof Date&&!isNaN(req.start),"Planned start time","this section");
  need(req.durMin>0,"Duration","this section");
  need(req.alt>0,"Requested altitude","this section");
  need(!!String(req.purpose||"").trim(),"Purpose of flight","this section");
  need(String(req.phone||"").replace(/\D/g,"").length>=10,"Contact phone number","the Pilot section on the Pilot & LAANC tab");
  if(req.start instanceof Date&&!isNaN(req.start)){
    if(req.start.getTime()<now.getTime()-60000)errors.push("The start time is in the past. Pick a time from now on.");
    if(req.start.getTime()>now.getTime()+90*86400000)errors.push("LAANC requests can be made up to 90 days ahead. Pick an earlier start.");
  }
  if(req.alt>400)errors.push("LAANC covers flights at or below 400 ft AGL.");
  let fc=false;const c=ctx.ceil||{};
  if(c.k==="nogrid")warnings.push("LAANC isn't available at this spot (no FAA grid). Use the FAA DroneZone manual airspace authorization instead, and apply well ahead: the FAA asks for about 60 days.");
  if(c.ft!=null&&req.alt>0&&req.alt<=400&&req.alt>c.ft){
    fc=true;
    warnings.push(c.ft===0?"Automatic approval isn't available here: the grid is 0 ft, so only a Further Coordination request applies. It is reviewed by FAA air traffic, is not instant, and is for Part 107 pilots only.":"LAANC can approve up to "+c.ft+" ft here automatically. "+req.alt+" ft would be a Further Coordination request: reviewed by FAA air traffic, not instant, and for Part 107 pilots only.");
    if(req.start instanceof Date&&req.start.getTime()<now.getTime()+48*3600000)warnings.push("Further Coordination requests should be sent at least 48 hours before the flight.");
  }
  if(c.src==="saved"||c.src==="saved-lower")warnings.push("This ceiling is from saved FAA data"+(c.eff?" ("+c.eff+")":"")+". Confirm it in your LAANC app before you submit.");
  if(ctx.regExp){const d=new Date(ctx.regExp+"T23:59:59");if(!isNaN(d)&&d<now)errors.push("The drone's FAA registration expired on "+ctx.regExp+". Renew it in FAA DroneZone.")}
  if(ctx.trnDate){const d=new Date(ctx.trnDate+"T00:00:00");if(!isNaN(d)){const due=new Date(d);due.setMonth(due.getMonth()+25);due.setDate(0);if(due<now)warnings.push("Your recurrent training date is more than 24 calendar months ago. Check that your Part 107 currency is up to date.")}}
  let night=false;if(req.start instanceof Date&&ctx.sunrise&&ctx.sunset){const t=req.start.getTime(),end=t+(req.durMin||0)*60000;night=t<ctx.sunrise.getTime()||end>ctx.sunset.getTime()}
  if(night)warnings.push("Part of this flight is outside daylight (night operation): you need anti-collision lights visible for 3 statute miles and current night training.");
  return {missing,errors,warnings,fc,night,ok:!missing.length&&!errors.length};
}
/* Authorization coverage: GO only when the number, approved altitude and window all cover the flight. */
function authState(a,plan,now){
  if(!a||String(a.num||"").trim().length<6)return {state:"none"};
  const num=String(a.num).trim().toUpperCase();
  if(!(a.alt>0)||!(a.to instanceof Date)||isNaN(a.to))return {state:"incomplete",num};
  const from=a.from instanceof Date&&!isNaN(a.from)?a.from:null;
  if(a.to.getTime()<=now.getTime())return {state:"expired",num,alt:a.alt,from,to:a.to};
  const s=plan&&plan.start instanceof Date&&!isNaN(plan.start)?plan.start:now,e=new Date(s.getTime()+((plan&&plan.durMin)||0)*60000);
  if((from&&s<from)||e>a.to)return {state:"window",num,alt:a.alt,from,to:a.to};
  if(plan&&plan.alt>0&&a.alt<plan.alt)return {state:"low",num,alt:a.alt,planned:plan.alt,from,to:a.to};
  return {state:"ok",num,alt:a.alt,from,to:a.to};
}

if(typeof module!=="undefined")module.exports={parseHash,tabHash,pilotIssues,TAB_HASH,explainStatus,validateRequest,authState,niceAptName,AIRPORTS,PRESETS,distMi,bearing,compass,around,approxAir,sunTimes,decodeMetar,decodeTaf,sampleWx,flightCat,splitMetars,splitTafs,stationOf,dms,CHART,NM,RING,ringInfo};
