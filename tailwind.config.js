/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        // CC101: small breakpoint for very narrow phones (≤ 480px).
        // Tailwind's default `sm` is 640px, which is too wide for budget
        // 4" Android screens. The `xs` breakpoint lets us collapse 2-col
        // KPI grids to 1-col on phones without going all the way to `sm`.
        'xs': '480px',
      },
      colors: {
        // CC49: Semantic palette tokens — mirror the CSS variables in index.css
        // and let components opt into theme-driven gain / loss / accent / warn
        // colors via Tailwind utilities (e.g. `text-semantic-gain`).
        semantic: {
          gain: '#10b981',         // var(--color-gain)
          'gain-muted': 'rgba(16, 185, 129, 0.12)',
          loss: '#f43f5e',         // var(--color-loss)
          'loss-muted': 'rgba(244, 63, 94, 0.12)',
          accent: '#6366f1',       // var(--accent) in default themes
          'accent-muted': 'rgba(99, 102, 241, 0.12)',
          warn: '#f59e0b',         // var(--color-gold)
          'warn-muted': 'rgba(245, 158, 11, 0.12)',
        },
        slate: {
          750: '#2d3748',
          850: '#1a202c',
          900: '#161b27', // Consolidated from MainLayout.tsx
          950: '#0f172a',
        },
        obsidian: {
          canvas: '#08090C',
          base: '#0D0E14',
          elevated: '#131620',
          floating: '#181C2A',
          border: 'rgba(255, 255, 255, 0.06)',
          highlight: 'rgba(255, 255, 255, 0.03)',
        },
        wa: {
          canvas: 'var(--wa-canvas, #090a0f)',
          surface: 'var(--wa-surface, #0b0d14)',
          card: 'var(--wa-card, #0d0f17)',
          'card-elevated': 'var(--wa-card-elevated, #131624)',
          border: 'var(--wa-border, rgba(255, 255, 255, 0.08))',
          'border-hover': 'var(--wa-border-hover, rgba(99, 102, 241, 0.4))',
          bullish: 'var(--wa-bullish, #10b981)',
          'bullish-subtle': 'var(--wa-bullish-subtle, rgba(16, 185, 129, 0.12))',
          bearish: 'var(--wa-bearish, #f43f5e)',
          'bearish-subtle': 'var(--wa-bearish-subtle, rgba(244, 63, 94, 0.12))',
          accent: 'var(--wa-accent, #6366f1)',
          'accent-subtle': 'var(--wa-accent-subtle, rgba(99, 102, 241, 0.12))',
          warning: 'var(--wa-warning, #f59e0b)',
          'warning-subtle': 'var(--wa-warning-subtle, rgba(245, 158, 11, 0.12))',
          'text-primary': 'var(--wa-text-primary, #f8fafc)',
          'text-secondary': 'var(--wa-text-secondary, #94a3b8)',
          'text-muted': 'var(--wa-text-muted, #64748b)',
        },
        tf: {
          'bg-app': 'var(--tf-bg-app, #090a0f)',
          'bg-surface': 'var(--tf-bg-surface, #0b0d14)',
          'bg-card': 'var(--tf-bg-card, #0d0f17)',
          'bg-elevated': 'var(--tf-bg-elevated, #131624)',
          border: 'var(--tf-border, rgba(255, 255, 255, 0.08))',
          'border-subtle': 'var(--tf-border-subtle, rgba(255, 255, 255, 0.04))',
          'text-primary': 'var(--tf-text-primary, #f8fafc)',
          'text-secondary': 'var(--tf-text-secondary, #94a3b8)',
          'text-muted': 'var(--tf-text-muted, #64748b)',
        },
        cyan: {
          450: '#00e1ff',
        },
        fuchsia: {
          450: '#ff00ff',
        },
        ticker: {
          bg: '#161b27',
          text: '#94a3b8',
          up: '#10b981',
          down: '#ef4444',
        }
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite alternate',
        'drop': 'drop 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'ticker': 'ticker 60s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00e1ff' },
          '100%': { boxShadow: '0 0 20px #00e1ff, 0 0 10px #ff00ff' }
        },
        drop: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '50%': { opacity: '1' },
          '100%': { transform: 'translateY(10px)', opacity: '0' }
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-33.33%)' }
        }
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        // CC49: JetBrains Mono registered for code, JSON, and tabular numerics
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // CC49: 6-step wealth-dashboard spacing scale (flat 4-pt grid)
      spacing: {
        'wa-1': '4px',
        'wa-2': '8px',
        'wa-3': '12px',
        'wa-4': '16px',
        'wa-6': '24px',
        'wa-8': '32px',
      },
      borderRadius: {
        'wa-sm': 'var(--radius-sm, 8px)',
        'wa-md': 'var(--radius-md, 14px)',
        'wa-lg': 'var(--radius-lg, 24px)',
      },
      zIndex: {
        'ticker': '70',
        'header': '60',
        'dropdown': '100',
        'sticky': '110',
        'fixed': '200',
        'overlay': '300',
        'modal': '400',
        'popover': '500',
        'toast': '600',
        'max': '9999',
      }
    },
  },
  plugins: [
    require("tailwindcss-animate"),
  ],
}
