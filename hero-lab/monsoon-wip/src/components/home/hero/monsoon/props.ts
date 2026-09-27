/**
 * The windowsill still life: matchbox, matches, candle and sill, raymarched
 * as signed distance fields in one fragment shader. Owner's bar: "an
 * extremely realistic matchbox ... HD and real and has some weight and
 * assence". This file renders into its own offscreen target; glass.ts
 * composites it (premultiplied linear HDR) over the window.
 *
 * Perf shape: a fullscreen triangle, scissored to the sill band plus the
 * current match/candle/flame extent (computed fresh each frame from live
 * state, so it stays tight while the match is at rest and grows only while
 * it's actually lifted). Inside the shader, two coarse bounding SDFs (box
 * cluster, candle cluster) and one bounding sphere (the spent-match pile)
 * gate the expensive per-object detail, so most raymarch steps on a given
 * pixel pay only for whichever cluster the ray is actually near.
 */
import type { GLKit, Program, Target } from './gl'
import type { Camera } from './camera'
import { MATCH, GLASS_Z } from './camera'
import type { CityTextures, SceneState, Vec3 } from './types'
import { windowLight } from './light'
import { drawLabel } from './label'

export interface Props {
  readonly target: Target
  resize(w: number, h: number): void
  render(state: SceneState, cam: Camera, city: CityTextures | null): void
  destroy(): void
}

const MAX_MATCHES = 6
const MAX_SPARKS = 32
const MAX_FLAMES = 2
const ZERO2: [number, number] = [0, 0]

// ---------------------------------------------------------------------------
// Shader. Material ids returned by map(): 0 sill, 1 sleeve+striker card,
// 2 tray outer, 3 tray interior, 4 decorative tray match-heads, 5 candle
// wax, 6 wick, 100+idx a real match from state.matches (stick+head unioned).
// Negative ids are coarse-bound proxies and never survive to a converged hit.
// ---------------------------------------------------------------------------

