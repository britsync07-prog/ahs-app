/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pure: '#000000',
        matte: '#0D0D12',
        graphite: '#1C1C1E',
        navy: '#0A0A14',
        cyan: '#00F2FF',
        emerald: '#00E676',
        blue: '#2979FF',
        red: '#FF1744',
        text: {
          primary: '#F2F2F7',
          secondary: '#8E8E93',
          tertiary: '#636366',
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { opacity: 0.3, transform: 'scale(1)' },
          '100%': { opacity: 0.6, transform: 'scale(1.05)' },
        }
      }
    },
  },
  plugins: [],
}
