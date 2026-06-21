import { createRoot } from 'react-dom/client';
import { App } from './App';
import { prefsStore } from './prefs';
import { installCursorFx } from './cursorFx';
import './styles/index.css';

prefsStore.hydrate();
installCursorFx();

createRoot(document.getElementById('root')!).render(<App />);
