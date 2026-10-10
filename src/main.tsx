import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
if (window.expertmeshDesktop) document.documentElement.dataset.desktop = 'true';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
