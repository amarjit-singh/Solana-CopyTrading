module.exports = {
  apps: [{
    name: 'copybot',
    script: 'index.js',

    // Instance settings
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',

    // Environment variables
    env: {
      NODE_ENV: 'production'
    },

    // Log settings - daily rotation
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Time-based log rotation
    log_type: 'json',

    // Restart behavior
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,

    // Graceful shutdown - allow enough time to sell all tokens before exit
    kill_timeout: 60000,
    wait_ready: false,

    // Load .env file
    env_file: '.env'
  }]
};
