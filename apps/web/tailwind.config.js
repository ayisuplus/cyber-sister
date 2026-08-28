/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          pink: '#FF6B9D',
          purple: '#6B5FC6',
          blue: '#6B8AFF',
          yellow: '#FFCB47',
          green: '#10B981',
        },
        text: {
          primary: '#1A1A2E',
          secondary: '#6B6B8A',
          muted: '#B0B0C8',
        },
        bg: {
          main: '#FFFFFF',
          message: '#FAF9FE',
          input: '#F5F5FA',
        },
        border: {
          subtle: '#EBEEF5',
        }
      },
      borderRadius: {
        'sm': '10px',
        'md': '16px',
        'lg': '20px',
        'pill': '25px',
      },
      fontFamily: {
        sans: ['Noto Sans SC', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['Noto Serif SC', 'serif'],
        mono: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.04)',
        'header': '0 1px 4px rgba(0,0,0,0.04)',
        'input': '0 -2px 8px rgba(0,0,0,0.06)',
      },
      backgroundImage: {
        'gradient-pink-purple': 'linear-gradient(135deg, #FF6B9D 0%, #B5A6FF 100%)',
        'gradient-pink': 'linear-gradient(135deg, #FF6B9D 0%, #F273B3 100%)',
        'gradient-purple-light': 'linear-gradient(135deg, rgba(181,166,255,0.15) 0%, rgba(255,196,242,0.15) 100%)',
      }
    },
  },
  plugins: [],
}
