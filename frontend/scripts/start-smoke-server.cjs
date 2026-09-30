const { nextStart } = require('../node_modules/next/dist/cli/next-start.js');

const port = Number(process.argv[2]);

void nextStart({ port, hostname: '127.0.0.1' }, process.cwd());
