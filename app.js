import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = id => document.getElementById(id);
const deg = THREE.MathUtils.degToRad;
const BLACK_PCS = new Set([1,3,6,8,10]);
const WHITE_INDEX = {0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CONFIG_IDS = [
  'rangeFrom','rangeTo','showLabels','sizePreset','wireframe','renderQuality',
  'whiteWidth','whiteLength','whiteThickness','frontRadius',
  'blackWidth','blackBaseWidth','blackLength','blackHeight','keyGap','pressAngle',
  'whiteColor','blackColor','whiteRoughness','blackRoughness',
  'projection','cameraX','cameraY','cameraZ','cameraRotX','cameraRotY','cameraRotZ','cameraZoom','cameraFov',
  'ambientIntensity','mainIntensity','lightX','lightY','lightZ','shadows',
  'outputWidth','outputHeight','outputScale','backgroundColor','transparentBg','cropIndividual'
];
const GEOMETRY_IDS = new Set([
  'rangeFrom','rangeTo','showLabels','whiteWidth','whiteLength','whiteThickness','frontRadius',
  'blackWidth','blackBaseWidth','blackLength','blackHeight','keyGap','whiteColor','blackColor',
  'whiteRoughness','blackRoughness','wireframe','renderQuality'
]);
const OUTPUT_IDS = new Set(['outputWidth','outputHeight']);
const SIZE_IDS = new Set(['whiteWidth','whiteLength','whiteThickness','frontRadius','blackWidth','blackBaseWidth','blackLength','blackHeight','keyGap']);

// One constant scene scale keeps real-world size differences between presets.
const MM_TO_SCENE = 48 / 22.65;
const mm = value => +(value * MM_TO_SCENE).toFixed(2);
const SIZE_PRESETS = {
  piano: {
    whiteWidth:mm(22.65), whiteLength:mm(150), whiteThickness:mm(10), frontRadius:mm(1.5),
    blackWidth:mm(10.25), blackBaseWidth:mm(10.25), blackLength:mm(95), blackHeight:mm(12), keyGap:3
  },
  cz101: {
    whiteWidth:mm(18.5), whiteLength:mm(86), whiteThickness:mm(7), frontRadius:mm(1.2),
    blackWidth:mm(7.5), blackBaseWidth:mm(8.5), blackLength:mm(48), blackHeight:mm(9), keyGap:3
  },
  microkorg: {
    whiteWidth:mm(17.5), whiteLength:mm(80), whiteThickness:mm(7), frontRadius:mm(1.2),
    blackWidth:mm(6.75), blackBaseWidth:mm(6.75), blackLength:mm(45), blackHeight:mm(8.5), keyGap:3
  }
};

const viewport = $('viewport');
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true, premultipliedAlpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
renderer.domElement.style.background = 'transparent';
renderer.domElement.classList.add('artboard-canvas');
viewport.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnvironment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const ambient = new THREE.AmbientLight(0xffffff, 0);
scene.add(ambient);

const mainTarget = new THREE.Object3D();
const fillTarget = new THREE.Object3D();
const rimTarget = new THREE.Object3D();
scene.add(mainTarget, fillTarget, rimTarget);

const mainLight = new THREE.DirectionalLight(0xffffff, 6.6);
mainLight.castShadow = true;
mainLight.shadow.bias = -0.00015;
mainLight.shadow.normalBias = 0.02;
mainLight.shadow.radius = 2;
mainLight.target = mainTarget;
scene.add(mainLight);

const fillLight = new THREE.DirectionalLight(0xdde7ff, 0);
fillLight.target = fillTarget;
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xfff1dc, 0);
rimLight.target = rimTarget;
scene.add(rimLight);

const orthoCamera = new THREE.OrthographicCamera(-100,100,100,-100,0.1,4000);
const perspectiveCamera = new THREE.PerspectiveCamera(35,1,0.1,4000);
let camera = perspectiveCamera;

