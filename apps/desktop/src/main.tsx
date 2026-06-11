import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './lib/i18n';
import App from './App';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from './hooks/useTheme';
import {
  applyClickablePointerCursorToDocument,
  getStoredClickablePointerCursor,
} from './lib/clickable-pointer-cursor';
import { applyDesktopNativeChromeToDocument } from './lib/desktop-shell';
import { applyFontToDocument, getStoredFont } from './lib/font';
import { applyThemeToDocument, getStoredTheme } from './lib/theme';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import './styles.css';

// 首屏前应用已存外观偏好，避免 portaled 浮层与根样式不一致
if (typeof document !== 'undefined') {
  if (import.meta.env.DEV && /\bElectron\//.test(navigator.userAgent)) {
    console.info(
      '[spirit-desktop] 首屏前 spiritDesktop:',
      Boolean(window.spiritDesktop),
    );
  }
  applyThemeToDocument(getStoredTheme());
  applyDesktopNativeChromeToDocument();
  applyFontToDocument(getStoredFont());
  applyClickablePointerCursorToDocument(getStoredClickablePointerCursor());
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Desktop root element #app was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
