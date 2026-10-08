module.exports = {
  apps: [{
    name: "algo-engine",
    script: "main.py",
    interpreter: "/home/ubuntu/algo-engine/.venv/bin/python3",
    cwd: "/home/ubuntu/algo-engine",
    watch: false,
    restart_delay: 5000,         // Wait 5s before restart on crash
    max_restarts: 10,            // Stop restarting after 10 crashes (prevents infinite loops)
    env: {
      PYTHONUNBUFFERED: "1",
    },
    error_file: "/home/ubuntu/algo-engine/logs/error.log",
    out_file: "/home/ubuntu/algo-engine/logs/output.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }]
};
