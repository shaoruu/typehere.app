import ReactDOM from 'react-dom/client';
import App from './App.tsx';

import './index.css';

import 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/theme-clouds';
import 'ace-builds/src-noconflict/theme-clouds_midnight';
import 'ace-builds/src-noconflict/keybinding-vim';
import 'ace-builds/src-noconflict/ext-elastic_tabstops_lite';
import 'ace-builds/src-noconflict/ext-searchbox';

// @ts-expect-error sadly
__START_REMOVE_FOR_ELECTRON__;
import { registerSW } from 'virtual:pwa-register';
import { NextAnalytics } from './Analytics.tsx';

// add this to prompt for a refresh
const updateSW = registerSW({
  onNeedRefresh() {
    updateSW(true);
  },
  onOfflineReady() {
    console.log('Offline ready!');
  },
});
// @ts-expect-error sadly
__END_REMOVE_FOR_ELECTRON__;

postMessage({ payload: 'removeLoading' }, '*');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <NextAnalytics />
    <App />
  </>,
);
