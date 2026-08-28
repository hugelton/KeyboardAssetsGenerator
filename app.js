import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js';

const $ = (id) => document.getElementById(id);
const deg = THREE.MathUtils.degToRad;
const BLACK_PCS = new Set([1,3,6,8,10]);
const WHITE_INDEX = {0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CONFIG_IDS = [
  'rangeFrom','rangeTo','showLabels','whiteWidth','whiteLength','whiteThickness','frontRadius','blackWidth','blackLength','blackHeight','keyGap','pressAngle',
  'whiteColor','blackColor','whiteRoughness','blackRoughness','projection','cameraX','cameraY','cameraZ','cameraRotX','cameraRotY','cameraRotZ','cameraZoom','cameraFov',
  'ambientIntensity','mainIntensity','lightX','lightY','lightZ','shadows','outputWidth','outputHeight','outputScale','backgroundColor','transparentBg','cropIndividual'
];

const viewport = $('viewport');
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,premultipliedAlpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
viewport.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 1.25);
scene.add(ambient);
const mainLight = new THREE.DirectionalLight(0xffffff, 3);
mainLight.position.set(-250,-250,500);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(2048,2048);
mainLight.shadow.bias = -0.0002;
scene.add(mainLight);

let orthoCamera = new THREE.OrthographicCamera(-100,100,100,-100,0.1,3000);
let perspectiveCamera = new THREE.PerspectiveCamera(35,1,0.1,3000);
let camera = orthoCamera;
let keyboardGroup = new THREE.Group();
scene.add(keyboardGroup);
let keyRecords = [];
let layout = {width:1,length:1,centerX:0};
let rebuildQueued = false;

function parseNote(text){
  const m = String(text).trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if(!m) return null;
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()];
  let pc = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  let octave = Number(m[3]);
  while(pc < 0){pc += 12; octave -= 1;}
  while(pc >= 12){pc -= 12; octave += 1;}
  const midi = (octave + 1) * 12 + pc;
  if(midi < 0 || midi > 127) return null;
  return midi;
}
function noteName(midi){return `${NOTE_NAMES[midi%12]}${Math.floor(midi/12)-1}`;}
function isBlack(midi){return BLACK_PCS.has(midi%12);}
function whiteOrdinal(midi){const oct=Math.floor(midi/12);const pc=midi%12;return oct*7+WHITE_INDEX[pc];}
function n(id){return Number($(id).value);}
function b(id){return $(id).checked;}

function disposeGroup(group){
  group.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose()); else o.material.dispose();}
    if(o.material?.map) o.material.map.dispose();
  });
  while(group.children.length) group.remove(group.children[0]);
}

function roundedWhiteShape(w,len,blackLen,leftNotch,rightNotch,gap,radius){
  const x0=gap/2, x1=w-gap/2;
  const backL = leftNotch ? Math.min(x1-1, x0 + n('blackWidth')/2 + gap/2) : x0;
  const backR = rightNotch ? Math.max(x0+1, x1 - n('blackWidth')/2 - gap/2) : x1;
  const notchY = -Math.min(blackLen + 1, len * 0.7);
  const r = Math.max(0, Math.min(radius, w/4, len/8));
  const s = new THREE.Shape();
  s.moveTo(backL,0);
  s.lineTo(backR,0);
  if(rightNotch){s.lineTo(backR,notchY);s.lineTo(x1,notchY);}
  s.lineTo(x1,-len+r);
  if(r>0) s.quadraticCurveTo(x1,-len,x1-r,-len); else s.lineTo(x1,-len);
  s.lineTo(x0+r,-len);
  if(r>0) s.quadraticCurveTo(x0,-len,x0,-len+r); else s.lineTo(x0,-len);
  if(leftNotch){s.lineTo(x0,notchY);s.lineTo(backL,notchY);}
  s.closePath();
  return s;
}

function keyMaterial(color,roughness){return new THREE.MeshStandardMaterial({color:new THREE.Color(color),roughness,metalness:0.02});}

