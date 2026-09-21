/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_API_URL?: string; readonly VITE_STANDALONE?: string }
declare module '*.sql?raw' { const content: string; export default content; }
