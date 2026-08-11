import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.onerror = function(message, source, lineno, colno, error) {
  document.getElementById('root')!.innerHTML = `
    <div style="color: red; padding: 20px; font-family: monospace;">
      <h3>Global Error Catcher</h3>
      <p><b>Message:</b> ${message}</p>
      <p><b>Source:</b> ${source}:${lineno}:${colno}</p>
      <p><b>Error:</b> ${error?.stack?.replace(/\n/g, '<br>')}</p>
    </div>
  `;
};

window.addEventListener('unhandledrejection', function(event) {
  document.getElementById('root')!.innerHTML += `
    <div style="color: red; padding: 20px; font-family: monospace;">
      <h3>Unhandled Promise Rejection</h3>
      <p><b>Reason:</b> ${event.reason?.stack?.replace(/\n/g, '<br>') || event.reason}</p>
    </div>
  `;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