function createWhiteKey(midi,x,visibleSet){
  const w=n('whiteWidth'), len=n('whiteLength'), t=n('whiteThickness'), gap=n('keyGap');
  const leftBlack = visibleSet.has(midi-1) && isBlack(midi-1);
  const rightBlack = visibleSet.has(midi+1) && isBlack(midi+1);
  const shape=roundedWhiteShape(w,len,n('blackLength'),leftBlack,rightBlack,gap,n('frontRadius'));
  const geo=new THREE.ExtrudeGeometry(shape,{depth:t,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:Math.min(1.2,t*0.12),bevelThickness:Math.min(1.2,t*0.12)});
  geo.translate(0,0,-t);
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,keyMaterial($('whiteColor').value,n('whiteRoughness')));
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.midi=midi;
  const pivot=new THREE.Group();pivot.position.x=x;pivot.add(mesh);pivot.userData.midi=midi;pivot.userData.kind='white';
  return {midi,name:noteName(midi),kind:'white',pivot,mesh,x,width:w};
}

function blackKeyGeometry(w,len,h,gap){
  const backW=Math.max(2,w-gap);
  const frontW=Math.max(2,backW*0.86);
  const halfBack=backW/2, halfFront=frontW/2;
  const bottom=0;
  const backTop=h;
  const frontTop=h*0.72;
  const shoulderY=-len*0.12;
  const frontY=-len;

  const p=[
    [-halfBack,0,bottom],[ halfBack,0,bottom],[-halfFront,frontY,bottom],[ halfFront,frontY,bottom],
    [-halfBack,shoulderY,backTop],[ halfBack,shoulderY,backTop],[-halfFront,frontY,frontTop],[ halfFront,frontY,frontTop]
  ];
  const faces=[
    0,1,3, 0,3,2,
    4,6,7, 4,7,5,
    0,4,5, 0,5,1,
    2,3,7, 2,7,6,
    0,2,6, 0,6,4,
    1,5,7, 1,7,3
  ];
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(p.flat(),3));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  return geo;
}

function createBlackKey(midi,boundaryX){
  const w=n('blackWidth'), len=n('blackLength'), h=n('blackHeight'), gap=Math.min(n('keyGap'),w/6);
  const geo=blackKeyGeometry(w,len,h,gap);
  const mesh=new THREE.Mesh(geo,keyMaterial($('blackColor').value,n('blackRoughness')));
  mesh.position.z=0.6;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.midi=midi;
  const pivot=new THREE.Group();pivot.position.x=boundaryX;pivot.position.z=0.5;pivot.add(mesh);pivot.userData.midi=midi;pivot.userData.kind='black';
  return {midi,name:noteName(midi),kind:'black',pivot,mesh,x:boundaryX-w/2,width:w};
}

function makeLabel(text,x,y,z){
  const c=document.createElement('canvas');c.width=160;c.height=64;const ctx=c.getContext('2d');
  ctx.font='600 26px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(25,25,25,.75)';ctx.fillText(text,80,32);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});
  const sp=new THREE.Sprite(mat);sp.position.set(x,y,z);sp.scale.set(32,12,1);return sp;
}

