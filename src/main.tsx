import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import 'ace-builds/src-noconflict/ace';
import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/keybinding-vim';
import 'ace-builds/src-noconflict/ext-elastic_tabstops_lite';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
