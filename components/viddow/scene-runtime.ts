import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type SceneState = { phase: "idle" | "analyzing" | "results" | "error" | "downloading"; mode: "video" | "audio"; reduced: boolean };

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-w/2+r,-h/2); s.lineTo(w/2-r,-h/2); s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
  s.lineTo(w/2,h/2-r); s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);
  s.lineTo(-w/2+r,h/2); s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);
  s.lineTo(-w/2,-h/2+r); s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
  return s;
}

const vertexShader = `varying vec2 vUv; varying vec3 vNormal; void main(){vUv=uv; vNormal=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader = `
  uniform float uTime; uniform float uActive; uniform vec3 uColor; varying vec2 vUv; varying vec3 vNormal;
  void main(){
    vec2 p=vUv-.5;
    float wave=sin(p.x*9.+p.y*6.+uTime*.38)*.5+.5;
    float wave2=sin(p.x*5.-p.y*9.-uTime*.24)*.5+.5;
    float fresnel=pow(1.-abs(normalize(vNormal).z),2.);
    vec3 c=mix(vec3(.07,.025,.14),uColor,wave*.38+wave2*.12+fresnel*.5);
    float scan=pow(max(0.,sin((p.y+uTime*.3)*7.)),24.)*.16*uActive;
    c+=vec3(.35,.24,.7)*scan;
    float grain=fract(sin(dot(vUv,vec2(12.9898,78.233)))*43758.5453)*.015;
    gl_FragColor=vec4(c+grain,.84);
  }
