import { createContext } from 'react';

/** The element in the top bar where `PageHeader` shows the page name; null outside the dashboard layout. */
export const PageHeaderSlot = createContext<HTMLElement | null>(null);
