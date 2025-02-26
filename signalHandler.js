import { spawn } from 'child_process';
import process from 'node:process';

const viteProcess = spawn('vite', ['--port', '3001', '--host', '0.0.0.0'], { stdio: 'inherit' });

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    viteProcess.kill('SIGTERM');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    viteProcess.kill('SIGINT');
    process.exit(0);
});

viteProcess.on('exit', (code) => {
    console.log(`Vite process exited with code ${code}.`);
    process.exit(code);
});

// Keep the process alive to listen for signals
setInterval(() => {}, 1000); 