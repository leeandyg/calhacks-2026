import { Html } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { createContext, useContext, useRef, type RefObject } from "react";
import { roomSize, type Listener as ListenerState, type SoundObject } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";

// The 3D view of the scene store. It only renders; changes go back through applyOps.
// Units match the scene contract: meters, y up, listener facing -z at yaw 0.

// <Html> labels mount into this fixed layer. Without a stable portal, drei's default target
// changes once the canvas connects, and React 19 then crashes on removeChild when labels unmount.
const LabelLayer = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function Room() {
  const labels = useRef<HTMLDivElement>(null);
  return (
    <div className="room">
      <LabelLayer.Provider value={labels}>
        <RoomCanvas />
      </LabelLayer.Provider>
      <div ref={labels} className="label-layer" />
    </div>
  );
}

function RoomCanvas() {
  const scene = useSceneStore((s) => s.scene);
  const [w, , d] = roomSize(scene.room);

  return (
    <Canvas orthographic camera={{ position: [10, 10, 10], zoom: 50 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#2b2f3a" />
      </mesh>
      <gridHelper args={[Math.max(w, d), Math.max(w, d), "#444", "#333"]} position={[0, 0.001, 0]} />
      <Listener listener={scene.listener} />
      {scene.objects.map((o) => (
        <SoundObjectMesh key={o.id} object={o} />
      ))}
    </Canvas>
  );
}

function Listener({ listener }: { listener: ListenerState }) {
  return (
    <group position={listener.position} rotation={[0, listener.yaw, 0]}>
      <mesh>
        <sphereGeometry args={[0.25, 24, 16]} />
        <meshStandardMaterial color="#e8e8e8" />
      </mesh>
      {/* facing arrow, pointing -z */}
      <mesh position={[0, 0, -0.45]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.3, 16]} />
        <meshStandardMaterial color="#ffb347" />
      </mesh>
    </group>
  );
}

// TODO(#14): icon, volume ring, drag on the floor plane dispatching { op: "move" }
function SoundObjectMesh({ object }: { object: SoundObject }) {
  const labels = useContext(LabelLayer)!;
  return (
    <group position={object.position}>
      <mesh>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshStandardMaterial color={object.kind === "bed" ? "#4f8cff" : "#5fd38d"} />
      </mesh>
      <Html center position={[0, 0.45, 0]} className="object-label" portal={labels as RefObject<HTMLElement>}>
        {object.label}
      </Html>
    </group>
  );
}
