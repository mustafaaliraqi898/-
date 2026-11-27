import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const nativePrint = window.print.bind(window);
window.print = () => {
  const api = (window as Window & {
    electronAPI?: { printCurrentPage?: () => Promise<unknown> };
  }).electronAPI;

  if (api?.printCurrentPage) {
    void api.printCurrentPage().catch((error) => {
      console.error('تعذرت تهيئة ملف الطباعة:', error);
      window.alert('تعذرت تهيئة ملف الطباعة. يرجى المحاولة مرة أخرى.');
    });
    return;
  }

  nativePrint();
};

createRoot(document.getElementById('root')!).render(<App />);
