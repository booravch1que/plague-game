import { TopBar, Toasts } from './components/Chrome';
import { useApp, useT } from './hooks';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';

export function App() {
  const t = useT();
  const joined = useApp((s) => s.joined);
  const room = useApp((s) => s.room);
  const lang = useApp((s) => s.lang);

  if (typeof document !== 'undefined') document.documentElement.lang = lang;

  let screen;
  if (!joined) screen = <Home />;
  else if (!room) screen = <main className="loading">{t('loading')}</main>;
  else if (room.status === 'lobby') screen = <Lobby />;
  else screen = <Game />;

  return (
    <div className="app">
      <TopBar />
      {screen}
      <Toasts />
    </div>
  );
}
