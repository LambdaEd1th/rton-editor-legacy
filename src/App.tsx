import { RtonEditorShell } from './app/RtonEditorShell';
import { useRtonEditorController } from './app/controller';

export function App() {
  const controller = useRtonEditorController();

  return <RtonEditorShell controller={controller} />;
}