const FRAG = `
uniform vec3 uEye, uRight, uUp, uFwd;
uniform float uTanX, uTanY, uAspect, uTime, uDayness, uPixelWorld;
uniform vec3 uWindowLight;

uniform vec3 uBoxCenter; uniform float uBoxYaw; uniform vec3 uBoxSize;
uniform float uTrayOut, uStruck;
uniform vec3 uStrikerCenter, uStrikerNormal, uStrikerAlong;
uniform float uStrikerHalfLen, uStrikerHalfH;

uniform vec3 uCandleBase; uniform float uCandleRadius, uCandleHeight;
uniform vec3 uWickTop; uniform float uCandleLit, uCandleFlame;

uniform int uMatchCount;
uniform vec3 uMatchHead[${MAX_MATCHES}];
uniform vec3 uMatchDir[${MAX_MATCHES}];
uniform float uMatchBurn[${MAX_MATCHES}];
uniform float uMatchEmber[${MAX_MATCHES}];
uniform float uMatchStruck[${MAX_MATCHES}];
uniform float uMatchLit[${MAX_MATCHES}];
uniform vec3 uSpentBoundCenter; uniform float uSpentBoundRadius;

uniform int uFlameCount;
uniform vec3 uFlamePos[${MAX_FLAMES}];
uniform float uFlameIntensity[${MAX_FLAMES}];
uniform vec2 uFlameUv[${MAX_FLAMES}];
uniform float uFlameV[${MAX_FLAMES}];
uniform float uFlameSize[${MAX_FLAMES}];
uniform vec2 uFlameLean[${MAX_FLAMES}];
uniform float uFlameKind[${MAX_FLAMES}];

uniform int uSparkCount;
uniform vec2 uSparkPos[${MAX_SPARKS}];
uniform vec2 uSparkVec[${MAX_SPARKS}];
uniform float uSparkLife[${MAX_SPARKS}];

uniform sampler2D uCityNight, uCityDay, uCityEmit, uLabel;

in vec2 vUv;
out vec4 fragColor;

const float MATCH_LEN = ${MATCH.length.toFixed(6)};
const float MATCH_HALF = ${MATCH.half.toFixed(6)};
const vec3 MATCH_HEAD_R = vec3(${MATCH.head[0].toFixed(6)}, ${MATCH.head[1].toFixed(6)}, ${MATCH.head[2].toFixed(6)});
const float GLASS_ZC = ${GLASS_Z.toFixed(6)};
const float PI = 3.14159265;

float hash11(float p){ p = fract(p*0.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float noise2(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for (int i=0;i<4;i++){ v+=a*noise2(p); p*=2.03; a*=0.5; }
  return v;
}
float noise1(float x){ float i=floor(x), f=fract(x); return mix(hash11(i),hash11(i+1.0), f*f*(3.0-2.0*f)); }
float fbm1(float x){
  float v=0.0, a=0.5;
  for (int i=0;i<3;i++){ v+=a*noise1(x); x*=2.05; a*=0.5; }
  return v;
}

vec3 rotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x-s*p.z, p.y, s*p.x+c*p.z); }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }
vec2 opU(vec2 a, vec2 b){ return a.x<b.x?a:b; }

float sdRoundBox(vec3 p, vec3 b, float r){
  vec3 q = abs(p)-b+r;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}
float sdEllipsoid(vec3 p, vec3 r){
  float k0 = length(p/r);
  float k1 = length(p/(r*r));
  return k0*(k0-1.0)/max(k1,1e-5);
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){
  vec3 pa=p-a, ba=b-a;
  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
  return length(pa-ba*h)-r;
}
float sdCylinderY(vec3 p, float h, float r){
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}
float sdTorusY(vec3 p, float R, float r){
  vec2 q = vec2(length(p.xz)-R, p.y);
  return length(q)-r;
}

// --- Box cluster: sleeve + tray + decorative packed heads. bp is already in
// box-local space (rotated by -yaw, translated by -center). ---------------
vec2 mapBoxDetail(vec3 bp, vec3 half_){
  float sleeve = sdRoundBox(bp, half_, 0.0012);
  vec2 res = vec2(sleeve, 1.0);

  float trayHalfX = uTrayOut*0.5 + 0.006;
  float trayHalfZ = half_.z*0.94;
  float trayCX = half_.x - trayHalfX + uTrayOut;
  vec3 tp = bp - vec3(trayCX, 0.0, 0.0);
  float trayOuter = sdRoundBox(tp, vec3(trayHalfX, half_.y, trayHalfZ), 0.0015);

  float wall = 0.0028;
  float floorT = 0.0022;
  float cavTop = half_.y + 0.03;
  float cavBot = -half_.y + floorT;
  float cavHalfY = (cavTop-cavBot)*0.5;
  float cavCenY = (cavTop+cavBot)*0.5;
  vec3 cav = tp - vec3(0.0, cavCenY, 0.0);
  float cavity = sdRoundBox(cav, vec3(trayHalfX-wall, cavHalfY, trayHalfZ-wall), 0.0012);
  float negCav = -cavity;
  float trayD = max(trayOuter, negCav);
  float trayId = (trayOuter >= negCav) ? 2.0 : 3.0;
  res = opU(res, vec2(trayD, trayId));

  float headsX = trayCX + trayHalfX*0.2;
  float headsY = cavBot + 0.0016;
  vec3 hb = bp - vec3(headsX, headsY, 0.0);
  float headsBound = sdRoundBox(hb, vec3(0.0065, 0.0022, trayHalfZ-wall-0.0008), 0.0);
  if (headsBound < 0.01) {
    float best = 1e5;
    for (int i=0;i<7;i++){
      float fi = float(i);
      float jz = (fi+0.5)/7.0*2.0-1.0;
      float hz = (trayHalfZ-wall-0.0028)*jz + (hash11(fi*7.13)-0.5)*0.0008;
      float hx = headsX + (hash11(fi*3.71)-0.5)*0.001;
      float hy = headsY + 0.0014 + hash11(fi*5.19)*0.0004;
      vec3 hp = bp - vec3(hx,hy,hz);
      best = min(best, sdEllipsoid(hp, vec3(0.0021,0.0016,0.0021)));
    }
    res = opU(res, vec2(best, 4.0));
  }
  return res;
}

// --- Candle cluster: cp is already translated by -base (no yaw). ----------
vec2 mapCandleDetail(vec3 cp){
  float h = uCandleHeight, r = uCandleRadius;
  float cyl = sdCylinderY(cp - vec3(0.0,h*0.5,0.0), h*0.5, r);
  vec3 poolP = cp - vec3(0.0, h-0.0018, 0.0);
  float pool = sdEllipsoid(poolP, vec3(r*0.72, 0.006, r*0.72));
  float body = max(cyl, -pool);

  float ang = atan(cp.z, cp.x);
  float rimR = r*0.92 + (noise1(ang*2.3)-0.5)*0.0018;
  float rim = sdTorusY(cp - vec3(0.0,h-0.0022,0.0), rimR, 0.0026);
  body = smin(body, rim, 0.003);

  vec3 d0 = vec3(cos(0.7),0.0,sin(0.7))*r*0.9 + vec3(0.0,h*0.86,0.0);
  vec3 d0b = vec3(cos(0.7),0.0,sin(0.7))*r*1.02 + vec3(0.0,h*0.5,0.0);
  float drip0 = sdCapsule(cp, d0, d0b, 0.0026);
  vec3 d1 = vec3(cos(2.8),0.0,sin(2.8))*r*0.9 + vec3(0.0,h*0.92,0.0);
  vec3 d1b = vec3(cos(2.8),0.0,sin(2.8))*r*1.0 + vec3(0.0,h*0.62,0.0);
  float drip1 = sdCapsule(cp, d1, d1b, 0.002);
  body = smin(body, drip0, 0.0035);
  body = smin(body, drip1, 0.003);

  vec2 res = vec2(body, 5.0);
  vec3 wickBase = vec3(0.0, h-0.0018, 0.0);
  vec3 wickMid = mix(wickBase, uWickTop - uCandleBase, 0.5) + vec3(0.0008,0.0,0.0003);
  float wick = min(sdCapsule(cp, wickBase, wickMid, 0.0009), sdCapsule(cp, wickMid, uWickTop-uCandleBase, 0.0007));
  res = opU(res, vec2(wick, 6.0));
  return res;
}

vec2 mapOneMatch(vec3 p, int idx){
  vec3 head, dir; float burn, ember, struckF, litF;
  for (int i=0;i<${MAX_MATCHES};i++){
    if (i==idx){ head=uMatchHead[i]; dir=uMatchDir[i]; }
  }
  vec3 tail = head + dir*MATCH_LEN;
  vec3 stickStart = head + dir*(MATCH_HEAD_R.y*0.5);
  float stick = sdCapsule(p, stickStart, tail, MATCH_HALF);
  vec3 t = dir;
  vec3 arb = (abs(t.y) < 0.95) ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 bx = normalize(cross(arb,t));
  vec3 bz = cross(t,bx);
  vec3 rel = p - head;
  vec3 local = vec3(dot(rel,bx), dot(rel,t), dot(rel,bz));
  float hd = sdEllipsoid(local, MATCH_HEAD_R);
  float id = 100.0 + float(idx);
  return opU(vec2(stick,id), vec2(hd,id));
}

vec2 map(vec3 p){
  vec2 res = vec2(1e5, -1.0);

  vec3 bp = rotY(p - uBoxCenter, -uBoxYaw);
  vec3 bHalf = uBoxSize*0.5;
  float boxProxy = sdRoundBox(bp - vec3(uTrayOut*0.5,0.0,0.0), vec3(bHalf.x+uTrayOut*0.5+0.0015, bHalf.y+0.0015, bHalf.z+0.0015), 0.0);
  if (boxProxy < 0.012) res = opU(res, mapBoxDetail(bp, bHalf));
  else res = opU(res, vec2(boxProxy, -1.0));

  vec3 cp = p - uCandleBase;
  float candleProxy = sdCylinderY(cp - vec3(0.0,uCandleHeight*0.5,0.0), uCandleHeight*0.5+0.007, uCandleRadius+0.007);
  if (candleProxy < 0.01) res = opU(res, mapCandleDetail(cp));
  else res = opU(res, vec2(candleProxy, -5.0));

  if (uMatchCount > 0) res = opU(res, mapOneMatch(p, 0));
  if (uMatchCount > 1) {
    float sb = length(p-uSpentBoundCenter) - uSpentBoundRadius;
    if (sb < 0.012) {
      for (int i=1;i<${MAX_MATCHES};i++){ if (i>=uMatchCount) break; res = opU(res, mapOneMatch(p,i)); }
    } else res = opU(res, vec2(sb, -9.0));
  }
  return res;
}

#ifdef LOWPOWER
#define STEPS 44
#define SHADOW_STEPS 12
#define AO_TAPS 2
#else
#define STEPS 72
#define SHADOW_STEPS 24
#define AO_TAPS 4
#endif
#ifdef REDUCED
#define FLICK 0.0
#else
#define FLICK 1.0
#endif

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(1.0,-1.0)*0.0005;
  return normalize(
    e.xyy*map(p+e.xyy).x +
    e.yyx*map(p+e.yyx).x +
    e.yxy*map(p+e.yxy).x +
    e.xxx*map(p+e.xxx).x);
}

float calcAO(vec3 p, vec3 n){
  float occ=0.0, sca=1.0;
  for (int i=0;i<AO_TAPS;i++){
    float h = 0.008 + 0.03*float(i)/float(AO_TAPS-1);
    float d = map(p+n*h).x;
    occ += (h-d)*sca;
    sca *= 0.6;
  }
  return clamp(1.0-2.0*occ, 0.0, 1.0);
}

float calcShadow(vec3 ro, vec3 rd, float maxT){
  float res = 1.0;
  float t = 0.004;
  for (int i=0;i<SHADOW_STEPS;i++){
    float h = map(ro+rd*t).x;
    res = min(res, 12.0*h/max(t,1e-4));
    t += clamp(h, 0.0015, 0.02);
    if (res<0.03 || t>maxT) break;
  }
  return clamp(res,0.0,1.0);
}

void getMaterial(vec3 p, float id, vec3 n, out vec3 albedo, out float rough, out vec3 emissive){
  emissive = vec3(0.0);
  rough = 0.5;
  albedo = vec3(0.5);
  if (id < 0.5) {
    float g = fbm(vec2(p.x*34.0, p.z*7.0));
    albedo = mix(vec3(0.164,0.102,0.071), vec3(0.231,0.141,0.094), g);
    rough = 0.30 + 0.10*fbm(vec2(p.x*16.0,p.z*4.0)+11.0);
  } else if (id < 1.5) {
    vec3 lp = rotY(p - uBoxCenter, -uBoxYaw);
    vec3 h = uBoxSize*0.5;
    vec3 an = rotY(n, -uBoxYaw);
    float top = smoothstep(0.55,0.85, an.y);
    float front = smoothstep(0.55,0.85, an.z);
    vec2 duv = clamp(vec2(lp.x/h.x*0.5+0.5, lp.z/h.z*0.5+0.5), 0.0, 1.0);
    vec3 labelCol = pow(texture(uLabel, duv).rgb, vec3(2.2));
    vec3 base = vec3(0.80,0.735,0.60);
    albedo = mix(base, labelCol, top);
    rough = 0.5;
    float sx = dot(p-uStrikerCenter, uStrikerAlong);
    float sy = (p-uStrikerCenter).y;
    float inStriker = step(abs(sx),uStrikerHalfLen)*step(abs(sy),uStrikerHalfH)*front;
    if (inStriker > 0.5) {
      float grit = fbm(vec2(sx*180.0,sy*180.0));
      albedo = mix(vec3(0.05,0.045,0.045), vec3(0.11,0.10,0.095), grit);
      rough = 0.88;
      float scratch = smoothstep(0.4,0.9, fbm(vec2(sx*60.0, sy*9.0+3.0)));
      albedo = mix(albedo, albedo*0.65, uStruck*scratch);
    }
    float edge = smoothstep(0.86,0.98, max(abs(lp.x)/h.x, abs(lp.z)/h.z));
    albedo = mix(albedo, min(albedo*1.2+0.03,1.0), edge*0.4);
  } else if (id < 2.5) {
    albedo = vec3(0.30,0.20,0.13); rough = 0.6;
  } else if (id < 3.5) {
    albedo = vec3(0.09,0.07,0.055); rough = 0.8;
  } else if (id < 4.5) {
    float v = hash21(floor(p.xz*900.0));
    albedo = mix(vec3(0.36,0.10,0.06), vec3(0.46,0.16,0.08), v);
    rough = 0.5;
  } else if (id < 5.5) {
    albedo = vec3(0.937,0.902,0.847);
    rough = 0.5;
    float topF = clamp((p.y-uCandleBase.y-(uCandleHeight-0.012))/0.012, 0.0, 1.0);
    emissive = vec3(1.0,0.55,0.22) * uCandleFlame * uCandleLit * exp(-(1.0-topF)*3.2) * 0.8;
  } else if (id < 6.5) {
    albedo = vec3(0.02,0.018,0.016); rough = 0.7;
    emissive = vec3(1.0,0.5,0.15) * uCandleFlame * uCandleLit * 1.4;
  } else {
    int idx = int(id+0.5) - 100;
    vec3 head=vec3(0.0), dir=vec3(0.0,1.0,0.0);
    float burn=0.0, ember=0.0, struckF=0.0, litF=0.0;
    for (int i=0;i<${MAX_MATCHES};i++){
      if (i==idx){ head=uMatchHead[i]; dir=uMatchDir[i]; burn=uMatchBurn[i]; ember=uMatchEmber[i]; struckF=uMatchStruck[i]; litF=uMatchLit[i]; }
    }
    float s = dot(p-head, dir);
    float sN = clamp(s/MATCH_LEN, 0.0, 1.0);
    if (s < MATCH_HEAD_R.y*0.75) {
      vec3 fresh = vec3(0.42,0.11,0.07);
      vec3 spentHead = mix(vec3(0.05,0.045,0.045), vec3(0.28,0.27,0.26), fbm(p.xz*260.0)*0.7);
      albedo = mix(fresh, spentHead, struckF);
      rough = mix(0.25, 0.85, struckF);
      emissive = vec3(1.0,0.35,0.08) * ember * (0.7+0.3*FLICK*fbm1(uTime*9.0+p.x*40.0));
    } else {
      float charF = smoothstep(burn+0.02, burn-0.05, sN);
      vec3 fresh = mix(vec3(0.71,0.60,0.45), vec3(0.80,0.69,0.53), fbm(vec2(p.x*260.0,dot(p,dir)*30.0)));
      vec3 charred = vec3(0.055,0.043,0.035);
      albedo = mix(fresh, charred, charF);
      rough = mix(0.45,0.92,charF);
      float band = smoothstep(0.55,1.0, 1.0-abs(sN-burn)*70.0) * litF;
      float bandFlicker = 0.82 + 0.18*FLICK*fbm1(uTime*10.0+p.z*30.0);
      emissive = vec3(1.0,0.45,0.12) * band * 1.6 * bandFlicker;
    }
  }
}

vec3 shade(vec3 p, vec3 n, vec3 rd, float id){
  vec3 albedo; float rough; vec3 emissive;
  getMaterial(p, id, n, albedo, rough, emissive);
  vec3 V = -rd;
  float ao = calcAO(p, n);
  vec3 col = vec3(0.0157,0.0188,0.0314) * ao;

  if (id < 0.5) {
    vec3 rr = reflect(rd, vec3(0.0,1.0,0.0));
    float lx = dot(rr,uRight), ly = dot(rr,uUp), lz = dot(rr,uFwd);
    vec3 reflCol = vec3(0.02,0.02,0.03);
    if (lz > 0.04) {
      vec2 ruv = clamp(vec2(0.5+0.5*(lx/lz)/uTanX, 0.5+0.5*(ly/lz)/uTanY), 0.0, 1.0);
      float lod = mix(3.5,5.5, rough);
      vec3 nightC = textureLod(uCityNight, ruv, lod).rgb;
      vec3 dayC = textureLod(uCityDay, ruv, lod).rgb;
      vec3 emitC = textureLod(uCityEmit, ruv, lod).rgb;
      float emitGain = mix(1.0,0.22,uDayness);
      reflCol = mix(pow(nightC,vec3(2.2)), pow(dayC,vec3(2.2)), uDayness) + pow(emitC,vec3(2.2))*emitGain*2.2;
    }
    float fres = 0.04 + 0.96*pow(1.0-max(dot(n,V),0.0), 5.0);
    float distFade = clamp(1.0-(p.z-GLASS_ZC)/0.30, 0.0, 1.0);
    col += reflCol * fres * distFade * 0.9;
  }

  vec3 L0 = normalize(vec3(0.0,0.35,-1.0));
  float wrap = (id>=5.0 && id<5.5) ? 0.55 : 0.15;
  float ndl0 = clamp((dot(n,L0)+wrap)/(1.0+wrap), 0.0, 1.0);
  col += albedo * uWindowLight * ndl0 * ao;

  for (int i=0;i<${MAX_FLAMES};i++){
    if (i>=uFlameCount) break;
    vec3 lp = uFlamePos[i]-p;
    float d = length(lp);
    vec3 Ld = lp/max(d,1e-4);
    float atten = 1.0/max(d*d,0.0004);
    float ndl = max(dot(n,Ld),0.0);
    float shadow = (i==0) ? calcShadow(p+n*0.0006, Ld, d) : 1.0;
    vec3 flameCol = vec3(1.0,0.56,0.24) * uFlameIntensity[i] * 2.5 * atten;
    col += albedo * flameCol * ndl * shadow;
    vec3 H = normalize(V+Ld);
    float NoH = max(dot(n,H),0.0);
    float a = max(rough*rough,0.02);
    float dS = (a*a) / max(3.14159*pow(NoH*NoH*(a*a-1.0)+1.0,2.0), 1e-4);
    col += flameCol * dS * 0.05 * ndl * shadow;
    if (id < 0.5) {
      float dxk=(p.x-uFlamePos[i].x);
      float streak = exp(-(dxk*dxk)/0.0006) * exp(-max(p.y,0.0)*45.0);
      col += vec3(1.0,0.5,0.2) * uFlameIntensity[i] * streak * 0.4;
    }
  }
  col += emissive;
  return col;
}

float raymarch(vec3 ro, vec3 rd, float tMax, out vec3 hitP, out vec3 hitN, out float hitId, out float edgeA){
  float t = 0.02;
  float d = 1e5;
  for (int i=0;i<STEPS;i++){
    vec3 p = ro+rd*t;
    vec2 m = map(p);
    d = m.x;
    if (d < 0.0003*t) { hitP=p; hitN=calcNormal(p); hitId=m.y; edgeA=1.0; return t; }
    t += max(d,0.0006);
    if (t>tMax) break;
  }
  hitId = -1.0;
  float px = uPixelWorld*t;
  edgeA = clamp(1.0 - d/max(px,1e-6), 0.0, 1.0);
  if (edgeA > 0.02) { hitP=ro+rd*t; hitN=calcNormal(hitP); }
  return t;
}

void main(){
  float x = (vUv.x*2.0-1.0)*uTanX;
  float y = (vUv.y*2.0-1.0)*uTanY;
  vec3 rd = normalize(uRight*x + uUp*y + uFwd);
  vec3 ro = uEye;

  float sillT = -1.0;
  if (rd.y < -1e-5) {
    float t = -ro.y/rd.y;
    if (t > 0.0) {
      vec3 hp = ro+rd*t;
      // Only the near-glass bound matters for the visible horizon: the sill's
      // stated far edge (0.35) is where it meets the room floor we don't
      // model, so render the plane past it too rather than showing a void
      // (or, worse, the window) for the steep rays at the screen's bottom.
      if (hp.z >= GLASS_ZC-0.01) sillT = t;
    }
  }

  vec3 hitP=vec3(0.0), hitN=vec3(0.0,1.0,0.0); float hitId=-1.0, edgeA=0.0;
  float objT = raymarch(ro, rd, 0.62, hitP, hitN, hitId, edgeA);

  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  bool useObj = edgeA > 0.02 && (sillT < 0.0 || objT < sillT);
  if (useObj) {
    rgb = shade(hitP, hitN, rd, hitId) * edgeA;
    alpha = edgeA;
  } else if (sillT > 0.0) {
    vec3 p = ro+rd*sillT;
    rgb = shade(p, vec3(0.0,1.0,0.0), rd, 0.0);
    alpha = 1.0;
  }

  for (int i=0;i<${MAX_FLAMES};i++){
    if (i>=uFlameCount) break;
    vec2 rel = (vUv-uFlameUv[i]) * vec2(uAspect,1.0);
    float hh = ((uFlameKind[i]<0.5)?0.016:0.026) * uFlameV[i] * max(uFlameSize[i],0.0);
    if (hh < 1e-7) continue;
    float u = clamp(rel.y/hh, -0.08, 1.3);
    float baseMask = smoothstep(-0.03, 0.05, u);
    vec2 lean = uFlameLean[i];
    float sway = lean.x*u*u*0.35 + 0.04*FLICK*sin(uTime*5.0+u*6.0+float(i)*3.0)*u;
    float wx = rel.x - sway*hh - lean.y*u*hh*0.15;
    float taper = mix(1.0,0.16,smoothstep(-0.1,1.0,u));
    float wobble = 1.0 + 0.15*FLICK*fbm1(uTime*5.0+u*7.0+float(i)*11.0);
    float w = hh*0.34*taper*wobble;
    float d = length(vec2(wx/max(w,1e-6), (u-0.38)/0.62));
    float body = 1.0-smoothstep(0.7,1.02,d);
    float core = 1.0-smoothstep(0.0,0.5,length(vec2(wx/max(w*0.55,1e-6),(u-0.28)/0.5)));
    vec3 fc = mix(vec3(0.22,0.33,1.0)*0.35, vec3(1.0,0.55,0.16), smoothstep(0.0,0.6,u));
    fc = mix(fc, vec3(1.0,0.95,0.78)*6.0, core*step(u,0.65));
    float flare = max(uFlameSize[i]-1.0,0.0);
    fc += vec3(1.0,0.9,0.7)*flare*2.0;
    rgb += fc*body*1.3*baseMask;
    float halo = exp(-d*d*3.0)*baseMask;
    rgb += vec3(1.0,0.5,0.18)*halo*0.35*uFlameIntensity[i];
  }

  for (int i=0;i<${MAX_SPARKS};i++){
    if (i>=uSparkCount) break;
    vec2 rel = (vUv-uSparkPos[i])*vec2(uAspect,1.0);
    vec2 dv = uSparkVec[i];
    float len = length(dv)+1e-5;
    vec2 dirn = dv/len;
    float along = clamp(dot(rel,dirn), 0.0, len);
    vec2 closest = dirn*along;
    float perp = length(rel-closest);
    float streak = exp(-perp*perp*2200000.0) * clamp(uSparkLife[i],0.0,1.0);
    rgb += vec3(1.0,0.75,0.35)*streak*2.2;
  }

  fragColor = vec4(rgb, alpha);
}
`