const keyboardGroup = new THREE.Group();
scene.add(keyboardGroup);
let shadowCatcher = null;
let keyRecords = [];
let layout = {width:1,length:1,centerX:0,centerY:0,centerZ:0,box:null};
let rebuildQueued = false;
let previewSize = {width:1,height:1};
let applyingPreset = false;

function parseNote(text){
  const m = String(text).trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if(!m) return null;
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()];
  let pc = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  let oct = Number(m[3]);
  while(pc < 0){ pc += 12; oct--; }
  while(pc >= 12){ pc -= 12; oct++; }
  const midi = (oct + 1) * 12 + pc;
  return midi >= 0 && midi <= 127 ? midi : null;
}
function noteName(m){ return `${NOTE_NAMES[m%12]}${Math.floor(m/12)-1}`; }
function isBlack(m){ return BLACK_PCS.has(m%12); }
function whiteOrdinal(m){ return Math.floor(m/12)*7 + WHITE_INDEX[m%12]; }
function n(id){ return Number($(id).value); }
function b(id){ return $(id).checked; }
function setValue(id,value){ const el=$(id); if(el) el.value=String(value); }

function disposeObject(object){
  object.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
    }
  });
}
function clearGroup(group){
  disposeObject(group);
  while(group.children.length) group.remove(group.children[0]);
}

function roundedWhiteShape(w,len,blackLen,leftNotch,rightNotch,gap,radius){
  const x0 = gap/2, x1 = w-gap/2;
  const notchHalf = Math.max(n('blackWidth'), n('blackBaseWidth'))/2 + gap/2;
  const backL = leftNotch ? Math.min(x1-1, x0+notchHalf) : x0;
  const backR = rightNotch ? Math.max(x0+1, x1-notchHalf) : x1;
  const notchY = -Math.min(blackLen+1, len*0.72);
  const r = Math.max(0, Math.min(radius, w/4, len/8));
  const s = new THREE.Shape();
  s.moveTo(backL,0); s.lineTo(backR,0);
  if(rightNotch){ s.lineTo(backR,notchY); s.lineTo(x1,notchY); }
  s.lineTo(x1,-len+r);
  if(r>0) s.quadraticCurveTo(x1,-len,x1-r,-len); else s.lineTo(x1,-len);
  s.lineTo(x0+r,-len);
  if(r>0) s.quadraticCurveTo(x0,-len,x0,-len+r); else s.lineTo(x0,-len);
  if(leftNotch){ s.lineTo(x0,notchY); s.lineTo(backL,notchY); }
  s.closePath();
  return s;
}

function keyMaterial(color,roughness,kind='white'){
  const quality = $('renderQuality').value;
  const wireframe = b('wireframe');
  if(quality === 'asset'){
    return new THREE.MeshBasicMaterial({color:new THREE.Color(color), wireframe, toneMapped:false, side:THREE.FrontSide});
  }
  const black = kind === 'black';
  return new THREE.MeshPhysicalMaterial({
    color:new THREE.Color(color),
    roughness:black ? Math.max(0.3, Math.min(roughness,0.48)) : Math.max(roughness,0.42),
    metalness:0,
    clearcoat:quality === 'product' ? (black?0.38:0.32) : (black?0.25:0.20),
    clearcoatRoughness:black ? 0.30 : 0.38,
    ior:1.46,
    specularIntensity:black ? 0.55 : 0.45,
    envMapIntensity:0,
    transparent:false,
    opacity:1,
    transmission:0,
    thickness:0,
    wireframe,
    side:THREE.FrontSide
  });
}

function createWhiteKey(midi,x,visibleSet){
  const w=n('whiteWidth'), len=n('whiteLength'), t=n('whiteThickness'), gap=n('keyGap');
  const shape=roundedWhiteShape(
    w,len,n('blackLength'),
    visibleSet.has(midi-1)&&isBlack(midi-1),
    visibleSet.has(midi+1)&&isBlack(midi+1),
    gap,n('frontRadius')
  );
  const bevel=Math.min(1.1,t*0.12,w*0.035);
  const geo=new THREE.ExtrudeGeometry(shape,{depth:t,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel});
  geo.translate(0,0,-t);
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,keyMaterial($('whiteColor').value,n('whiteRoughness'),'white'));
  mesh.castShadow=true; mesh.receiveShadow=true; mesh.userData.midi=midi;
  const pivot=new THREE.Group(); pivot.position.x=x; pivot.add(mesh); pivot.userData={midi,kind:'white'};
  return {midi,name:noteName(midi),kind:'white',pivot,mesh,x,width:w};
}

