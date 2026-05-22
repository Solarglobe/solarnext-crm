// PM2 ecosystem — SolarNext API (production VPS)
// ⚠ exec_mode MUST be "fork" — ESM project ("type":"module") incompatible with cluster mode
module.exports = {
  apps: [
    {
      name: 'solarnext-api',
      script: 'server.js',
      cwd: '/home/ubuntu/solarnext-crm/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '900M',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      error_file: '/home/ubuntu/logs/solarnext-api-error.log',
      out_file: '/home/ubuntu/logs/solarnext-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
