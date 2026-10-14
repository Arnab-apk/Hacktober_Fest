/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        slate: {
          750: '#2d3748',
          850: '#1a202c',
          950: '#0b1120',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.3s ease-out forwards',
        'slide-in': 'slideIn 0.2s ease-out forwards',
        'toast-in':  'toastIn  0.5s cubic-bezier(0.34,1.56,0.64,1) forwards',
        'toast-out': 'toastOut 0.28s cubic-bezier(0.4,0,1,1) forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        toastIn: {
          '0%':   { opacity: '0', transform: 'translateY(-16px) scale(0.92)', filter: 'blur(4px)' },
          '60%':  { opacity: '1', transform: 'translateY(4px)  scale(1.02)', filter: 'blur(0px)' },
          '80%':  { transform: 'translateY(-2px) scale(0.99)' },
          '100%': { opacity: '1', transform: 'translateY(0)    scale(1)',    filter: 'blur(0px)' },
        },
        toastOut: {
          '0%':   { opacity: '1', transform: 'translateY(0)    scale(1)',    filter: 'blur(0px)' },
          '100%': { opacity: '0', transform: 'translateY(-12px) scale(0.94)', filter: 'blur(3px)' },
        },
      },
    },
  },
  plugins: [],
};
