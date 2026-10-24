import { useRef } from 'react';
import { Group, Mesh } from 'three';
import { Block } from './Block';
import { useObjectLoop } from './useObjectLoop';

export function FanModel({ height, muted = false }: { height: number; muted?: boolean }) {
  const blades = useRef<Group>(null);
  const base = useRef<Group>(null);
  useObjectLoop(!muted, (_, phase) => {
    if (blades.current) blades.current.rotation.z = -phase * Math.PI * 2 / 3;
    if (base.current) base.current.position.x = Math.sin(phase * Math.PI * 2) * 0.04;
  });
  const stem = Math.max(0.25, height - 0.34);
  return <group>
    <group ref={base} name="fan-base">
      <Block position={[0, -height + 0.1, 0]} size={[1.05, 0.2, 0.8]} color="#c3c8b2"/>
      <Block position={[0, -height + 0.22, 0]} size={[0.7, 0.08, 0.5]} color="#e0dfc7"/>
      <Block position={[0.25, -height + 0.22, 0.21]} size={[0.12, 0.035, 0.07]} color="#657c6e"/>
    </group>
    <mesh position={[0, -height + 0.27 + stem / 2, -0.08]}><cylinderGeometry args={[0.07, 0.1, stem, 8]}/><meshStandardMaterial color="#abb7a4" roughness={0.9} flatShading/></mesh>
    <Block position={[0, -0.12, -0.2]} size={[0.28, 0.34, 0.48]} color="#9aa999"/>
    <mesh position={[0, 0, -0.12]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.65, 0.65, 0.19, 20]}/><meshStandardMaterial color="#b8c5af" roughness={0.9} flatShading/></mesh>
    <mesh position={[0, 0, -0.015]}><circleGeometry args={[0.59, 24]}/><meshStandardMaterial color="#6f8b7e" roughness={1}/></mesh>
    <group ref={blades} name="fan-blades" position={[0, 0, 0.035]}>
      {[0, 1, 2].map(index => <group key={index} rotation={[0, 0, index * Math.PI * 2 / 3]}>
        <Block position={[0.29, 0.08, 0]} size={[0.47, 0.19, 0.045]} rotation={[0, 0, 0.24]} color="#b6cbb5"/>
        <Block position={[0.43, 0.15, 0]} size={[0.17, 0.24, 0.045]} rotation={[0, 0, 0.24]} color="#c4d4bd"/>
      </group>)}
    </group>
    <group position={[0, 0, 0.105]}>
      {[0.39, 0.61].map(radius => <mesh key={radius}><torusGeometry args={[radius, radius === 0.61 ? 0.035 : 0.012, 4, 24]}/><meshStandardMaterial color="#d4d9c4" roughness={0.9}/></mesh>)}
      {Array.from({ length: 8 }, (_, index) => <Block key={index} rotation={[0, 0, index * Math.PI / 8]} size={[1.2, 0.012, 0.018]} color="#c3cdbb"/>)}
      <mesh position={[0, 0, 0.035]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.11, 0.11, 0.09, 12]}/><meshStandardMaterial color="#e5e5cf" roughness={0.85} flatShading/></mesh>
    </group>
  </group>;
}

function Bird({ body, wing, muted, offset, blinkFrame, name }: { body: string; wing: string; muted: boolean; offset: number; blinkFrame: number; name: string }) {
  const bird = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const blink = useRef<Group>(null);
  useObjectLoop(!muted, (frame, phase) => {
    if (bird.current) bird.current.position.y = Math.sin((phase + offset / 16) * Math.PI * 2) * 0.025;
    if (eyes.current) eyes.current.visible = frame !== blinkFrame;
    if (blink.current) blink.current.visible = frame === blinkFrame;
  });
  return <group ref={bird} name={name}>
    <Block position={[0, 0.04, 0]} size={[0.44, 0.35, 0.32]} color={body}/>
    <Block position={[0.17, 0.27, 0]} size={[0.29, 0.3, 0.29]} color={body}/>
    <Block position={[0.38, 0.24, 0]} size={[0.16, 0.085, 0.13]} color="#d5a75d"/>
    <Block position={[-0.29, -0.01, 0]} size={[0.28, 0.13, 0.17]} rotation={[0, 0, -0.2]} color={wing}/>
    {[-1, 1].map(side => <group key={side}>
      <Block position={[-0.04, 0.03, side * 0.176]} size={[0.29, 0.22, 0.065]} color={wing}/>
      <Block position={[side * 0.1, -0.2, 0]} size={[0.035, 0.16, 0.04]} color="#99754b"/>
      <Block position={[side * 0.1 + 0.025, -0.285, 0]} size={[0.11, 0.035, 0.12]} color="#99754b"/>
    </group>)}
    <group ref={eyes} name="bird-eyes">{[-1, 1].map(side => <Block key={side} position={[0.23, 0.31, side * 0.151]} size={[0.045, 0.045, 0.018]} color="#28372d"/>)}</group>
    <group ref={blink} name="bird-blink" visible={false}>{[-1, 1].map(side => <Block key={side} position={[0.23, 0.31, side * 0.151]} size={[0.065, 0.012, 0.018]} color="#28372d"/>)}</group>
  </group>;
}

