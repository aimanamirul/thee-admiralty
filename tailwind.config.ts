import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#050811',
        panel: '#0a0e17',
        phosphor: '#00f0ff',
        amber: { radar: '#ffb000' },
        warn: '#ff2a2a',
        navy: { DEFAULT: '#1b314b', deep: '#0d1e33' },
        emerald: { accent: '#10b981' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 8px rgba(0,240,255,0.35), inset 0 0 8px rgba(0,240,255,0.08)',
        glowRed: '0 0 8px rgba(255,42,42,0.4)',
        glowAmber: '0 0 8px rgba(255,176,0,0.4)',
      },
      keyframes: {
        scan: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
        flicker: { '0%,100%': { opacity: '0.97' }, '50%': { opacity: '1' }, '92%': { opacity: '0.94' } },
        blink: { '0%,49%': { opacity: '1' }, '50%,100%': { opacity: '0.15' } },
      },
      animation: {
        scan: 'scan 7s linear infinite',
        flicker: 'flicker 5s infinite',
        blink: 'blink 1.1s steps(1) infinite',
      },
    },
  },
  plugins: [],
};
export default config;
