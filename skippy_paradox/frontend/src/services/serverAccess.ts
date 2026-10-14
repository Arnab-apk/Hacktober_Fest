import { useSyncExternalStore } from 'react';

const key = 'harness-access-token';
const event = 'skippy-server-access-changed';
export const getServerAccessToken = () => sessionStorage.getItem(key) || '';
export function setServerAccessToken(value: string) {
  const token = value.trim();
  if (token) sessionStorage.setItem(key, token);
  else sessionStorage.removeItem(key);
  window.dispatchEvent(new Event(event));
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener('storage', listener);
  };
}
export function useServerAccessToken() {
  return useSyncExternalStore(subscribe, getServerAccessToken, () => '');
}
export const needsServerAccess = (message: string) => /server access token|remote access/i.test(message);
export function defaultAIProvider(): 'ollama' | 'gemini' {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ? 'ollama' : 'gemini';
}
