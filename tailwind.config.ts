import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./public/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#FFB6C1',
        secondary: '#FFC0CB',
        accent: '#FF69B4',
        ink: '#3F2A2E',
        bg: '#FFF6F8',
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        hand: ['"Ma Shan Zheng"', '"Caveat"', 'cursive'],
      },
      borderRadius: {
        card: '24px',
      },
      boxShadow: {
        soft: '0 8px 24px rgba(255, 182, 193, 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