function blackKeyGeometry(w,baseW,len,h,gap){
  const bodyW=Math.max(2,w-Math.min(gap,w/6));
  const rootW=Math.max(bodyW,baseW-Math.min(gap,baseW/6));
  const bodyHalf=bodyW/2, rootHalf=rootW/2;
  const rearY=0;
  const rootY=-Math.min(14,Math.max(5,len*0.16));
  const frontY=-len;
  const nose=Math.min(16,Math.max(7,len*0.16));
  const noseY=frontY+nose;
  const zFront=Math.max(h*0.18,1.5);
  const sections=[
    {y:rearY,z:h,half:rootHalf},
    {y:rootY,z:h,half:bodyHalf},
    {y:noseY,z:h,half:bodyHalf},
    {y:frontY,z:zFront,half:bodyHalf}
  ];
  const verts=[];
  for(const q of sections) verts.push(-q.half,q.y,0, q.half,q.y,0, -q.half,q.y,q.z, q.half,q.y,q.z);
  const idx=[];
  for(let i=0;i<sections.length-1;i++){
    const a=i*4,c=(i+1)*4;
    idx.push(
      a,c,c+1,a,c+1,a+1,
      a+2,a+3,c+3,a+2,c+3,c+2,
      a,a+2,c+2,a,c+2,c,
      a+1,c+1,c+3,a+1,c+3,a+3
    );
  }
  idx.push(0,1,3,0,3,2);
  const f=(sections.length-1)*4;
  idx.push(f,f+2,f+3,f,f+3,f+1);
  let geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(idx);
  geo=geo.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

function createBlackKey(midi,boundaryX){
  const w=n('blackWidth'), baseW=n('blackBaseWidth'), len=n('blackLength'), h=n('blackHeight'), gap=n('keyGap');
  const geo=blackKeyGeometry(w,baseW,len,h,gap);
  const mesh=new THREE.Mesh(geo,keyMaterial($('blackColor').value,n('blackRoughness'),'black'));
  mesh.position.z=0.6;
  mesh.castShadow=true; mesh.receiveShadow=true; mesh.userData.midi=midi;
  if('flatShading' in mesh.material){ mesh.material.flatShading=true; mesh.material.needsUpdate=true; }
  const pivot=new THREE.Group(); pivot.position.set(boundaryX,0,0.5); pivot.add(mesh); pivot.userData={midi,kind:'black'};
  return {midi,name:noteName(midi),kind:'black',pivot,mesh,x:boundaryX-w/2,width:w};
}

function makeLabel(text,x,y,z){
  const c=document.createElement('canvas'); c.width=160; c.height=64;
  const ctx=c.getContext('2d');
  ctx.font='600 26px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='rgba(25,25,25,.75)'; ctx.fillText(text,80,32);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sp.position.set(x,y,z); sp.scale.set(32,12,1); return sp;
}

function updateShadowCatcher(){
  if(shadowCatcher){ scene.remove(shadowCatcher); disposeObject(shadowCatcher); shadowCatcher=null; }
  const pad=Math.max(30,n('whiteWidth')*0.8);
  const geo=new THREE.PlaneGeometry(layout.width+pad*2,layout.length+pad*2);
  const mat=new THREE.ShadowMaterial({color:0x000000,opacity:0.2,transparent:true,depthWrite:false});
  shadowCatcher=new THREE.Mesh(geo,mat);
  shadowCatcher.position.set(layout.centerX,layout.centerY,-n('whiteThickness')-1.4);
  shadowCatcher.receiveShadow=true;
  shadowCatcher.renderOrder=-1;
  scene.add(shadowCatcher);
}

function updateLightFrustum(){
  const span=Math.max(layout.width,layout.length)*0.8+100;
  mainLight.shadow.camera.left=-span;
  mainLight.shadow.camera.right=span;
  mainLight.shadow.camera.top=span;
  mainLight.shadow.camera.bottom=-span;
  mainLight.shadow.camera.near=1;
  mainLight.shadow.camera.far=Math.max(2500,span*6);
  mainLight.shadow.camera.updateProjectionMatrix();
}

function buildKeyboard(){
  const from=parseNote($('rangeFrom').value), to=parseNote($('rangeTo').value);
  $('rangeFrom').classList.toggle('status-error',from===null);
  $('rangeTo').classList.toggle('status-error',to===null || (from!==null&&to<from));
  if(from===null||to===null||to<from) return;

  clearGroup(keyboardGroup);
  keyRecords=[];
  const visible=[]; for(let m=from;m<=to;m++) visible.push(m);
  const visibleSet=new Set(visible);
  const whites=visible.filter(m=>!isBlack(m));
  const baseOrdinal=whites.length?Math.min(...whites.map(whiteOrdinal)):whiteOrdinal(from);
  const ww=n('whiteWidth');

  for(const midi of whites){
    const x=(whiteOrdinal(midi)-baseOrdinal)*ww;
    const rec=createWhiteKey(midi,x,visibleSet);
    keyboardGroup.add(rec.pivot); keyRecords.push(rec);
    if(b('showLabels')) rec.pivot.add(makeLabel(rec.name,ww/2,-n('whiteLength')+18,1));
  }
  for(const midi of visible.filter(isBlack)){
    const boundary=(whiteOrdinal(midi)-baseOrdinal+1)*ww;
    const rec=createBlackKey(midi,boundary);
    keyboardGroup.add(rec.pivot); keyRecords.push(rec);
  }
  keyRecords.sort((a,c)=>a.midi-c.midi);

  const box=new THREE.Box3().setFromObject(keyboardGroup), size=new THREE.Vector3(), center=new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  layout={width:Math.max(size.x,1),length:Math.max(size.y,1),centerX:center.x,centerY:center.y,centerZ:center.z,box};
  updateShadowCatcher(); updateLightFrustum(); updatePressedSelect(); resizePreview(); updateSceneSettings();
  $('rangeInfo').textContent=`${noteName(from)}–${noteName(to)}`;
  $('keyCount').textContent=`${keyRecords.length} keys · ${whites.length} white / ${keyRecords.length-whites.length} black`;
}

function updatePressedSelect(){
  const sel=$('pressedNote'), old=sel.value;
  sel.innerHTML='<option value="">None</option>';
  keyRecords.forEach(r=>{ const o=document.createElement('option'); o.value=r.midi; o.textContent=r.name; sel.appendChild(o); });
  if(keyRecords.some(r=>String(r.midi)===old)) sel.value=old;
  applyPressedPreview();
}
function applyPressedPreview(){
  const has=$('pressedNote').value!=='';
  const selected=Number($('pressedNote').value);
  const angle=deg(n('pressAngle'));
  keyRecords.forEach(r=>r.pivot.rotation.x=(has&&r.midi===selected)?angle:0);
  $('pressAngleOut').textContent=`${n('pressAngle')}°`;
  render();
}

function activeCamera(){ return $('projection').value==='perspective' ? perspectiveCamera : orthoCamera; }
function updateCamera(sizeOverride=null){
  camera=activeCamera();
  const width=sizeOverride?.width||previewSize.width||1, height=sizeOverride?.height||previewSize.height||1, aspect=width/height;
  const target=new THREE.Vector3(layout.centerX,layout.centerY,layout.centerZ);
  const offset=new THREE.Vector3(n('cameraX'),n('cameraY'),n('cameraZ'));
  offset.applyEuler(new THREE.Euler(deg(n('cameraRotX')),deg(n('cameraRotY')),deg(n('cameraRotZ')),'XYZ'));
  camera.position.copy(target).add(offset);
  if(camera===perspectiveCamera){ camera.aspect=aspect; camera.fov=n('cameraFov'); }
  else{
    const halfH=Math.max(layout.length*0.72,80);
    camera.left=-halfH*aspect; camera.right=halfH*aspect; camera.top=halfH; camera.bottom=-halfH; camera.zoom=n('cameraZoom');
  }
  camera.lookAt(target); camera.updateProjectionMatrix();
}

function updateSceneSettings(){
  const quality=$('renderQuality').value;
  const ambientLevel=Math.max(0,n('ambientIntensity'));
  const ambientNorm=Math.min(1,ambientLevel/1.25);
  const center=new THREE.Vector3(layout.centerX,layout.centerY,layout.centerZ);

  ambient.intensity=quality==='asset'?0:ambientLevel;
  mainLight.intensity=quality==='asset'?0:n('mainIntensity');
  mainTarget.position.copy(center);
  fillTarget.position.copy(center);
  rimTarget.position.copy(center);
  mainLight.position.set(center.x+n('lightX'),center.y+n('lightY'),center.z+n('lightZ'));
  fillLight.position.set(center.x-340,center.y+120,center.z+220);
  rimLight.position.set(center.x+280,center.y+180,center.z+360);

  if(quality==='asset'){
    fillLight.intensity=0; rimLight.intensity=0; scene.environment=null;
  }else{
    fillLight.intensity=(quality==='product'?1.35:0.95)*ambientNorm;
    rimLight.intensity=(quality==='product'?1.55:1.05)*ambientNorm;
    scene.environment=studioEnvironment;
  }
  if('environmentIntensity' in scene) scene.environmentIntensity=quality==='asset'?0:(quality==='product'?1.0:0.72)*ambientNorm;

  renderer.toneMappingExposure=quality==='product'?1.04:1;
  renderer.shadowMap.enabled=b('shadows') && quality!=='asset';
  mainLight.castShadow=renderer.shadowMap.enabled;
  const mapSize=quality==='product'?4096:2048;
  if(mainLight.shadow.mapSize.x!==mapSize){ mainLight.shadow.mapSize.set(mapSize,mapSize); if(mainLight.shadow.map){mainLight.shadow.map.dispose();mainLight.shadow.map=null;} }
  mainLight.shadow.radius=quality==='product'?3:2;

  if(shadowCatcher){
    shadowCatcher.visible=b('shadows') && quality!=='asset';
    shadowCatcher.material.opacity=quality==='product'?0.24:0.20;
  }
  keyRecords.forEach(r=>{
    if(r.mesh?.material && 'envMapIntensity' in r.mesh.material){
      r.mesh.material.envMapIntensity=quality==='asset'?0:(quality==='product'?1.0:0.72)*ambientNorm;
      r.mesh.material.needsUpdate=true;
    }
  });

  const transparent=b('transparentBg');
  scene.background=transparent?null:new THREE.Color($('backgroundColor').value);
  renderer.setClearColor(transparent?0x000000:new THREE.Color($('backgroundColor').value),transparent?0:1);
  renderer.setClearAlpha(transparent?0:1);
  renderer.domElement.classList.toggle('transparent-artboard',transparent);
  renderer.domElement.style.setProperty('--artboard-bg',$('backgroundColor').value);
  updateCamera(); render();
}

function render(){ renderer.render(scene,camera); }
function resizePreview(){
  const vw=Math.max(viewport.clientWidth,1), vh=Math.max(viewport.clientHeight,1);
  const ratio=Math.max(1/32,n('outputWidth'))/Math.max(1,n('outputHeight'));
  const pad=28, aw=Math.max(1,vw-pad*2), ah=Math.max(1,vh-pad*2);
  let w=aw,h=w/ratio; if(h>ah){h=ah;w=h*ratio;}
  previewSize={width:Math.max(1,Math.round(w)),height:Math.max(1,Math.round(h))};
  renderer.setSize(previewSize.width,previewSize.height,false);
  renderer.domElement.style.width=`${previewSize.width}px`; renderer.domElement.style.height=`${previewSize.height}px`;
  $('renderSize').textContent=`${n('outputWidth')} × ${n('outputHeight')}`;
  updateCamera(); render();
}

function fitCamera(){
  setValue('cameraX',0); setValue('cameraRotX',0); setValue('cameraRotY',0); setValue('cameraRotZ',0); setValue('cameraZoom',1);
  const len=n('whiteLength'); setValue('cameraY',Math.round(-len*1.35)); setValue('cameraZ',Math.round(Math.max(260,len*2.1)));
  syncAllControls(); updateCamera();
  if(!layout.box) return render();
  const corners=[];
  for(const x of [layout.box.min.x,layout.box.max.x]) for(const y of [layout.box.min.y,layout.box.max.y]) for(const z of [layout.box.min.z,layout.box.max.z]) corners.push(new THREE.Vector3(x,y,z));
  if(camera===perspectiveCamera){
    for(let i=0;i<12;i++){
      updateCamera(); let maxX=0,maxY=0;
      for(const v of corners){ const q=v.clone().project(camera); maxX=Math.max(maxX,Math.abs(q.x)); maxY=Math.max(maxY,Math.abs(q.y)); }
      const overflow=Math.max(maxX/0.88,maxY/0.84); if(overflow<=1.001) break;
      setValue('cameraY',(n('cameraY')*overflow*1.04).toFixed(2)); setValue('cameraZ',(n('cameraZ')*overflow*1.04).toFixed(2));
    }
  }else{
    updateCamera(); let max=0;
    for(const v of corners){const q=v.clone().project(camera);max=Math.max(max,Math.abs(q.x)/0.88,Math.abs(q.y)/0.84);}
    if(max>0) setValue('cameraZoom',(n('cameraZoom')/max).toFixed(3));
  }
  syncAllControls(); updateCamera(); render();
}

function queueRebuild(){
  if(rebuildQueued) return;
  rebuildQueued=true;
  requestAnimationFrame(()=>{rebuildQueued=false;buildKeyboard();});
}

function applySizePreset(name=$('sizePreset').value){
  const preset=SIZE_PRESETS[name];
  if(!preset) return;
  applyingPreset=true;
  for(const [id,value] of Object.entries(preset)) setValue(id,value);
  syncAllControls();
  applyingPreset=false;
  queueRebuild();
}
function markCustomSize(id){
  if(!applyingPreset && SIZE_IDS.has(id) && $('sizePreset').value!=='custom') $('sizePreset').value='custom';
}

function setRenderTargetSize(width,height){
  renderer.setPixelRatio(1); renderer.setSize(width,height,false);
  renderer.domElement.style.width=`${width}px`; renderer.domElement.style.height=`${height}px`;
  updateCamera({width,height});
}
function restorePreview(){ renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); resizePreview(); }
function downloadDataURL(dataURL,name){ const a=document.createElement('a'); a.href=dataURL; a.download=name; document.body.appendChild(a); a.click(); a.remove(); }
function canvasPNG(){ render(); return renderer.domElement.toDataURL('image/png'); }
function outputDimensions(){ const scale=n('outputScale'); return {width:Math.round(n('outputWidth')*scale),height:Math.round(n('outputHeight')*scale),scale}; }
async function cropDataURL(dataURL){
  if(!b('cropIndividual')) return dataURL;
  const img=new Image(); img.src=dataURL; await img.decode();
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
  const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0);
  const d=ctx.getImageData(0,0,c.width,c.height).data;
  let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
  for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) if(d[(y*c.width+x)*4+3]>3){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(maxX<minX) return dataURL;
  const pad=4,sx=Math.max(0,minX-pad),sy=Math.max(0,minY-pad),ex=Math.min(c.width,maxX+pad+1),ey=Math.min(c.height,maxY+pad+1);
  const out=document.createElement('canvas'); out.width=ex-sx; out.height=ey-sy; out.getContext('2d').drawImage(c,sx,sy,out.width,out.height,0,0,out.width,out.height);
  return out.toDataURL('image/png');
}
function dataURLBase64(u){return u.split(',')[1];}
function safeName(name){return name.replace('#','sharp');}
async function exportKeyboard(includePressed=false){
  const dim=outputDimensions(), oldPressed=$('pressedNote').value;
  try{
    setRenderTargetSize(dim.width,dim.height);
    if(!includePressed){
      keyRecords.forEach(r=>r.pivot.rotation.x=0);
      downloadDataURL(canvasPNG(),`keyboard_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}@${dim.scale}x.png`);
    }else{
      const zip=new window.JSZip(); keyRecords.forEach(r=>r.pivot.rotation.x=0);
      zip.file('keyboard_up.png',dataURLBase64(canvasPNG()),{base64:true});
      for(const rec of keyRecords){ keyRecords.forEach(r=>r.pivot.rotation.x=0); rec.pivot.rotation.x=deg(n('pressAngle')); zip.file(`pressed/${safeName(rec.name)}.png`,dataURLBase64(canvasPNG()),{base64:true}); }
      const blob=await zip.generateAsync({type:'blob'}); downloadDataURL(URL.createObjectURL(blob),`keyboard_pressed_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}.zip`);
    }
  }finally{ $('pressedNote').value=oldPressed; applyPressedPreview(); restorePreview(); }
}
async function exportIndividual(){
  const dim=outputDimensions(), zip=new window.JSZip(), oldPressed=$('pressedNote').value, oldVisibility=keyRecords.map(r=>r.pivot.visible);
  try{
    setRenderTargetSize(dim.width,dim.height);
    for(const rec of keyRecords){
      keyRecords.forEach(r=>{r.pivot.visible=r===rec;r.pivot.rotation.x=0;});
      zip.file(`${safeName(rec.name)}_up.png`,dataURLBase64(await cropDataURL(canvasPNG())),{base64:true});
      rec.pivot.rotation.x=deg(n('pressAngle'));
      zip.file(`${safeName(rec.name)}_down.png`,dataURLBase64(await cropDataURL(canvasPNG())),{base64:true});
    }
    zip.file('manifest.json',JSON.stringify({range:{from:$('rangeFrom').value,to:$('rangeTo').value},output:dim,pressedAngle:n('pressAngle'),keys:keyRecords.map(r=>({note:r.name,midi:r.midi,type:r.kind}))},null,2));
    const blob=await zip.generateAsync({type:'blob'}); downloadDataURL(URL.createObjectURL(blob),`keys_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}.zip`);
  }finally{
    keyRecords.forEach((r,i)=>{r.pivot.visible=oldVisibility[i];r.pivot.rotation.x=0;}); $('pressedNote').value=oldPressed; applyPressedPreview(); restorePreview();
  }
}

