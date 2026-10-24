import { RoomScene } from '../components/room/RoomScene';
import { RotationArrows } from '../components/ui/RotationArrows';
import { PromptBar } from '../components/ui/PromptBar';

export default function App() {
  return <><RoomScene/><RotationArrows/><div className="room-controls"><PromptBar/></div></>;
}
