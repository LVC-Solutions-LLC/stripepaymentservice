import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
    logger.info(`Payment Service running on port ${PORT} in ${env.NODE_ENV} mode`);
});

// Handle unhandled rejections
process.on('unhandledRejection', (err: any) => {
    logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
    logger.error(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});