`;

export function createScene(host: HTMLElement, initial: SceneState, onLost: () => void) {
  let state = initial;
  const compact = host.clientWidth < 640;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
  camera.position.set(0, .1, compact ? 11.7 : 10.3);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.25 : 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.transmissionResolutionScale = .5;
  host.appendChild(renderer.domElement);

  const environment = new THREE.Scene();
  environment.background = new THREE.Color(0x151025);
  const envMaterials: THREE.Material[] = [];
  [[0,4,0,0xffffff,18],[-4,0,1,0x7943ff,16],[4,1,2,0x83d9ff,10],[0,-4,1,0xbd4cff,9]].forEach(([x,y,z,color,intensity]) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }); mat.color.multiplyScalar(intensity);
    envMaterials.push(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3,5), mat); plane.position.set(x,y,z); plane.lookAt(0,0,0); environment.add(plane);
  });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, .05);
  scene.environment = envTarget.texture;
  environment.traverse((o) => { if(o instanceof THREE.Mesh) o.geometry.dispose(); });
  envMaterials.forEach(m=>m.dispose()); pmrem.dispose();
  scene.add(new THREE.AmbientLight(0xbbaaff, 2.5));
  const violet = new THREE.PointLight(0x864dff, 50, 15); violet.position.set(-3,2,3); scene.add(violet);
  const cyan = new THREE.PointLight(0x63c4ff, 30, 15); cyan.position.set(3,-1,3); scene.add(cyan);
  const key = new THREE.DirectionalLight(0xf1e8ff, 5); key.position.set(1,4,5); scene.add(key);

  const core = new THREE.Group();
  core.rotation.set(.20,-.55,-.13); core.position.y = .08; scene.add(core);
  const glass = new THREE.MeshPhysicalMaterial({ color:0x9571d8, metalness:.12, roughness:.14, transmission:.72, thickness:.6, ior:1.46, clearcoat:1, iridescence:1, iridescenceIOR:1.3, iridescenceThicknessRange:[160,430], envMapIntensity:1.5 });
  const edgeMat = new THREE.MeshPhysicalMaterial({ color:0x9571cd, metalness:.8, roughness:.13, clearcoat:1, iridescence:.9, envMapIntensity:1.25 });
  const layers: THREE.Group[] = [];
  for(let i=0; i<3; i++) {
    const layer = new THREE.Group();
    const s=roundedRect(2.18,2.18,.38);
    const hole=roundedRect(1.9,1.9,.29); s.holes.push(new THREE.Path(hole.getPoints(32).reverse()));
    const geo=new THREE.ExtrudeGeometry(s,{depth:.085,bevelEnabled:true,bevelSegments:compact?2:4,steps:1,bevelSize:.035,bevelThickness:.035,curveSegments:compact?12:24});
    const frame=new THREE.Mesh(geo, i===2?edgeMat:glass); layer.add(frame);
    layer.position.set((i-1)*.21,(i-1)*.09,(i-1)*.46); layer.rotation.z=(i-1)*.065;
    core.add(layer); layers.push(layer);
  }
  const screenGeo = new THREE.ShapeGeometry(roundedRect(1.91,1.91,.29),24);
  // ShapeGeometry uses local coordinates as UVs; normalize to the panel.
  const uv=screenGeo.getAttribute("uv"); for(let i=0;i<uv.count;i++) uv.setXY(i,(uv.getX(i)+.955)/1.91,(uv.getY(i)+.955)/1.91);
  const screenMat=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:{uTime:{value:0},uActive:{value:0},uColor:{value:new THREE.Color(.62,.24,1)}},transparent:true,side:THREE.DoubleSide});
  const screen=new THREE.Mesh(screenGeo,screenMat); screen.position.z=.16; core.add(screen);
  const pane=new THREE.Mesh(new RoundedBoxGeometry(1.95,1.95,.09,compact?2:4,.25),glass); pane.position.z=-.15;core.add(pane);

  const playShape = new THREE.Shape(); playShape.moveTo(-.26,-.41);playShape.quadraticCurveTo(-.35,-.45,-.35,-.33);playShape.lineTo(-.35,.37);playShape.quadraticCurveTo(-.35,.48,-.23,.41);playShape.lineTo(.4,.055);playShape.quadraticCurveTo(.5,0,.4,-.055);playShape.closePath();
  const playMat=new THREE.MeshPhysicalMaterial({color:0xddd1ff,metalness:.34,roughness:.15,emissive:0x7643bd,emissiveIntensity:.25,clearcoat:1,envMapIntensity:2});
  const play = new THREE.Mesh(new THREE.ExtrudeGeometry(playShape,{depth:.075,bevelEnabled:true,bevelSize:.027,bevelThickness:.027,bevelSegments:3,steps:1}),playMat);play.position.set(.04,0,.45);core.add(play);
  const waves = new THREE.Group(); waves.position.z=.49; core.add(waves);
  const waveBars: THREE.Mesh[]=[];
  for(let i=0;i<17;i++) {const b=new THREE.Mesh(new RoundedBoxGeometry(.045,1,.035,1,.018),playMat);b.position.x=(i-8)*.073;waves.add(b);waveBars.push(b);}

  const orbit = new THREE.Group(); orbit.rotation.set(1.18,.2,-.16); orbit.position.y=-.17; scene.add(orbit);
  const orbitMat = new THREE.LineBasicMaterial({color:0x9270ce,transparent:true,opacity:.27});
  for(let r=0;r<2;r++) {const pts=[];for(let i=0;i<=180;i++){const a=i/180*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*(2.8+r*.45),Math.sin(a)*(2.8+r*.45),0));} orbit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),orbitMat));}
  const satellites: THREE.Group[]=[];
  const satelliteMat=new THREE.MeshPhysicalMaterial({color:0x605779,metalness:.25,roughness:.23,transmission:.5,thickness:.4,clearcoat:1,envMapIntensity:2});
  [[-3.1,.65,-.8,.3], [3.05,-.3,-.4,-.4],[-2.4,-.95,.2,-.2],[2.4,1.05,-1,.3]].forEach(([x,y,z,rot],i)=>{
    const group=new THREE.Group();group.position.set(x,y,z);group.rotation.set(.15,rot,rot);
    const p=new THREE.Mesh(new RoundedBoxGeometry(i%2?.56:.68,i%2?.56:.48,.075,2,.1),satelliteMat);group.add(p);
    const face=new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry,25),new THREE.LineBasicMaterial({color:0xc1b1ec,transparent:true,opacity:.35}));group.add(face);
    if(i%2===0){for(let j=0;j<7;j++){const bar=new THREE.Mesh(new THREE.BoxGeometry(.026,.08+Math.sin(j*2)**2*.16,.015),playMat);bar.position.set((j-3)*.065,0,.06);group.add(bar);}}
    else {const mini=new THREE.Mesh(play.geometry,playMat);mini.scale.setScalar(.29);mini.position.z=.055;group.add(mini);}
    scene.add(group);satellites.push(group);
  });
  const particleCount=compact?70:160;
  const pos=new Float32Array(particleCount*3);const scales=new Float32Array(particleCount);
  let seed=17; const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  for(let i=0;i<particleCount;i++){pos[i*3]=(random()-.5)*13;pos[i*3+1]=(random()-.5)*5;pos[i*3+2]=(random()-.5)*5;scales[i]=random()*2+1;}
  const particlesGeo=new THREE.BufferGeometry();particlesGeo.setAttribute("position",new THREE.BufferAttribute(pos,3));particlesGeo.setAttribute("aSize",new THREE.BufferAttribute(scales,1));
  const particlesMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:{value:0},uActive:{value:0}},vertexShader:`attribute float aSize;uniform float uTime;uniform float uActive;varying float vAlpha;void main(){vec3 p=position;p.y+=sin(uTime*.16+p.x)*.09;p.x+=sin(uTime*.12+p.y)*.06;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*(18./-mv.z)*(1.+uActive*.5);vAlpha=.25+aSize*.13;}`,fragmentShader:`varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(.67,.56,1.,smoothstep(.5,.02,d)*vAlpha);}`});
  const particles=new THREE.Points(particlesGeo,particlesMat);scene.add(particles);
  const scanMat=new THREE.MeshBasicMaterial({color:0xb18cff,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
  const scan=new THREE.Mesh(new THREE.RingGeometry(1.15,1.165,96),scanMat);scan.rotation.x=.25;scene.add(scan);

  const pointer=new THREE.Vector2();let inView=true;let dirty=true;let frame=0;let prev=0;let elapsed=0;let slowFrames=0;let adapted=false;
  const resize=()=>{const w=host.clientWidth;const h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);dirty=true;};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const intersection=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;dirty=true;},{rootMargin:"100px"});intersection.observe(host);
  const move=(e:PointerEvent)=>{if(state.reduced)return;pointer.set((e.clientX/window.innerWidth-.5)*2,(e.clientY/window.innerHeight-.5)*2);};
  window.addEventListener("pointermove",move,{passive:true});
  const contextLost=(e:Event)=>{e.preventDefault();renderer.setAnimationLoop(null);onLost();};renderer.domElement.addEventListener("webglcontextlost",contextLost);
  renderer.setAnimationLoop((timestamp)=>{
    if(document.hidden||!inView){prev=timestamp;return;}
    if(state.reduced&&!dirty){prev=timestamp;return;}
    const raw=prev?timestamp-prev:16.7;prev=timestamp;
    const dt=Math.min(raw/1000,.05);elapsed+=state.reduced?0:dt;frame++;
    if(frame>60&&!state.reduced&&!adapted){if(raw>28)slowFrames++;if(frame===180){if(slowFrames>65){renderer.setPixelRatio(1);particlesGeo.setDrawRange(0,Math.floor(particleCount*.6));adapted=true;} }}
    const active=state.phase==="analyzing"||state.phase==="downloading"?1:0;
    core.rotation.x=THREE.MathUtils.damp(core.rotation.x,.20+pointer.y*.07,4,dt);
    core.rotation.y=THREE.MathUtils.damp(core.rotation.y,-.55+pointer.x*.16+Math.sin(elapsed*.25)*.07,4,dt);
    core.rotation.z=-.13+Math.sin(elapsed*.2)*.025;
    core.position.y=.08+Math.sin(elapsed*.65)*.07;
    const scale=state.phase==="downloading"?1.03:1.17;core.scale.lerp(new THREE.Vector3(scale,scale,scale),.06);
    layers.forEach((layer,i)=>{layer.position.z=(i-1)*(.46+active*.09+Math.sin(elapsed*.55)*.012);layer.rotation.z=(i-1)*(.065+active*.025);});
    satellites.forEach((s,i)=>{s.position.y+=Math.sin(elapsed*.65+i)*.0008;s.rotation.y+=state.reduced?0:Math.sin(elapsed*.3+i)*.00035;});
    play.visible=state.mode==="video";waves.visible=state.mode==="audio";
    waveBars.forEach((b,i)=>{b.scale.y=.14+(Math.sin(elapsed*2+i*.6)*.5+.5)*.7;});
    screenMat.uniforms.uTime.value=elapsed;screenMat.uniforms.uActive.value=active;
    screenMat.uniforms.uColor.value.lerp(new THREE.Color(state.phase==="error"?0xb96485:state.mode==="audio"?0x3989b5:0x9948e8),.025);
    particlesMat.uniforms.uTime.value=elapsed*(1+active);particlesMat.uniforms.uActive.value=active;
    particles.rotation.z=Math.sin(elapsed*.08)*.025;particles.position.x=pointer.x*.05;
    violet.position.x=-3+pointer.x;cyan.position.y=-1-pointer.y;
    scan.visible=Boolean(active);const pulse=(elapsed*.55)%1;scan.scale.setScalar(1+pulse*2.1);scanMat.opacity=active*(1-pulse)*.33;
    orbit.rotation.z=-.16+elapsed*.025;
    renderer.render(scene,camera);dirty=false;
  });
  return {
    update(next:SceneState){state=next;dirty=true;},
    dispose(){renderer.setAnimationLoop(null);observer.disconnect();intersection.disconnect();window.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("webglcontextlost",contextLost);const geometries=new Set<THREE.BufferGeometry>();const materials=new Set<THREE.Material>();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.Points){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach((m:THREE.Material)=>materials.add(m));}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());envTarget.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();},
  };
}

