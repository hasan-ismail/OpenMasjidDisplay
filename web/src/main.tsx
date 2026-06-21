import { createRoot } from 'react-dom/client';
import { App } from './App';
import { VolunteerApp } from './VolunteerApp';
import { prefsStore } from './prefs';
import { installCursorFx } from './cursorFx';
import './styles/index.css';

declare global {
  interface Window { __OMD_VOLUNTEER__?: boolean }
}

prefsStore.hydrate();
installCursorFx();

// The server injects __OMD_VOLUNTEER__ when this bundle is served on the volunteer
// port, so the same build boots the simple mobile volunteer page there.
const isVolunteer = !!window.__OMD_VOLUNTEER__;
createRoot(document.getElementById('root')!).render(isVolunteer ? <VolunteerApp /> : <App />);