export function BirdsModel({ height, muted = false }: { height: number; muted?: boolean }) {
  const stem = Math.max(0.2, height - 0.35);
  return <>
    <Block position={[0, -height + 0.07, 0]} size={[0.78, 0.14, 0.65]} color="#9f774e"/>
    <Block position={[0, -height + stem / 2 + 0.14, 0]} size={[0.14, stem, 0.14]} color="#b18a58"/>
    <Block position={[0, -0.32, 0]} size={[1.55, 0.11, 0.14]} color="#c09b68"/>
    <group position={[-0.4, 0, 0]}><Bird body="#9fb9b9" wing="#6b9294" muted={muted} offset={0} blinkFrame={3} name="bird-blue"/></group>
    <group position={[0.43, 0, 0]} rotation={[0, Math.PI, 0]} scale={0.86}><Bird body="#dfd2a2" wing="#b5ac77" muted={muted} offset={5} blinkFrame={11} name="bird-gold"/></group>
  </>;
}

export function RainWindow({ width = 2, height = 3, muted = false }: { width?: number; height?: number; muted?: boolean }) {
  const streaks = useRef<(Mesh | null)[]>([]);
  const panes = [-1, 1].flatMap(vertical => [-1, 1].map(horizontal => ({
    left: horizontal < 0 ? -width / 2 + 0.2 : 0.12,
    right: horizontal < 0 ? -0.12 : width / 2 - 0.2,
    bottom: vertical < 0 ? -height / 2 + 0.2 : 0.12,
    top: vertical < 0 ? -0.12 : height / 2 - 0.2,
  })));
  useObjectLoop(!muted, (_, phase) => {
    streaks.current.forEach((mesh, index) => {
      if (!mesh) return;
      const pane = panes[Math.floor(index / 2)];
      const length = 0.12 + index % 3 * 0.025;
      const travel = pane.top - pane.bottom + length;
      const top = Math.min(pane.top, pane.top + length - ((phase + index * 5 / 16) % 1) * travel);
      const bottom = Math.max(pane.bottom, pane.top - ((phase + index * 5 / 16) % 1) * travel);
      mesh.visible = top > bottom;
      mesh.position.y = (top + bottom) / 2;
      mesh.scale.y = Math.max(0.001, top - bottom);
    });
  });
  return <>
    <Block size={[width, height, 0.13]} color="#d4c09b"/>
    <Block position={[0, 0, 0.075]} size={[width - 0.28, height - 0.26, 0.04]} color="#88b2b9" emissive="#9cc6c9"/>
    {[-1, 1].map(side => <Block key={side} position={[side * width / 4, height * 0.22, 0.102]} size={[width / 2 - 0.2, height * 0.36, 0.018]} color={side < 0 ? '#abcbd0' : '#b4d2d3'}/>)}
    <Block position={[0, -height * 0.26, 0.102]} size={[width - 0.32, height * 0.32, 0.018]} color="#8baeb1"/>
    {Array.from({ length: 8 }, (_, index) => {
      const pane = panes[Math.floor(index / 2)];
      const x = pane.left + (pane.right - pane.left) * (index % 2 + 1) / 3;
      return <mesh key={index} ref={mesh => { streaks.current[index] = mesh; }} name={`rain-streak-${index}`} position={[x, 0, 0.128]}><boxGeometry args={[0.025, 1, 0.013]}/><meshStandardMaterial color="#d9e9e1" roughness={1} flatShading/></mesh>;
    })}
    <Block position={[0, 0, 0.17]} size={[0.1, height - 0.15, 0.12]} color="#e4d6b6"/>
    <Block position={[0, 0, 0.17]} size={[width - 0.14, 0.1, 0.12]} color="#e4d6b6"/>
    <Block position={[0, -height / 2 + 0.075, 0.22]} size={[width, 0.15, 0.42]} color="#e1ceaa"/>
  </>;
}

export function SpeakerModel({ height }: { height: number }) {
  return <group>
    {height > 0.8 && <><Block position={[0, -height / 2 - 0.35, 0]} size={[0.15, height - 0.7, 0.15]} color="#73877c"/><Block position={[0, -height + 0.07, 0]} size={[0.8, 0.14, 0.65]} color="#73877c"/></>}
    <Block size={[0.9, 1.4, 0.58]} color="#596c67"/>
    <Block position={[0, 0, 0.3]} size={[0.76, 1.24, 0.035]} color="#374c47"/>
    {[{ y: -0.25, radius: 0.26 }, { y: 0.38, radius: 0.13 }].map(({ y, radius }) => <group key={y} position={[0, y, 0.34]}><mesh><circleGeometry args={[radius, 16]}/><meshStandardMaterial color="#85968b" roughness={1}/></mesh><mesh position={[0, 0, 0.01]}><circleGeometry args={[radius * 0.42, 12]}/><meshStandardMaterial color="#3c514a" roughness={1}/></mesh></group>)}
  </group>;
}