function buildKeyboard(){
  const from=parseNote($('rangeFrom').value), to=parseNote($('rangeTo').value);
  $('rangeFrom').classList.toggle('status-error',from===null);
  $('rangeTo').classList.toggle('status-error',to===null || (from!==null && to<from));
  if(from===null||to===null||to<from) return;
  disposeGroup(keyboardGroup); keyRecords=[];
  const visible=[];for(let m=from;m<=to;m++) visible.push(m);
  const visibleSet=new Set(visible);
  const whites=visible.filter(m=>!isBlack(m));
  let baseOrdinal;
  if(whites.length) baseOrdinal=Math.min(...whites.map(whiteOrdinal));
  else baseOrdinal=whiteOrdinal(from);
  const ww=n('whiteWidth');
  for(const midi of whites){
    const x=(whiteOrdinal(midi)-baseOrdinal)*ww;
    const rec=createWhiteKey(midi,x,visibleSet);keyboardGroup.add(rec.pivot);keyRecords.push(rec);
    if(b('showLabels')) rec.pivot.add(makeLabel(rec.name,ww/2,-n('whiteLength')+18,1));
  }
  for(const midi of visible.filter(isBlack)){
    const prevOrd=whiteOrdinal(midi);
    const boundary=(prevOrd-baseOrdinal+1)*ww;
    const rec=createBlackKey(midi,boundary);keyboardGroup.add(rec.pivot);keyRecords.push(rec);
  }
  keyRecords.sort((a,c)=>a.midi-c.midi);
  const box=new THREE.Box3().setFromObject(keyboardGroup);
  const size=new THREE.Vector3();box.getSize(size);const center=new THREE.Vector3();box.getCenter(center);
  layout={width:Math.max(size.x,1),length:Math.max(size.y,1),centerX:center.x,centerY:center.y,box};
  updatePressedSelect();
  updateSceneSettings();
  $('rangeInfo').textContent=`${noteName(from)}–${noteName(to)}`;
  $('keyCount').textContent=`${keyRecords.length} keys · ${whites.length} white / ${keyRecords.length-whites.length} black`;
}

function updatePressedSelect(){
  const sel=$('pressedNote');const old=sel.value;sel.innerHTML='<option value="">None</option>';
  keyRecords.forEach(r=>{const o=document.createElement('option');o.value=r.midi;o.textContent=r.name;sel.appendChild(o);});
  if(keyRecords.some(r=>String(r.midi)===old)) sel.value=old;
  applyPressedPreview();
}
function applyPressedPreview(){
  const selected=Number($('pressedNote').value);const has=$('pressedNote').value!=='';const angle=deg(n('pressAngle'));
  keyRecords.forEach(r=>r.pivot.rotation.x=(has&&r.midi===selected)?angle:0);
  $('pressAngleOut').textContent=`${n('pressAngle')}°`;
  render();
}

function activeCamera(){return $('projection').value==='perspective'?perspectiveCamera:orthoCamera;}
function updateCamera(sizeOverride=null){
  camera=activeCamera();
  const width=sizeOverride?.width||Math.max(viewport.clientWidth,1),height=sizeOverride?.height||Math.max(viewport.clientHeight,1),aspect=width/height;
  const target=new THREE.Vector3(layout.centerX,layout.centerY,0);
  camera.position.set(layout.centerX+n('cameraX'),n('cameraY'),n('cameraZ'));
  if(camera===perspectiveCamera){camera.aspect=aspect;camera.fov=n('cameraFov');}
  else{
    const halfH=Math.max(layout.length*.72,80);camera.left=-halfH*aspect;camera.right=halfH*aspect;camera.top=halfH;camera.bottom=-halfH;camera.zoom=n('cameraZoom');
  }
  camera.lookAt(target);
  camera.rotateX(deg(n('cameraRotX')));camera.rotateY(deg(n('cameraRotY')));camera.rotateZ(deg(n('cameraRotZ')));
  camera.updateProjectionMatrix();
}
function updateSceneSettings(){
  ambient.intensity=n('ambientIntensity');
  mainLight.intensity=n('mainIntensity');mainLight.position.set(n('lightX'),n('lightY'),n('lightZ'));
  renderer.shadowMap.enabled=b('shadows');mainLight.castShadow=b('shadows');
  scene.background=b('transparentBg')?null:new THREE.Color($('backgroundColor').value);
  renderer.setClearAlpha(b('transparentBg')?0:1);
  updateCamera();render();
}
function render(){renderer.render(scene,camera);}
function resizePreview(){
  const w=Math.max(viewport.clientWidth,1),h=Math.max(viewport.clientHeight,1);renderer.setSize(w,h,false);updateCamera();render();
}

