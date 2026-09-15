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
          lavender: 'var(--cs-pastel-lavender)',
        },
        surface: {
          page: 'var(--cs-surface-page)',
          card: 'var(--cs-surface-card)',
          input: 'var(--cs-surface-input)',
          muted: 'var(--cs-surface-muted)',
          overlay: 'var(--cs-surface-overlay)',
          glass: 'var(--cs-surface-glass)',
        },
        bubble: {
          ai: 'var(--cs-bubble-ai)',
          user: 'var(--cs-bubble-user)',
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
        border: {
          subtle: 'var(--cs-border-subtle)',
          default: 'var(--cs-border-default)',
          hairline: 'var(--cs-border-hairline)',
        }
      },
      borderRadius: {
        'control': 'var(--cs-radius-control)',
        'card': 'var(--cs-radius-card)',
        'sheet': 'var(--cs-radius-sheet)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'sans-serif'],
        serif: 'var(--cs-font-display)',
        display: 'var(--cs-font-display)',
        hand: 'var(--cs-font-hand)',
        mono: ['SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'card': 'var(--cs-shadow-card)',
        'header': 'var(--cs-shadow-sm)',
        'input': 'var(--cs-shadow-input)',
        'button': 'var(--cs-shadow-button)',
        'md': 'var(--cs-shadow-md)',
        'lg': 'var(--cs-shadow-lg)',
        'soft': 'var(--cs-shadow-soft)',
        'float': 'var(--cs-shadow-float)',
      },
      transitionTimingFunction: {
        calm: 'var(--cs-ease-calm)',
        breathe: 'var(--cs-ease-breathe)',
      },
      // 气泡改用实色 bubble.ai/user（见 colors），不再有渐变同名类覆盖底色
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
