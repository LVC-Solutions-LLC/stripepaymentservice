import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.dev') });

async function testRetry() {
    const { SubscriptionService } = await import('../src/services/subscription.service');
    const service = new SubscriptionService();
    const userId = 'RRIYEa3q1KU5dYlJmwCmvDmqh2l1';

    console.log(`Testing retry payment for user ${userId}...`);
    try {
        const result = await service.retryPayment(userId, 'test');
        console.log('✅ Result:', result);
    } catch (err: any) {
        console.error('❌ Error:', err.message);
    }
}

testRetry();
