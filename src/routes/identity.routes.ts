//dummy
import { Router } from 'express';
import {
    createIdentitySession,
    createIdentitySessionSchema,
    getIdentitySession,
    getLatestIdentitySession
} from '../controllers/identity.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.post(
    '/create-session',
    validate(createIdentitySessionSchema),
    createIdentitySession
);

router.get('/latest', getLatestIdentitySession);
router.get('/session/:sessionId', getIdentitySession);

export default router;
