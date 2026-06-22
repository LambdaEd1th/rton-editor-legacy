import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app container');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
