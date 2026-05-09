// WealthOS v2 - PM2 Ecosystem Config
// Oracle Cloud VM: Ubuntu 22.04 aarch64 | 12GB RAM / 2 vCPU
// Usage:
//   pm2 start ecosystem.config.cjs   <- start all services
//   pm2 save                         <- persist across reboots
//   pm2 startup                      <- run the printed command to enable on boot

module.exports = {
  apps: [
    // ─────────────────────────────────────────────────────────
    // 1. Main FastAPI NSE Bridge (port 8765)
    //    All /api/* calls from the React frontend land here.
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-api',
      cwd: './python-bridge',
      script: '.venv/bin/uvicorn',
      args: 'app:app --host 127.0.0.1 --port 8765 --workers 1',
      interpreter: 'none',
      max_memory_restart: '2G',
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1'
      },
      error_file: './logs/pm2/wealthos-api-err.log',
      out_file: './logs/pm2/wealthos-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 2. Telegram Multi-Ear Server (WS port 8081 / HTTP port 3001)
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-telegram',
      cwd: './',
      script: 'scripts/telegram-ear-server.js',
      interpreter: 'node',
      max_memory_restart: '256M',
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      error_file: './logs/pm2/wealthos-telegram-err.log',
      out_file: './logs/pm2/wealthos-telegram-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 3. Dhan Integration Bridge (port 8000)
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-dhan',
      cwd: './',
      script: 'python-bridge/.venv/bin/python',
      args: 'scripts/bridge_v1.py',
      interpreter: 'none',
      max_memory_restart: '512M',
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' },
      error_file: './logs/pm2/wealthos-dhan-err.log',
      out_file: './logs/pm2/wealthos-dhan-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 4. Webhook / TradingView Signal Receiver (port 8001)
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-webhook',
      cwd: './',
      script: 'python-bridge/.venv/bin/python',
      args: 'scripts/signal_test.py',
      interpreter: 'none',
      max_memory_restart: '256M',
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' },
      error_file: './logs/pm2/wealthos-webhook-err.log',
      out_file: './logs/pm2/wealthos-webhook-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 5. Email Signal Listener (no fixed port)
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-email',
      cwd: './',
      script: 'python-bridge/.venv/bin/python',
      args: 'scripts/email_bridge.py',
      interpreter: 'none',
      // 512M approved by human 2026-08-23: symbol map (~184k entries) idles at
      // ~280MB; the old 256M cap caused an endless PM2 memory-kill loop
      // (18,678+ restarts). Matches the 512M used by dhan/openalgo services.
      max_memory_restart: '512M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' },
      error_file: './logs/pm2/wealthos-email-err.log',
      out_file: './logs/pm2/wealthos-email-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 6b. Alpha Engine Headless Daemon (Alpha Engine Tab Autopilot)
    //     Autonomous 24/7 market loop: pulls F&O quotes via Upstox,
    //     computes MMS/CleanTrend/ORB, writes snapshot for instant UI
    //     hydration, and punches verified setups to OpenAlgo.
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-alpha-daemon',
      cwd: './python-bridge',
      script: '.venv/bin/python',
      args: 'services/alpha_daemon.py --cadence 60',
      interpreter: 'none',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' },
      error_file: './logs/pm2/wealthos-alpha-daemon-err.log',
      out_file: './logs/pm2/wealthos-alpha-daemon-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 6c. Shelfed: Stock-Type Scanner Daemon (docs/algo/strategy_brief.md)
    //     Disabled to prevent VPS crash-loops while strategies are shelfed.
    // ─────────────────────────────────────────────────────────
    /*
    {
      name: 'wealthos-scanner',
      cwd: './algo-engine',
      script: '../python-bridge/.venv/bin/python',
      args: '-m screener.live_scan_service --mode scheduler',
      interpreter: 'none',
      max_memory_restart: '1G',
      restart_delay: 10000,
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' },
      error_file: './logs/pm2/wealthos-scanner-err.log',
      out_file: './logs/pm2/wealthos-scanner-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    */

    // ─────────────────────────────────────────────────────────
    // 6. OpenAlgo Strategy Server (port 5000)
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-openalgo',
      cwd: '../openalgo',
      script: '/home/ubuntu/.local/bin/uv',
      args: 'run app.py',
      interpreter: 'none',
      max_memory_restart: '512M',
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      error_file: '../wealth-dashboard-v2/logs/pm2/wealthos-openalgo-err.log',
      out_file: '../wealth-dashboard-v2/logs/pm2/wealthos-openalgo-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 7. Cloudflare Tunnel (runs on VM — no laptop needed)
    //    Pre-auth required: cloudflared tunnel login
    //    Then: cloudflared tunnel create wealthos  (first time only)
    //    Config at: ~/.cloudflared/config.yml
    // ─────────────────────────────────────────────────────────
    {
      name: 'wealthos-tunnel',
      script: 'cloudflared',
      args: 'tunnel run',
      interpreter: 'none',
      max_memory_restart: '128M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      error_file: './logs/pm2/wealthos-tunnel-err.log',
      out_file: './logs/pm2/wealthos-tunnel-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },

    // ─────────────────────────────────────────────────────────
    // 8. Freqtrade Crypto Trading Bot (port 8080)
    // ─────────────────────────────────────────────────────────
    {
      name: 'freqtrade',
      cwd: '../freqtrade',
      script: '.venv/Scripts/freqtrade',
      args: 'trade --config user_data/config.json --strategy SampleStrategy',
      interpreter: 'none',
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' }
    },

    // ─────────────────────────────────────────────────────────
    // 9. TradingAgents Multi-Agent Analyst (port 8090)
    // ─────────────────────────────────────────────────────────
    {
      name: 'trading-agents',
      cwd: '../TradingAgents',
      script: 'wealthos_api.py',
      interpreter: 'python',
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' }
    },

    // ─────────────────────────────────────────────────────────
    // 10. NautilusTrader Precision Engine Microservice (port 8091)
    // ─────────────────────────────────────────────────────────
    {
      name: 'nautilus-service',
      cwd: '../nautilus_service',
      script: 'main.py',
      interpreter: 'python',
      autorestart: true,
      watch: false,
      env: { PYTHONUNBUFFERED: '1' }
    }
  ]
};