function configObject(){
  const o={version:5};
  for(const id of CONFIG_IDS){ const el=$(id); if(!el) continue; o[id]=el.type==='checkbox'?el.checked:el.value; }
  return o;
}
function applyConfig(o){
  for(const id of CONFIG_IDS){ if(!(id in o)) continue; const el=$(id); if(!el) continue; if(el.type==='checkbox') el.checked=!!o[id]; else el.value=o[id]; }
  syncAllControls(); queueRebuild(); resizePreview();
}
function savePreset(){ const blob=new Blob([JSON.stringify(configObject(),null,2)],{type:'application/json'}); downloadDataURL(URL.createObjectURL(blob),'keyboard-assets-preset.json'); }

function handleConfigChange(id){
  if(id==='sizePreset'){ applySizePreset(); return; }
  markCustomSize(id);
  if(GEOMETRY_IDS.has(id)) queueRebuild();
  else if(id==='pressAngle') applyPressedPreview();
  else if(OUTPUT_IDS.has(id)){ resizePreview(); updateSceneSettings(); }
  else updateSceneSettings();
}
function syncAllControls(){
  document.querySelectorAll('input[type=range][data-sync]').forEach(sl=>{const target=$(sl.dataset.sync);if(target)sl.value=target.value;});
  document.querySelectorAll('input[type=number][data-range-sync]').forEach(num=>{const range=$(num.dataset.rangeSync);if(range)num.value=range.value;});
}
function wireControls(){
  document.querySelectorAll('input[type=range][data-sync]').forEach(sl=>{
    const id=sl.dataset.sync,target=$(id); if(!target)return;
    sl.addEventListener('input',()=>{target.value=sl.value;handleConfigChange(id);});
    target.addEventListener('input',()=>{sl.value=target.value;handleConfigChange(id);});
    target.addEventListener('change',()=>{sl.value=target.value;handleConfigChange(id);});
  });
  document.querySelectorAll('input[type=number][data-range-sync]').forEach(num=>{
    const id=num.dataset.rangeSync,range=$(id); if(!range)return;
    num.addEventListener('input',()=>{range.value=num.value;handleConfigChange(id);});
    num.addEventListener('change',()=>{range.value=num.value;handleConfigChange(id);});
    range.addEventListener('input',()=>{num.value=range.value;handleConfigChange(id);});
  });
  const pairedIds=new Set([
    ...Array.from(document.querySelectorAll('input[type=range][data-sync]')).map(el=>el.dataset.sync),
    ...Array.from(document.querySelectorAll('input[type=number][data-range-sync]')).map(el=>el.dataset.rangeSync)
  ]);
  CONFIG_IDS.forEach(id=>{
    if(pairedIds.has(id))return; const el=$(id); if(!el)return;
    const event=(el.tagName==='SELECT'||el.type==='checkbox')?'change':'input';
    el.addEventListener(event,()=>handleConfigChange(id));
  });
}

