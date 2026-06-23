import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './lib/i18n';
import App from './App';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceToolsChromeProvider } from '@/contexts/workspace-tools-chrome-context';
import { ThemeProvider } from './hooks/useTheme';
import {
  applyClickablePointerCursorToDocument,
  getStoredClickablePointerCursor,
} from './lib/clickable-pointer-cursor';
import { applyDesktopNativeChromeToDocument } from './lib/desktop-shell';
import { applyFontToDocument, getStoredFont } from './lib/font';
import { applyThemeToDocument, getStoredTheme } from './lib/theme';
import {
  DEFAULT_UI_LAYOUT_SCALE,
  getStoredUiLayoutScale,
  SPIRIT_UI_LAYOUT_SCALE_VAR,
} from './lib/ui-layout-scale';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import './styles.css';

// 首屏前应用已存外观偏好，避免 portaled 浮层与根样式不一致
if (typeof document !== 'undefined') {
  applyThemeToDocument(getStoredTheme());
  applyDesktopNativeChromeToDocument();
  applyFontToDocument(getStoredFont());
  applyClickablePointerCursorToDocument(getStoredClickablePointerCursor());
  const initialUiLayoutScale = getStoredUiLayoutScale();
  if (initialUiLayoutScale !== DEFAULT_UI_LAYOUT_SCALE) {
    document.documentElement.style.setProperty(
      SPIRIT_UI_LAYOUT_SCALE_VAR,
      String(initialUiLayoutScale),
    );
  }
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Desktop root element #app was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <Toaster position="bottom-right" />
      <TooltipProvider delayDuration={300}>
        <WorkspaceToolsChromeProvider>
          <App />
        </WorkspaceToolsChromeProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
