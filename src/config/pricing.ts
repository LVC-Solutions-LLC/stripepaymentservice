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
    'test': {
        'IN': 100,
        'US': 100,
    },
    'DEFAULT': {
        'IN': 49900,
        'US': 2000,
    }
};

// Map Role + Country to Stripe Price ID for Subscriptions
// In a real app this might be in the database or fetched from Stripe
export const SUBSCRIPTION_PLANS: Record<string, Record<string, string>> = {
    'job_seeker': {
        'US': 'price_jobseeker_us_monthly',
        'IN': 'price_jobseeker_in_monthly',
        'DEFAULT': 'price_jobseeker_default',
    },
    'company': {
        'US': 'price_company_us_monthly',
        'IN': 'price_company_in_monthly',
        'DEFAULT': 'price_company_default',
    },
};

export const getOneTimeFee = (role: string, country: string): number => {
    const countryKey = country === 'IN' ? 'IN' : 'US';
    const roleFees = ONE_TIME_FEES[role] || ONE_TIME_FEES['DEFAULT'];
    return roleFees[countryKey] || roleFees['US'];
};

export const getSubscriptionPlanId = (role: string, country: string): string => {
    const rolePlans = SUBSCRIPTION_PLANS[role];
    if (!rolePlans) throw new Error(`No subscription plans for role: ${role}`);
    return rolePlans[country] || rolePlans['DEFAULT'];
};
