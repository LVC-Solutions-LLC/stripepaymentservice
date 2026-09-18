import dotenv from 'dotenv';

dotenv.config({ path: '.env.dev' });

const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
if (!secretKey) {
    console.error("No test secret key found!");
    process.exit(1);
}

async function testRawDelete() {
    const prodId = "prod_V3QbRuoDUmI8L6";
    const priceId = "price_1U3JkIEZSq5hM6s0gvppPl1i";

    console.log(`Testing raw DELETE /v1/prices/${priceId}...`);
    const priceRes = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${secretKey}`
        }
    });
    console.log(`Price DELETE status: ${priceRes.status}`, await priceRes.json());

    console.log(`Testing raw DELETE /v1/products/${prodId}...`);
    const prodRes = await fetch(`https://api.stripe.com/v1/products/${prodId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${secretKey}`
        }
    });
    console.log(`Product DELETE status: ${prodRes.status}`, await prodRes.json());
}

testRawDelete();
