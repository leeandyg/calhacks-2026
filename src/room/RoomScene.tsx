import { Component, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { BoxGeometry, Color, DepthTexture, HalfFloatType, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, NoBlending, OrthographicCamera as ThreeOrthographicCamera, PlaneGeometry, Raycaster, Scene, ShaderMaterial, UnsignedIntType, Vector3, WebGLRenderTarget } from 'three';
import { getRoomConfig, roomConfig } from './roomConfig.js';
import { useRoomStore } from './useRoomStore.js';
import { useSceneStore } from '../scene/store.js';
import { RoomGroup } from './RoomGroup.js';
import { getRoomDimensions, ROOM_FRAME, roomProjectionEnvelope } from '../scene/layout.js';
import { PIXEL_PALETTE } from './pixelPalette.js';
import { SpawnController, SpawnProvider } from './spawn.js';
import { SoundStatusProvider, SoundStatusTracker } from './SoundStatusLabels.js';
import { useArtStore } from '../art/store.js';

const MAX_ART_COLORS = 64;

function target(depth = false) {
  return new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter,
    depthBuffer: true,
    ...(depth ? { depthTexture: new DepthTexture(1, 1, UnsignedIntType) } : {}),
  });
}

/** Render the complete room on one pixel grid, including every slab edge.
 * Geometry and pointer hit testing remain in the original R3F scene.
 */
