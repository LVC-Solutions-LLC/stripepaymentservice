// This configuration maps Roles and Countries to Prices (Stripe Price IDs or Raw Amounts)

export const ONE_TIME_FEES: Record<string, Record<string, number>> = {
    // Amounts in lowest currency unit (paise for INR, cents for USD)
    'student_job_seeker': {
        'IN': 19900,  // ₹199
        'US': 500,    // $5.00
    },
    'job_seeker': {
        'IN': 49900,  // ₹499
        'US': 1000,   // $10.00
    },
    'recruiter': {
        'IN': 199900, // ₹1,999
        'US': 4900,   // $49.00
    },
    'company': {
        'IN': 499900, // ₹4,999
        'US': 14900,  // $149.00
    },
    'university': {
        'IN': 999900, // ₹9,999
        'US': 29900,  // $299.00
    },
    'sales_champion': {
        'IN': 299900, // ₹2,999
        'US': 7900,   // $79.00
    },
    'test': {
        'IN': 100,
        'US': 100,
    },
    'DEFAULT': {
        'IN': 49900,
        'US': 2000,
    }
};

// Map Role + Tier + Country to Stripe Price ID for Subscriptions
export const SUBSCRIPTION_PLANS: Record<string, Record<string, Record<string, string>>> = {
    'job_seeker': {
        'basic': {
            'US': 'price_jobseeker_basic_us_monthly',
            'IN': 'price_jobseeker_basic_in_monthly',
            'DEFAULT': 'price_jobseeker_basic_default',
        },
        'standard': {
            'US': 'price_jobseeker_standard_us_monthly',
            'IN': 'price_jobseeker_standard_in_monthly',
            'DEFAULT': 'price_jobseeker_standard_default',
        },
        'premium': {
            'US': 'price_jobseeker_premium_us_monthly',
            'IN': 'price_jobseeker_premium_in_monthly',
            'DEFAULT': 'price_jobseeker_premium_default',
        },
    },
    'company': {
        '1_seat': {
            'US': 'price_company_1_seat_us_monthly',
            'IN': 'price_company_1_seat_in_monthly',
            'DEFAULT': 'price_company_1_seat_default',
        },
        '2_seats': {
            'US': 'price_company_2_seats_us_monthly',
            'IN': 'price_company_2_seats_in_monthly',
            'DEFAULT': 'price_company_2_seats_default',
        },
        '5_seats': {
            'US': 'price_company_5_seats_us_monthly',
            'IN': 'price_company_5_seats_in_monthly',
            'DEFAULT': 'price_company_5_seats_default',
        },
        '10_seats': {
            'US': 'price_company_10_seats_us_monthly',
            'IN': 'price_company_10_seats_in_monthly',
            'DEFAULT': 'price_company_10_seats_default',
        },
        '25_seats': {
            'US': 'price_company_25_seats_us_monthly',
            'IN': 'price_company_25_seats_in_monthly',
            'DEFAULT': 'price_company_25_seats_default',
        },
    },
};

export const getOneTimeFee = (role: string, country: string): number => {
    const countryKey = country === 'IN' ? 'IN' : 'US';
    const roleFees = ONE_TIME_FEES[role] || ONE_TIME_FEES['DEFAULT'];
    return roleFees[countryKey] || roleFees['US'];
};

export const getSubscriptionPlanId = (role: string, country: string, planId: string = 'standard'): string => {
    const rolePlans = SUBSCRIPTION_PLANS[role];
    if (!rolePlans) throw new Error(`No subscription plans for role: ${role}`);
    
    const tierPlans = rolePlans[planId] || rolePlans['standard'] || Object.values(rolePlans)[0];
    return tierPlans[country] || tierPlans['DEFAULT'];
};
