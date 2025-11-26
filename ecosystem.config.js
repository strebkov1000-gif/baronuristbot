module.exports = {
  apps: [
    {
      name: 'pravo-xii-bot',
      script: './node_modules/.bin/ts-node',
      args: 'src/bot.ts',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Europe/Moscow'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      listen_timeout: 5000,
      restart_delay: 4000
    }
  ]
};