function PixelRoomRenderer() {
  const { gl, scene, size, viewport } = useThree();
  const envId = useSceneStore(state => state.scene.room.art);
  const artColors = useArtStore(state => envId ? state.envs[envId]?.colors : undefined);
  const cache = useRef({ tick: -1, objects: useSceneStore.getState().scene.objects });
  const resources = useMemo(() => {
    const shell = target(true);
    const props = target();
    const propDepth = target(true);
    const depthMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    const material = new ShaderMaterial({
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
      uniforms: {
        shell: { value: shell.texture }, props: { value: props.texture },
        shellDepth: { value: shell.depthTexture }, propDepth: { value: propDepth.depthTexture },
        palette: { value: Array.from({ length: MAX_ART_COLORS }, (_, i) => new Color(PIXEL_PALETTE[i % PIXEL_PALETTE.length])) },
        paletteCount: { value: PIXEL_PALETTE.length },
        toneMappingExposure: { value: 1 },
      },
      vertexShader: `varying vec2 uvScreen;
        void main() { uvScreen = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D shell, props, shellDepth, propDepth;
        uniform vec3 palette[${MAX_ART_COLORS}];
        uniform int paletteCount;
        varying vec2 uvScreen;
        #include <tonemapping_pars_fragment>
        vec3 nearestColor(vec3 value) {
          vec3 best = palette[0]; float distance = 1e8;
          for (int i = 0; i < ${MAX_ART_COLORS}; i++) {
            if (i >= paletteCount) break;
            vec3 delta = value - palette[i];
            float candidate = dot(delta * delta, vec3(0.25, 0.6, 0.15));
            if (candidate < distance) { distance = candidate; best = palette[i]; }
          }
          return best;
        }
        void main() {
          vec4 base = texture2D(shell, uvScreen);
          vec4 object = texture2D(props, uvScreen);
          float behind = step(texture2D(shellDepth, uvScreen).r + 0.00001,
                              texture2D(propDepth, uvScreen).r);
          object.a *= 1.0 - behind;
          vec3 baseColor = nearestColor(ACESFilmicToneMapping(base.rgb / max(base.a, 0.00001)));
          vec4 rawObject = texture2D(props, uvScreen);
          vec3 objectColor = nearestColor(ACESFilmicToneMapping(rawObject.rgb / max(rawObject.a, 0.00001)));
          float alpha = object.a + base.a * (1.0 - object.a);
          vec3 color = objectColor * object.a + baseColor * base.a * (1.0 - object.a);
          gl_FragColor = vec4(color, alpha);
          #include <colorspace_fragment>
        }`,
    });
    const composite = new Scene();
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    composite.add(quad);
    return { shell, props, propDepth, depthMaterial, material, composite, quad, camera: new ThreeOrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);

  useLayoutEffect(() => {
    const colors = [...new Set([...(artColors ?? []), ...PIXEL_PALETTE])].slice(0, MAX_ART_COLORS);
    resources.material.uniforms.palette.value = Array.from({ length: MAX_ART_COLORS }, (_, i) => new Color(colors[i % colors.length]));
    resources.material.uniforms.paletteCount.value = colors.length;
    cache.current.tick = -1;
  }, [artColors, resources]);

  useLayoutEffect(() => {
    const pixelSize = size.width < 600 ? 1.5 : 3;
    resources.props.setSize(Math.ceil(size.width / pixelSize), Math.ceil(size.height / pixelSize));
    resources.shell.setSize(resources.props.width, resources.props.height);
    resources.propDepth.setSize(resources.props.width, resources.props.height);
    resources.material.uniforms.toneMappingExposure.value = gl.toneMappingExposure;
    cache.current.tick = -1;
    scene.userData.rendering = { interactive: true, pixelated: 'whole-room', objectPixelSize: pixelSize, shellPixelSize: pixelSize, shellSamples: resources.shell.samples, paletteColors: PIXEL_PALETTE.length };
  }, [gl, resources, scene, size, viewport.dpr]);

  useLayoutEffect(() => () => {
    resources.shell.dispose(); resources.props.dispose(); resources.propDepth.dispose();
    resources.depthMaterial.dispose(); resources.material.dispose(); resources.quad.geometry.dispose();
    delete scene.userData.rendering;
  }, [resources, scene]);

  useFrame(state => {
    const room = scene.getObjectByName('room');
    const sources = room?.getObjectByName('sound-objects');
    if (!room || !sources) return;
    const statics = room.children.filter(child => child !== sources);
    const visibility = statics.map(child => child.visible);
    const sourcesVisible = sources.visible;
    const override = scene.overrideMaterial;
    const previousTarget = gl.getRenderTarget();
    const tick = Math.floor(state.clock.elapsedTime * 10);
    const objects = useSceneStore.getState().scene.objects;
    const moving = useRoomStore.getState();
    const updateProps = tick !== cache.current.tick || objects !== cache.current.objects || moving.isRotating || moving.draggingObjectId !== null;
    try {
      sources.visible = false;
      gl.setRenderTarget(resources.shell);
      gl.render(scene, state.camera);
      sources.visible = sourcesVisible;
      if (updateProps) {
        statics.forEach(child => { child.visible = false; });
        gl.setRenderTarget(resources.props);
        gl.render(scene, state.camera);
        // A separate depth pass includes faded/muted sources without changing
        // their transparent materials or pointer targets.
        scene.overrideMaterial = resources.depthMaterial;
        gl.setRenderTarget(resources.propDepth);
        gl.render(scene, state.camera);
        cache.current = { tick, objects };
      }
    } finally {
      sources.visible = sourcesVisible;
      statics.forEach((child, i) => { child.visible = visibility[i]; });
      scene.overrideMaterial = override;
      gl.setRenderTarget(previousTarget);
    }
    gl.render(resources.composite, resources.camera);
  }, 1);
  return null;
}

function FixedCamera() {
  const ref = useRef<ThreeOrthographicCamera>(null);
  const size = useThree(state => state.size);
  const cameraConfig = useRoomStore(state => state.camera);
  const grid = useSceneStore(state => state.scene.room.grid);
  const roomSize = useMemo(() => getRoomDimensions(grid), [grid]);
  useLayoutEffect(() => { useRoomStore.getState().frameRoom(roomSize); }, [roomSize[0], roomSize[1], roomSize[2]]);
  useLayoutEffect(() => {
    const camera = ref.current;
    if (!camera) return;
    // Reserve horizontal space for the two arrows and bottom space for the prompt.
    // The diagonal envelope fits rectangles throughout the complete animation.
    const { horizontal, vertical } = roomProjectionEnvelope(roomSize);
    const topInset = Math.max(20, size.height * 0.055);
    const controlsClearance = 160; // prompt and status line
    const availableHeight = Math.max(100, Math.min(size.height * 0.8, size.height - topInset - controlsClearance));
    camera.zoom = Math.min(Math.max(40, size.width - 112) / horizontal, availableHeight / vertical);
    camera.lookAt(...cameraConfig.target);
    camera.setViewOffset(size.width, size.height, 0, (controlsClearance - topInset) / 2, size.width, size.height);
    camera.updateProjectionMatrix();
    const root = document.getElementById('root');
    root?.style.setProperty('--room-half-width', `${horizontal * camera.zoom / 2}px`);
    root?.style.setProperty('--room-center-y', `${(size.height + topInset - controlsClearance) / 2}px`);
    return () => {
      root?.style.removeProperty('--room-half-width');
      root?.style.removeProperty('--room-center-y');
    };
  }, [size, cameraConfig, roomSize]);
  return <OrthographicCamera ref={ref} makeDefault position={cameraConfig.position} near={0.1} far={100}/>;
}
function Lighting() {
  const evening = useRoomStore(state => state.lighting === 'evening');
  return <>
    <ambientLight intensity={evening ? 0.65 : 1.25} color={evening ? '#b9c2dc' : '#fff5e0'}/>
    <hemisphereLight args={['#d9e8e4', '#8d795a', evening ? 0.6 : 1.1]}/>
    <directionalLight position={[-3, 12, 6]} intensity={evening ? 1.2 : 2.5} color="#ffe2b4"/>
    <directionalLight position={[6, 5, -5]} intensity={0.6} color="#c6dbd2"/>
  </>;
}
function DevInspection() {
  const state = useThree();
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    const debug = () => {
      const room = state.scene.getObjectByName('room');
      const canvas = state.gl.domElement.getBoundingClientRect();
      const rain = useSceneStore.getState().scene.objects.find(object => object.sound.query.includes('rain'));
      const windowOpacities: number[] = [];
      room?.getObjectByName(`sound-${rain?.id}`)?.traverse(object => {
        if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) windowOpacities.push(material.opacity);
      });
      const shadows = { enabled: state.gl.shadowMap.enabled, casting: 0, receiving: 0 };
      state.scene.traverse(object => { if (object.castShadow) shadows.casting++; if (object.receiveShadow) shadows.receiving++; });
      const floorModule = state.scene.getObjectByName('floor-modules')?.children[0]?.children[0] as Mesh<BoxGeometry, MeshStandardMaterial> | undefined;
      const surfaceDetails: { wall?: string; count: number; opacity: number; visible: boolean }[] = [];
      room?.traverse(object => {
        if (object instanceof InstancedMesh && object.name === 'surface-pixels') {
          const parent = object.parent;
          surfaceDetails.push({ wall: parent?.name.startsWith('wall-') ? parent.name.slice(5) : undefined, count: object.count, opacity: (object.material as MeshStandardMaterial).opacity, visible: parent?.visible ?? true });
        }
      });
      const [width, height, depth] = getRoomDimensions(useSceneStore.getState().scene.room.grid);
      const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(z => [-ROOM_FRAME.floorDepth, height + ROOM_FRAME.wallCapTop].map(y => {
        const projected = new Vector3(x * (width / 2 + ROOM_FRAME.envelopeOverhang), y, z * (depth / 2 + ROOM_FRAME.envelopeOverhang));
        if (room) projected.applyMatrix4(room.matrixWorld);
        projected.project(state.camera);
        return [(projected.x * 0.5 + 0.5) * canvas.width, (-projected.y * 0.5 + 0.5) * canvas.height];
      })));
      return {
        angle: room?.rotation.y,
        orientation: useRoomStore.getState().orientation,
        rotating: useRoomStore.getState().isRotating,
        camera: { position: state.camera.position.toArray(), quaternion: state.camera.quaternion.toArray(), target: useRoomStore.getState().camera.target, orthographic: state.camera instanceof ThreeOrthographicCamera },
        walls: roomConfig.walls.map(wall => { const mesh = state.scene.getObjectByName(`wall-${wall.id}`); return { id: wall.id, opacity: mesh?.userData.opacity, visible: mesh?.visible, modules: mesh?.userData.modules, openings: mesh?.userData.openings }; }),
        floorModules: state.scene.getObjectByName('floor')?.userData.modules,
        shell: {
          floorThickness: floorModule?.geometry.parameters.height,
          floorColor: floorModule?.material.color.getHexString(),
          walls: roomConfig.walls.map(wall => {
            const group = state.scene.getObjectByName(`wall-${wall.id}`);
            const mesh = group?.getObjectByName('wall-body') as Mesh<BoxGeometry, MeshStandardMaterial> | undefined;
            return { id: wall.id, bodyVisible: mesh?.visible, thickness: mesh?.geometry.parameters.depth, color: mesh?.material.color.getHexString(), childCount: group?.children.length };
          }),
          surfaceDetails,
        },
        windowVisible: (room?.getObjectByName(`sound-${rain?.id}`)?.userData.opacity ?? 0) > 0,
        objects: useSceneStore.getState().scene.objects.map(object => {
          const model = room?.getObjectByName(`sound-${object.id}`);
          const hitAnchor = model?.userData.model === 'birds' ? new Vector3(-0.4, 0.06, 0.21) : new Vector3(0, 0, 0.16);
          const projected = model?.localToWorld(hitAnchor).project(state.camera);
          let color: number[] | undefined;
          model?.traverse(child => { if (!color && child instanceof Mesh && !Array.isArray(child.material) && 'color' in child.material) color = (child.material.color as { toArray(): number[] }).toArray(); });
          const birdPoses = ['bird-blue', 'bird-gold'].flatMap(name => {
            const bird = model?.getObjectByName(name);
            return bird ? [{ y: bird.position.y, blinking: bird.getObjectByName('bird-blink')?.visible }] : [];
          });
          const rainPoses = Array.from({ length: 8 }, (_, i) => model?.getObjectByName(`rain-streak-${i}`)).filter(mesh => mesh !== undefined).map(mesh => ({ y: mesh.position.y, height: mesh.scale.y, visible: mesh.visible }));
          const painted = model?.getObjectByName('painted-prop') as Mesh<PlaneGeometry, MeshStandardMaterial> | undefined;
          return { id: object.id, artFrame: painted?.material.map?.offset.x, model: model?.userData.model, position: object.position, wall: object.wall, muted: object.muted, opacity: model?.userData.opacity, color, bladeAngle: model?.getObjectByName('fan-blades')?.rotation.z, fanBaseX: model?.getObjectByName('fan-base')?.position.x, birdPoses, rainPoses, screen: projected ? [canvas.left + (projected.x * 0.5 + 0.5) * canvas.width, canvas.top + (-projected.y * 0.5 + 0.5) * canvas.height] : null };
        }),
        windowOpacities,
        shadows,
        rendering: state.scene.userData.rendering,
        bounds: { left: Math.min(...corners.map(point => point[0])), right: Math.max(...corners.map(point => point[0])), top: Math.min(...corners.map(point => point[1])), bottom: Math.max(...corners.map(point => point[1])) },
        scene: structuredClone(useSceneStore.getState().scene), dragging: useRoomStore.getState().draggingObjectId,
      };
    };
    const project = (position: [number, number, number]) => {
      const projected = new Vector3(...position);
      state.scene.getObjectByName('room')?.localToWorld(projected);
      projected.project(state.camera);
      const bounds = state.gl.domElement.getBoundingClientRect();
      return [bounds.left + (projected.x * 0.5 + 0.5) * bounds.width, bounds.top + (-projected.y * 0.5 + 0.5) * bounds.height];
    };
    const wallSolid = (wallId: string, column: number, level: number) => {
      const wall = state.scene.getObjectByName(`wall-${wallId}`);
      const body = wall?.getObjectByName('wall-body');
      if (!wall || !body) return false;
      const grid = useSceneStore.getState().scene.room.grid;
      const length = wallId === 'north' || wallId === 'south' ? grid.columns : grid.rows;
      wall.updateWorldMatrix(true, true);
      const origin = new Vector3(column + 0.5 - length / 2, level + 0.5, 2).applyMatrix4(wall.matrixWorld);
      const direction = new Vector3(0, 0, -1).transformDirection(wall.matrixWorld);
      return new Raycaster(origin, direction, 0, 4).intersectObject(body, false).length > 0;
    };
    Object.assign(window, { __pixelRoom: debug, __pixelRoomProject: project, __pixelRoomEdit: useSceneStore.getState().applyOps, __pixelRoomWallSolid: wallSolid });
    return () => { Reflect.deleteProperty(window, '__pixelRoom'); Reflect.deleteProperty(window, '__pixelRoomProject'); Reflect.deleteProperty(window, '__pixelRoomEdit'); Reflect.deleteProperty(window, '__pixelRoomWallSolid'); };
  }, [state]);
  return null;
}
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-error"><strong>The room needs WebGL to open.</strong><p>Enable hardware acceleration in your browser, then reload.</p></div> : this.props.children; }
}
export function RoomScene() {
  const room = useSceneStore(state => state.scene.room);
  const config = useMemo(() => getRoomConfig(room), [room]);
  return <SoundStatusProvider><SceneBoundary><Canvas shadows={false} dpr={[1, 1.8]} gl={{ antialias: false, alpha: true }} fallback={<div className="scene-error">Your browser needs WebGL to show this room.</div>} aria-label="Isometric pixel-art room with movable sound objects. Click an object to mute or unmute it.">
    <SpawnProvider>
      <FixedCamera/>
      <Lighting/>
      <RoomGroup config={config}/>
      <SpawnController/>
      <PixelRoomRenderer/>
      <SoundStatusTracker/>
      <DevInspection/>
    </SpawnProvider>
  </Canvas></SceneBoundary></SoundStatusProvider>;
}
