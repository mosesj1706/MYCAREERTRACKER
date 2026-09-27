import { createContext, useContext } from "react";

/**
 * iOS-style back navigation. The Shell keeps a stack of in-app page visits: a sidebar tap starts a
 * new stack, a link inside a page pushes onto it. When there is somewhere to go back to, PageHeader
 * shows "‹ Previous page" (an installed iPad web app has no browser back button).
 */
export interface Back { label: string; go: () => void }
export const BackContext = createContext<Back | null>(null);
export const useBack = () => useContext(BackContext);
