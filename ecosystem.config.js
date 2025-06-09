module.exports = {
  apps: [
    {
      name: 'cropwatch-api',
      script: 'dist/main.js',
      instances: 1, // or 'max' for all CPU cores
      exec_mode: 'fork', // or 'cluster' for load balancing
      watch: false, // set to true if you want to restart on file changes
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z'
    }
  ]
};