function fitCamera(){
  $('cameraX').value=0;$('cameraRotX').value=0;$('cameraRotY').value=0;$('cameraRotZ').value=0;
  const len=n('whiteLength');$('cameraY').value=Math.round(-len*1.55);$('cameraZ').value=Math.round(Math.max(260,len*2.3));$('cameraZoom').value=1;
  updateCamera();
  if(camera===orthoCamera){
    const box=layout.box; if(box){
      const corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) corners.push(new THREE.Vector3(x,y,z));
      let max=0;corners.forEach(v=>{const p=v.clone().project(camera);max=Math.max(max,Math.abs(p.x),Math.abs(p.y));});
      if(max>0){$('cameraZoom').value=(0.9/max).toFixed(3);updateCamera();}
    }
  }
  render();
}

function queueRebuild(){if(rebuildQueued)return;rebuildQueued=true;requestAnimationFrame(()=>{rebuildQueued=false;buildKeyboard();});}

function setRenderTargetSize(width,height){
  renderer.setPixelRatio(1);renderer.setSize(width,height,false);updateCamera({width,height});
}
function restorePreview(){renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));resizePreview();}
function downloadDataURL(dataURL,name){const a=document.createElement('a');a.href=dataURL;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function canvasPNG(){render();return renderer.domElement.toDataURL('image/png');}
function outputDimensions(){const scale=n('outputScale');return {width:Math.round(n('outputWidth')*scale),height:Math.round(n('outputHeight')*scale),scale};}

async function cropDataURL(dataURL){
  if(!b('cropIndividual')) return dataURL;
  const img=new Image();img.src=dataURL;await img.decode();
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  const d=ctx.getImageData(0,0,c.width,c.height).data;let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>3){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
  if(maxX<minX) return dataURL;
  const pad=4, sx=Math.max(0,minX-pad),sy=Math.max(0,minY-pad),ex=Math.min(c.width,maxX+pad+1),ey=Math.min(c.height,maxY+pad+1);
  const out=document.createElement('canvas');out.width=ex-sx;out.height=ey-sy;out.getContext('2d').drawImage(c,sx,sy,out.width,out.height,0,0,out.width,out.height);return out.toDataURL('image/png');
}
function dataURLBase64(dataURL){return dataURL.split(',')[1];}
function safeName(name){return name.replace('#','sharp');}

async function exportKeyboard(includePressed=false){
  const dim=outputDimensions();const oldPressed=$('pressedNote').value;
  try{
    setRenderTargetSize(dim.width,dim.height);
    if(!includePressed){keyRecords.forEach(r=>r.pivot.rotation.x=0);downloadDataURL(canvasPNG(),`keyboard_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}@${dim.scale}x.png`);}
    else{
      const zip=new window.JSZip();keyRecords.forEach(r=>r.pivot.rotation.x=0);zip.file('keyboard_up.png',dataURLBase64(canvasPNG()),{base64:true});
      for(const rec of keyRecords){keyRecords.forEach(r=>r.pivot.rotation.x=0);rec.pivot.rotation.x=deg(n('pressAngle'));zip.file(`pressed/${safeName(rec.name)}.png`,dataURLBase64(canvasPNG()),{base64:true});}
      const blob=await zip.generateAsync({type:'blob'});downloadDataURL(URL.createObjectURL(blob),`keyboard_pressed_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}.zip`);
    }
  }finally{$('pressedNote').value=oldPressed;applyPressedPreview();restorePreview();}
}

async function exportIndividual(){
  const dim=outputDimensions(),zip=new window.JSZip(),oldPressed=$('pressedNote').value;
  const oldVisibility=keyRecords.map(r=>r.pivot.visible);
  try{
    setRenderTargetSize(dim.width,dim.height);
    for(const rec of keyRecords){
      keyRecords.forEach(r=>{r.pivot.visible=r===rec;r.pivot.rotation.x=0;});
      let up=await cropDataURL(canvasPNG());zip.file(`${safeName(rec.name)}_up.png`,dataURLBase64(up),{base64:true});
      rec.pivot.rotation.x=deg(n('pressAngle'));let down=await cropDataURL(canvasPNG());zip.file(`${safeName(rec.name)}_down.png`,dataURLBase64(down),{base64:true});
    }
    const manifest={range:{from:$('rangeFrom').value,to:$('rangeTo').value},output:dim,pressedAngle:n('pressAngle'),keys:keyRecords.map(r=>({note:r.name,midi:r.midi,type:r.kind}))};
    zip.file('manifest.json',JSON.stringify(manifest,null,2));
    const blob=await zip.generateAsync({type:'blob'});downloadDataURL(URL.createObjectURL(blob),`keys_${safeName($('rangeFrom').value)}-${safeName($('rangeTo').value)}.zip`);
  }finally{keyRecords.forEach((r,i)=>{r.pivot.visible=oldVisibility[i];r.pivot.rotation.x=0;});$('pressedNote').value=oldPressed;applyPressedPreview();restorePreview();}
}

function configObject(){const o={version:1};for(const id of CONFIG_IDS){const el=$(id);o[id]=el.type==='checkbox'?el.checked:el.value;}return o;}
function applyConfig(o){for(const id of CONFIG_IDS){if(!(id in o))continue;const el=$(id);if(el.type==='checkbox')el.checked=!!o[id];else el.value=o[id];}queueRebuild();}
function savePreset(){const blob=new Blob([JSON.stringify(configObject(),null,2)],{type:'application/json'});downloadDataURL(URL.createObjectURL(blob),'keyboard-assets-preset.json');}

CONFIG_IDS.forEach(id=>{
  const el=$(id);const geometryIds=new Set(['rangeFrom','rangeTo','showLabels','whiteWidth','whiteLength','whiteThickness','frontRadius','blackWidth','blackLength','blackHeight','keyGap','whiteColor','blackColor','whiteRoughness','blackRoughness']);
  el.addEventListener('input',()=>geometryIds.has(id)?queueRebuild():(id==='pressAngle'?applyPressedPreview():updateSceneSettings()));
  el.addEventListener('change',()=>geometryIds.has(id)?queueRebuild():(id==='pressAngle'?applyPressedPreview():updateSceneSettings()));
});
$('pressedNote').addEventListener('change',applyPressedPreview);
$('fitCamera').addEventListener('click',fitCamera);
$('resetView').addEventListener('click',()=>{applyConfig({projection:'orthographic',cameraX:'0',cameraY:'-260',cameraZ:'430',cameraRotX:'0',cameraRotY:'0',cameraRotZ:'0',cameraZoom:'1',cameraFov:'35',ambientIntensity:'1.25',mainIntensity:'3',lightX:'-250',lightY:'-250',lightZ:'500'});setTimeout(fitCamera,0);});
$('savePreset').addEventListener('click',savePreset);
$('loadPreset').addEventListener('change',async(e)=>{const f=e.target.files?.[0];if(!f)return;try{applyConfig(JSON.parse(await f.text()));}catch(err){alert('Could not read preset JSON.');}e.target.value='';});
$('exportKeyboard').addEventListener('click',()=>exportKeyboard(false));
$('exportPressed').addEventListener('click',()=>exportKeyboard(true));
$('exportKeys').addEventListener('click',exportIndividual);
document.querySelectorAll('[data-low]').forEach(btn=>btn.addEventListener('click',()=>{$('rangeFrom').value=btn.dataset.low;queueRebuild();}));
document.querySelectorAll('[data-high]').forEach(btn=>btn.addEventListener('click',()=>{$('rangeTo').value=btn.dataset.high;queueRebuild();}));

const ro=new ResizeObserver(()=>resizePreview());ro.observe(viewport);

// Simple preview interaction: click a key to audition the pressed asset state.
renderer.domElement.addEventListener('pointerdown',(ev)=>{
  const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2((ev.clientX-rect.left)/rect.width*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
  const ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects(keyRecords.map(r=>r.mesh),false);
  if(hits.length){const midi=hits[0].object.userData.midi;$('pressedNote').value=String(midi);applyPressedPreview();}
});

buildKeyboard();requestAnimationFrame(()=>{fitCamera();resizePreview();});