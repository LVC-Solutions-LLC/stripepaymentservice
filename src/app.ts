import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { AppError } from './utils/AppError';
import paymentRoutes from './routes/payment.routes';
import subscriptionRoutes from './routes/subscription.routes';
import webhookRoutes from './routes/webhook.routes';
import pricingRoutes from './routes/pricing.routes';
import identityRoutes from './routes/identity.routes';

const app = express();

// Security and Logging
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// Webhook handling needs raw body, so we mount it before json parser
app.use('/api/v1/webhooks', webhookRoutes);

// JSON Parsing for other routes
app.use(express.json());

// Routes
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/pricing', pricingRoutes);
// Routes
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/pricing', pricingRoutes);
app.use('/api/v1/identity', identityRoutes);

// Root Endpoint
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'success',
        message: 'Payment Service API',
        version: '1.1.0',
        environment: env.NODE_ENV,
        endpoints: {
            identity: '/api/v1/identity',
            payments: '/api/v1/payments',
            pricing: '/api/v1/pricing'
        }
    });
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        env: env.NODE_ENV
    });
});

// 404 Handler
app.use((req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || 500;
    const status = err.status || 'error';

    if (process.env.NODE_ENV === 'development') {
        console.error('ERROR 💥', err);
    }

    res.status(statusCode).json({
        status: status,
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

export default app;
