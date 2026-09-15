module.exports = {
  apps: [
    {
      name: 'hexaro-backend',
      cwd: __dirname + '/backend',
      script: 'src/server.js',
      exec_mode: 'fork', // une seule instance : les sessions whatsapp-web.js vivent en mémoire
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'hexaro-frontend',
      cwd: __dirname + '/frontend',
      script: 'node_modules/.bin/serve',
      args: '-s dist -l 5011',
      exec_mode: 'fork',
    },
  ],
};