/** Projects a world point and returns its screen v (bottom-up), reusing the
 *  two scratch buffers the caller owns. Defined once, called every frame:
 *  no allocation (Camera.project's own default `out` would allocate). */
function projectV(cam: Camera, x: number, y: number, z: number, tmpIn: Vec3, tmpOut: Vec3): number {
  tmpIn[0] = x; tmpIn[1] = y; tmpIn[2] = z
  cam.project(tmpIn, tmpOut)
  return tmpOut[1]
}

export function createProps(kit: GLKit, opts: { lowPower: boolean; reduced: boolean }): Props {
  const gl = kit.gl
  const defines = [opts.lowPower ? 'LOWPOWER' : '', opts.reduced ? 'REDUCED' : ''].filter((d): d is string => d.length > 0)
  const prog: Program = kit.program(FRAG, { defines })
  const u = prog.u

  const scale = opts.lowPower ? 0.6 : 0.75
  let target = kit.target(4, 4, { format: 'rgba16f', filter: 'linear' })

  const labelTex = kit.texture(drawLabel(), { mipmap: true })

  const fallbackCanvas = document.createElement('canvas')
  fallbackCanvas.width = 1
  fallbackCanvas.height = 1
  const fctx = fallbackCanvas.getContext('2d')
  if (fctx) { fctx.fillStyle = '#050608'; fctx.fillRect(0, 0, 1, 1) }
  const fallbackTex = kit.texture(fallbackCanvas, { mipmap: true })

  // Reused every frame; a value is always read out before the next write.
  const scratchIn: Vec3 = [0, 0, 0]
  const scratchOut: Vec3 = [0, 0, 0]

  const matchHeadBuf = new Float32Array(3 * MAX_MATCHES)
  const matchDirBuf = new Float32Array(3 * MAX_MATCHES)
  const matchBurnBuf = new Float32Array(MAX_MATCHES)
  const matchEmberBuf = new Float32Array(MAX_MATCHES)
  const matchStruckBuf = new Float32Array(MAX_MATCHES)
  const matchLitBuf = new Float32Array(MAX_MATCHES)

  const flamePosBuf = new Float32Array(3 * MAX_FLAMES)
  const flameIntensityBuf = new Float32Array(MAX_FLAMES)
  const flameUvBuf = new Float32Array(2 * MAX_FLAMES)
  const flameVBuf = new Float32Array(MAX_FLAMES)
  const flameSizeBuf = new Float32Array(MAX_FLAMES)
  const flameLeanBuf = new Float32Array(2 * MAX_FLAMES)
  const flameKindBuf = new Float32Array(MAX_FLAMES)

  const sparkPosBuf = new Float32Array(2 * MAX_SPARKS)
  const sparkVecBuf = new Float32Array(2 * MAX_SPARKS)
  const sparkLifeBuf = new Float32Array(MAX_SPARKS)

  const windowLightBuf: Vec3 = [0, 0, 0]

  /** Once any match has struck, the striker keeps faint scratch marks for
   *  the rest of the session (a real fact about the box, not per-frame). */
  let everStruck = 0

  function resize(w: number, h: number): void {
    kit.deleteTarget(target)
    target = kit.target(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), {
      format: 'rgba16f',
      filter: 'linear',
    })
  }

  function render(state: SceneState, cam: Camera, city: CityTextures | null): void {
    prog.use()

    const ex = cam.eye[0], ey = cam.eye[1], ez = cam.eye[2]
    let fx = cam.target[0] - ex, fy = cam.target[1] - ey, fz = cam.target[2] - ez
    const fl = Math.hypot(fx, fy, fz) || 1
    fx /= fl; fy /= fl; fz /= fl
    let rx = -fz, ry = 0, rz = fx
    const rl = Math.hypot(rx, ry, rz) || 1
    rx /= rl; ry /= rl; rz /= rl
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx

    const tanY = Math.tan(cam.fovY / 2)
    const tanX = tanY * cam.aspect

    gl.uniform3f(u.uEye, ex, ey, ez)
    gl.uniform3f(u.uRight, rx, ry, rz)
    gl.uniform3f(u.uUp, ux, uy, uz)
    gl.uniform3f(u.uFwd, fx, fy, fz)
    gl.uniform1f(u.uTanX, tanX)
    gl.uniform1f(u.uTanY, tanY)
    gl.uniform1f(u.uAspect, cam.aspect)
    gl.uniform1f(u.uTime, state.t)
    gl.uniform1f(u.uDayness, state.dayness)
    gl.uniform1f(u.uPixelWorld, (2 * tanY) / Math.max(1, target.h))

    windowLight(state.dayness, state.hour, windowLightBuf)
    gl.uniform3f(u.uWindowLight, windowLightBuf[0], windowLightBuf[1], windowLightBuf[2])

    const P = cam.placements
    gl.uniform3f(u.uBoxCenter, P.box.center[0], P.box.center[1], P.box.center[2])
    gl.uniform1f(u.uBoxYaw, P.box.yaw)
    gl.uniform3f(u.uBoxSize, P.box.size[0], P.box.size[1], P.box.size[2])
    gl.uniform1f(u.uTrayOut, P.box.trayOut)
    gl.uniform1f(u.uStruck, everStruck)

    gl.uniform3f(u.uStrikerCenter, P.striker.center[0], P.striker.center[1], P.striker.center[2])
    gl.uniform3f(u.uStrikerNormal, P.striker.normal[0], P.striker.normal[1], P.striker.normal[2])
    gl.uniform3f(u.uStrikerAlong, P.striker.along[0], P.striker.along[1], P.striker.along[2])
    gl.uniform1f(u.uStrikerHalfLen, P.striker.halfLen)
    gl.uniform1f(u.uStrikerHalfH, P.striker.halfH)

    gl.uniform3f(u.uCandleBase, P.candle.base[0], P.candle.base[1], P.candle.base[2])
    gl.uniform1f(u.uCandleRadius, P.candle.radius)
    gl.uniform1f(u.uCandleHeight, P.candle.height)
    gl.uniform3f(u.uWickTop, P.candle.wickTop[0], P.candle.wickTop[1], P.candle.wickTop[2])
    gl.uniform1f(u.uCandleLit, state.candle.lit ? 1 : 0)
    gl.uniform1f(u.uCandleFlame, state.candle.flame)

    const matches = state.matches
    const mCount = Math.min(matches.length, MAX_MATCHES)
    for (let i = 0; i < mCount; i += 1) {
      const m = matches[i]
      matchHeadBuf[i * 3] = m.head[0]; matchHeadBuf[i * 3 + 1] = m.head[1]; matchHeadBuf[i * 3 + 2] = m.head[2]
      matchDirBuf[i * 3] = m.dir[0]; matchDirBuf[i * 3 + 1] = m.dir[1]; matchDirBuf[i * 3 + 2] = m.dir[2]
      matchBurnBuf[i] = m.burn
      matchEmberBuf[i] = m.ember
      matchStruckBuf[i] = m.struck ? 1 : 0
      matchLitBuf[i] = m.phase === 'lit' ? 1 : 0
      if (m.struck) everStruck = 1
    }
    gl.uniform1i(u.uMatchCount, mCount)
    gl.uniform3fv(u.uMatchHead, matchHeadBuf)
    gl.uniform3fv(u.uMatchDir, matchDirBuf)
    gl.uniform1fv(u.uMatchBurn, matchBurnBuf)
    gl.uniform1fv(u.uMatchEmber, matchEmberBuf)
    gl.uniform1fv(u.uMatchStruck, matchStruckBuf)
    gl.uniform1fv(u.uMatchLit, matchLitBuf)

    let scx = 0, scy = 0, scz = 0, scr = 0
    if (mCount > 1) {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9
      for (let i = 1; i < mCount; i += 1) {
        const h = matches[i].head
        if (h[0] < minx) minx = h[0]; if (h[0] > maxx) maxx = h[0]
        if (h[1] < miny) miny = h[1]; if (h[1] > maxy) maxy = h[1]
        if (h[2] < minz) minz = h[2]; if (h[2] > maxz) maxz = h[2]
      }
      scx = (minx + maxx) / 2; scy = (miny + maxy) / 2; scz = (minz + maxz) / 2
      const dx = maxx - minx, dy = maxy - miny, dz = maxz - minz
      scr = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 + MATCH.length + 0.006
    }
    gl.uniform3f(u.uSpentBoundCenter, scx, scy, scz)
    gl.uniform1f(u.uSpentBoundRadius, scr)

    const flames = state.flames
    const fCount = Math.min(flames.length, MAX_FLAMES)
    for (let i = 0; i < fCount; i += 1) {
      const f = flames[i]
      flamePosBuf[i * 3] = f.pos[0]; flamePosBuf[i * 3 + 1] = f.pos[1]; flamePosBuf[i * 3 + 2] = f.pos[2]
      flameIntensityBuf[i] = f.intensity
      cam.project(f.pos, scratchOut)
      flameUvBuf[i * 2] = scratchOut[0]; flameUvBuf[i * 2 + 1] = scratchOut[1]
      const depth = Math.max(scratchOut[2], 0.05)
      flameVBuf[i] = 1 / (2 * depth * tanY)
      flameKindBuf[i] = f.kind === 'candle' ? 1 : 0
      if (f.kind === 'candle') {
        flameSizeBuf[i] = state.candle.flame
        flameLeanBuf[i * 2] = 0; flameLeanBuf[i * 2 + 1] = 0
      } else {
        flameSizeBuf[i] = matches.length > 0 ? matches[0].flame : 0
        const lean = matches.length > 0 ? matches[0].lean : ZERO2
        flameLeanBuf[i * 2] = lean[0]; flameLeanBuf[i * 2 + 1] = lean[1]
      }
    }
    gl.uniform1i(u.uFlameCount, fCount)
    gl.uniform3fv(u.uFlamePos, flamePosBuf)
    gl.uniform1fv(u.uFlameIntensity, flameIntensityBuf)
    gl.uniform2fv(u.uFlameUv, flameUvBuf)
    gl.uniform1fv(u.uFlameV, flameVBuf)
    gl.uniform1fv(u.uFlameSize, flameSizeBuf)
    gl.uniform2fv(u.uFlameLean, flameLeanBuf)
    gl.uniform1fv(u.uFlameKind, flameKindBuf)

    const sparks = state.sparks
    const sCount = Math.min(sparks.length, MAX_SPARKS)
    for (let i = 0; i < sCount; i += 1) {
      const s = sparks[i]
      cam.project(s.pos, scratchOut)
      sparkPosBuf[i * 2] = scratchOut[0]; sparkPosBuf[i * 2 + 1] = scratchOut[1]
      const depth = Math.max(scratchOut[2], 0.05)
      const wToV = 1 / (2 * depth * tanY)
      sparkVecBuf[i * 2] = (s.vel[0] * rx + s.vel[1] * ry + s.vel[2] * rz) * wToV * 0.02
      sparkVecBuf[i * 2 + 1] = (s.vel[0] * ux + s.vel[1] * uy + s.vel[2] * uz) * wToV * 0.02
      sparkLifeBuf[i] = s.life
    }
    gl.uniform1i(u.uSparkCount, sCount)
    gl.uniform2fv(u.uSparkPos, sparkPosBuf)
    gl.uniform2fv(u.uSparkVec, sparkVecBuf)
    gl.uniform1fv(u.uSparkLife, sparkLifeBuf)

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, city ? city.night : fallbackTex)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, city ? city.day : fallbackTex)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, city ? city.emit : fallbackTex)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, labelTex)
    gl.uniform1i(u.uCityNight, 0)
    gl.uniform1i(u.uCityDay, 1)
    gl.uniform1i(u.uCityEmit, 2)
    gl.uniform1i(u.uLabel, 3)

    // Scissor: the sill band is the full width from the screen bottom up to
    // the tallest live feature (glass line, box, candle+flame, every match).
    let topV = projectV(cam, 0, 0, GLASS_Z, scratchIn, scratchOut)
    topV = Math.max(topV, projectV(cam, P.box.center[0], P.box.size[1], P.box.center[2], scratchIn, scratchOut))
    const candleTopY = P.candle.height * (1 + 0.6 * state.candle.flame) + 0.02
    topV = Math.max(topV, projectV(cam, P.candle.base[0], candleTopY, P.candle.base[2], scratchIn, scratchOut))
    for (let i = 0; i < mCount; i += 1) {
      const m = matches[i]
      topV = Math.max(topV, projectV(cam, m.head[0], m.head[1] + 0.02, m.head[2], scratchIn, scratchOut))
      const tx = m.head[0] + m.dir[0] * MATCH.length
      const ty = m.head[1] + m.dir[1] * MATCH.length
      const tz = m.head[2] + m.dir[2] * MATCH.length
      topV = Math.max(topV, projectV(cam, tx, ty, tz, scratchIn, scratchOut))
    }
    topV = Math.min(1, Math.max(0, topV + 0.05))

    kit.bind(target)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const sciH = Math.max(1, Math.min(target.h, Math.round(topV * target.h)))
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, target.w, sciH)
    kit.draw()
    gl.disable(gl.SCISSOR_TEST)
  }

  function destroy(): void {
    kit.deleteTarget(target)
    kit.deleteTexture(labelTex)
    kit.deleteTexture(fallbackTex)
  }

  return {
    get target() { return target },
    resize,
    render,
    destroy,
  }
}

