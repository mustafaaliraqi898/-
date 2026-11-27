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

  // In browser/PWA mode, open a clean printable copy in a regular browser tab.
  // This avoids the Windows system print dialog that reports unsupported preview.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    nativeBrowserPrint();
    return;
  }

  const styles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  ).map((node) => node.outerHTML).join('');
  const bodyClass = document.body.className;
  const htmlClass = document.documentElement.className;
  const direction = document.documentElement.dir || 'rtl';

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="ar" dir="${direction}" class="${htmlClass}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <base href="${document.baseURI}" />
  <title>طباعة - نظام إدارة الغيابات المدرسية</title>
  ${styles}
</head>
<body class="${bodyClass}">
  ${document.body.innerHTML}
</body>
</html>`);
  printWindow.document.close();

  const startPrint = () => {
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.onafterprint = () => printWindow.close();
      printWindow.print();
    }, 400);
  };

  if (printWindow.document.readyState === 'complete') {
    startPrint();
  } else {
    printWindow.addEventListener('load', startPrint, { once: true });
  }
};

createRoot(document.getElementById('root')!).render(<App />);