wireControls(); syncAllControls();
$('pressedNote').addEventListener('change',applyPressedPreview);
$('fitCamera').addEventListener('click',fitCamera);
$('resetView').addEventListener('click',()=>{
  applyConfig({projection:'perspective',cameraX:'0',cameraY:'-320.58',cameraZ:'498.54',cameraRotX:'-28',cameraRotY:'0',cameraRotZ:'0',cameraZoom:'1',cameraFov:'35',ambientIntensity:'0',mainIntensity:'6.6',lightX:'60',lightY:'-250',lightZ:'500'});
  setTimeout(fitCamera,0);
});
$('savePreset').addEventListener('click',savePreset);
$('loadPreset').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{applyConfig(JSON.parse(await f.text()));}catch{alert('Could not read preset JSON.');}e.target.value='';});
$('exportKeyboard').addEventListener('click',()=>exportKeyboard(false));
$('exportPressed').addEventListener('click',()=>exportKeyboard(true));
$('exportKeys').addEventListener('click',exportIndividual);
document.querySelectorAll('[data-low]').forEach(btn=>btn.addEventListener('click',()=>{setValue('rangeFrom',btn.dataset.low);handleConfigChange('rangeFrom');}));
document.querySelectorAll('[data-high]').forEach(btn=>btn.addEventListener('click',()=>{setValue('rangeTo',btn.dataset.high);handleConfigChange('rangeTo');}));
new ResizeObserver(()=>resizePreview()).observe(viewport);
renderer.domElement.addEventListener('pointerdown',ev=>{
  const rect=renderer.domElement.getBoundingClientRect();
  const mouse=new THREE.Vector2((ev.clientX-rect.left)/rect.width*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
  const ray=new THREE.Raycaster(); ray.setFromCamera(mouse,camera);
  const hits=ray.intersectObjects(keyRecords.map(r=>r.mesh),false);
  if(hits.length){$('pressedNote').value=String(hits[0].object.userData.midi);applyPressedPreview();}
});

buildKeyboard();
requestAnimationFrame(()=>{resizePreview();updateSceneSettings();fitCamera();});
