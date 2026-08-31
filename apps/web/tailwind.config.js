/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pastel: {
          blush: 'var(--cs-pastel-blush)',
          mist: 'var(--cs-pastel-mist)',
          sprout: 'var(--cs-pastel-sprout)',
          apricot: 'var(--cs-pastel-apricot)',
        },
        surface: {
          page: 'var(--cs-surface-page)',
          card: 'var(--cs-surface-card)',
          input: 'var(--cs-surface-input)',
          muted: 'var(--cs-surface-muted)',
        },
        action: {
          primary: 'var(--cs-action-primary)',
          hover: 'var(--cs-action-hover)',
        },
        status: {
          local: 'var(--cs-status-local)',
          info: 'var(--cs-focus-info)',
          warning: 'var(--cs-warning)',
        },
        danger: 'var(--cs-danger)',
        brand: {
          pink: 'var(--cs-action-primary)',
          purple: 'var(--cs-focus-info)',
          blue: 'var(--cs-focus-info)',
          yellow: 'var(--cs-warning)',
          green: 'var(--cs-status-local)',
        },
        text: {
          primary: 'var(--cs-text-primary)',
          secondary: 'var(--cs-text-secondary)',
          muted: 'var(--cs-text-muted)',
          inverse: 'var(--cs-text-inverse)',
        },
        bg: {
          main: 'var(--cs-surface-card)',
          message: 'var(--cs-surface-page)',
          input: 'var(--cs-surface-input)',
        },
        border: {
          subtle: 'var(--cs-border-subtle)',
          default: 'var(--cs-border-default)',
          DEFAULT: 'var(--cs-border-default)',
          hairline: 'var(--cs-border-hairline)',
        }
      },
      borderRadius: {
        'sm': '10px',
        'md': '16px',
        'lg': '20px',
        'pill': '25px',
        'control': 'var(--cs-radius-control)',
        'card': 'var(--cs-radius-card)',
        'sheet': 'var(--cs-radius-sheet)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'sans-serif'],
        serif: ['Songti SC', 'SimSun', 'serif'],
        mono: ['SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'card': 'var(--cs-shadow-sm)',
        'header': 'var(--cs-shadow-sm)',
        'input': 'var(--cs-shadow-input)',
      },
      backgroundImage: {
        'gradient-pink-purple': 'var(--cs-gradient-action)',
        'gradient-pink': 'var(--cs-gradient-action)',
        'gradient-purple-light': 'var(--cs-gradient-subtle)',
        'gradient-pastel': 'var(--cs-gradient-hero)',
      }
    },
  },
  plugins: [],
}
