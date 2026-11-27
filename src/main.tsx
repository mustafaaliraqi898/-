import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const nativeBrowserPrint = window.print.bind(window);
window.print = () => {
  const api = (window as Window & {
    electronAPI?: { printCurrentPage?: () => Promise<unknown> };
  }).electronAPI;

  if (api?.printCurrentPage) {
    void api.printCurrentPage().catch((error) => {
      console.error('تعذرت تهيئة ملف الطباعة:', error);
    });
    return;
  }

  nativeBrowserPrint();
};

createRoot(document.getElementById('root')!).render(<App />);
