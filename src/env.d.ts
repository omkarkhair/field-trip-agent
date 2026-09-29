// Vite `?raw` imports return the file contents as a string (used for the chat UI).
declare module '*.html?raw' {
  const content: string;
  export default content;
}
