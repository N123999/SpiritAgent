import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { applyThemeToDocument, getStoredTheme } from './lib/theme';
import './styles.css';

// 首屏前应用已存主题，避免 portaled 浮层与根主题不一致
if (typeof document !== 'undefined') {
  applyThemeToDocument(getStoredTheme());
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Desktop root element #app was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
